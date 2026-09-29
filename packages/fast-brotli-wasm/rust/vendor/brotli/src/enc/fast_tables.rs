// fast-brotli-wasm: the encoder's four big lookup tables (518 KB, about 330 KB
// of fastbrotli.wasm after gzip) are not stored in the module. init() rebuilds
// them, the first time an encoder is created, from packed forms in
// fast_tables/*.bin (115 KB), written by the package's tools/pack-tables.mjs
// from brotli-wasm 3.0.1's own tables, which also describes the formats:
//
//   util::log64k                          (FastLog2u16)
//   static_dict_lut::kStaticDictionaryWords
//   static_dict_lut::kStaticDictionaryBuckets
//   dictionary_hash::kStaticDictionaryHash
//
// Every read of these tables happens in an encoder, after
// BrotliEncoderStateStruct::new() has called init(). The package's
// test/tables.mjs compares the rebuilt tables with brotli-wasm's.
#![allow(non_upper_case_globals)]

use super::dictionary_hash::kStaticDictionaryHash;
use super::static_dict_lut::{kStaticDictionaryBuckets, kStaticDictionaryWords, DictWord};
use super::util::log64k;
use core::ptr::addr_of_mut;

static LOG64K: &[u8] = include_bytes!("fast_tables/log64k.bin");
static WORDS: &[u8] = include_bytes!("fast_tables/dict_words.bin");
static BUCKETS: &[u8] = include_bytes!("fast_tables/dict_buckets.bin");
static HASH: &[u8] = include_bytes!("fast_tables/dict_hash.bin");

static mut READY: bool = false;

/// Builds the tables; cheap after the first call.
#[inline]
pub fn init() {
    unsafe {
        if !READY {
            build();
            READY = true;
        }
    }
}

// (runs once, usually in V8's baseline tier: plain loops, few instructions per entry)
#[cold]
#[inline(never)]
unsafe fn build() {
    // log64k: 512 bit patterns, then second differences (4 bits each)
    let t = addr_of_mut!(log64k) as *mut u32;
    for i in 0..512 {
        *t.add(i) = u32::from_le_bytes([LOG64K[4 * i], LOG64K[4 * i + 1], LOG64K[4 * i + 2], LOG64K[4 * i + 3]]);
    }
    let mut u = *t.add(511); // bits(i - 1)
    let mut d = u.wrapping_sub(*t.add(510)); // bits(i - 1) - bits(i - 2)
    let mut out = t.add(512);
    for q in LOG64K[2048..].chunks_exact(4) {
        let x = u32::from_le_bytes([q[0], q[1], q[2], q[3]]) as i32;
        let mut k = 28;
        while k >= 0 {
            d = d.wrapping_add(((x << k) >> 28) as u32);
            u = u.wrapping_add(d);
            *out = u;
            out = out.add(1);
            k -= 4;
        }
    }

    // kStaticDictionaryWords: the l bytes, the low bytes of i, then (i >> 8) << 4 | t
    let words = &mut *addr_of_mut!(kStaticDictionaryWords);
    let n = words.len();
    let (l, rest) = WORDS.split_at(n);
    let (lo, hi_t) = rest.split_at(n);
    for (k, w) in words.iter_mut().enumerate() {
        *w = DictWord {
            l: l[k],
            t: hi_t[k] & 15,
            i: lo[k] as u16 | ((hi_t[k] >> 4) as u16) << 8,
        };
    }

    // kStaticDictionaryBuckets: a bitmap of the nonzero slots; the buckets are
    // consecutive runs of words, each ending at a word whose l has bit 7 set
    let buckets = &mut *addr_of_mut!(kStaticDictionaryBuckets);
    let mut pos = 1usize;
    for (byte_index, &byte) in BUCKETS.iter().enumerate() {
        let mut m = byte;
        while m != 0 {
            let h = byte_index * 8 + m.trailing_zeros() as usize;
            m &= m - 1;
            buckets[h] = pos as u16;
            while words[pos].l & 0x80 == 0 {
                pos += 1;
            }
            pos += 1;
        }
    }

    // kStaticDictionaryHash: a bitmap of the nonzero slots, their low bytes, their high bytes
    let hash = &mut *addr_of_mut!(kStaticDictionaryHash);
    let (bitmap, values) = HASH.split_at(4096);
    let (lo, hi) = values.split_at(values.len() / 2);
    let mut k = 0usize;
    for (byte_index, &byte) in bitmap.iter().enumerate() {
        let mut m = byte;
        while m != 0 {
            let h = byte_index * 8 + m.trailing_zeros() as usize;
            m &= m - 1;
            hash[h] = lo[k] as u16 | (hi[k] as u16) << 8;
            k += 1;
        }
    }
}
