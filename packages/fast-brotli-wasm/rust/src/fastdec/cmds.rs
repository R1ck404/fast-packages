// Meta-block command loop: insert-and-copy commands, literals, distances and
// copies, written straight into the output Vec. All hot state (bit reader,
// block counters, distance ring) is kept in locals.

use super::bits::Br;
use super::context::kContextLookup;
use super::copy::copy_match;
use super::huff::{read_sym, read_wide};
use super::{switch, Blocks, Dec, D_PUSH, D_SHORT, SLACK};
use brotli_decompressor::dictionary::{kBrotliDictionary, kBrotliDictionaryOffsetsByLength, kBrotliDictionarySizeBitsByLength};
use brotli_decompressor::transform::TransformDictionaryWord;


impl<'a> Dec<'a> {
    #[inline(never)]
    pub(super) unsafe fn commands(&mut self, mlen: usize, b: &mut Blocks, npostfix: u32) -> Option<()> {
        let mut op = self.out.len();
        let guess = if op == 0 { self.inp.len() * 4 } else { 0 };
        self.out.reserve(if mlen + SLACK > guess { mlen + SLACK } else { guess });
        let optr = self.out.as_mut_ptr();
        let end = op + mlen;
        let tabs = self.tabs.as_ptr();
        let lit_off = self.lit_off.as_ptr();
        let cmd_off = self.cmd_off.as_ptr();
        let dist_off = self.dist_off.as_ptr();
        let cmap = self.cmap.as_ptr();
        let dcmap = self.dcmap.as_ptr();
        let modes = self.modes.as_ptr();
        let trivial = self.trivial.as_ptr();
        let wtabs = self.wtabs.as_ptr();
        let mbd = self.mbd;
        let far = self.inp.len() + 8;
        let mut br: Br = self.br;
        let [mut blen0, mut blen1, mut blen2] = b.len;
        // distance ring: last .. 4th last
        let [mut d0, mut d1, mut d2, mut d3] = self.dist;

        // literals: one tree (trivial context map row) or context -> tree
        let mut lut = kContextLookup[(*modes & 3) as usize].as_ptr();
        let mut ltriv = *trivial;
        let mut ltree = tabs.add(*lit_off.add(*cmap as usize) as usize);
        let mut ltab = [tabs; 64];
        let fill_ltab = |ltab: &mut [*const u32; 64], t: usize| {
            for (i, e) in ltab.iter_mut().enumerate() {
                *e = tabs.add(*lit_off.add(*cmap.add((t << 6) + i) as usize) as usize);
            }
        };
        if !ltriv {
            fill_ltab(&mut ltab, 0);
        }
        let mut ctree = wtabs.add(*cmd_off as usize);
        let mut dtab = [wtabs; 4];
        let fill_dtab = |dtab: &mut [*const u64; 4], t: usize| {
            for (i, e) in dtab.iter_mut().enumerate() {
                *e = wtabs.add(*dist_off.add(*dcmap.add((t << 2) + i) as usize) as usize);
            }
        };
        fill_dtab(&mut dtab, 0);

        let res = loop {
            if br.pos > far {
                break None;
            }
            if blen1 == 0 {
                let (nbr, t, l) = switch(br, tabs, b, 1);
                br = nbr;
                blen1 = l;
                ctree = wtabs.add(*cmd_off.add(t as usize) as usize);
            }
            blen1 = blen1.wrapping_sub(1);
            br.refill();
            let v = read_wide(&mut br, ctree);
            let insert = ((v >> 21) & 0x7fff) as usize + br.read(((v >> 8) & 31) as u32) as usize;
            if br.bits < 24 {
                br.refill();
            }
            let copy = ((v >> 36) & 0xfff) as usize + br.read(((v >> 13) & 31) as u32) as usize;

            if insert != 0 {
                if insert > end - op {
                    break None; // block length overrun
                }
                let mut n = insert;
                loop {
                    if blen0 == 0 {
                        let (nbr, t, l) = switch(br, tabs, b, 0);
                        br = nbr;
                        blen0 = l;
                        let t = t as usize;
                        lut = kContextLookup[(*modes.add(t) & 3) as usize].as_ptr();
                        ltriv = *trivial.add(t);
                        if ltriv {
                            ltree = tabs.add(*lit_off.add(*cmap.add(t << 6) as usize) as usize);
                        } else {
                            fill_ltab(&mut ltab, t);
                        }
                    }
                    let mut k = if (blen0 as usize) < n { blen0 as usize } else { n };
                    n -= k;
                    blen0 = blen0.wrapping_sub(k as u32);
                    let mut dst = optr.add(op);
                    op += k;
                    if ltriv {
                        let t = ltree;
                        while k >= 3 {
                            br.refill();
                            *dst = read_sym(&mut br, t) as u8;
                            *dst.add(1) = read_sym(&mut br, t) as u8;
                            *dst.add(2) = read_sym(&mut br, t) as u8;
                            dst = dst.add(3);
                            k -= 3;
                        }
                        if k != 0 {
                            br.refill();
                            *dst = read_sym(&mut br, t) as u8;
                            if k == 2 {
                                *dst.add(1) = read_sym(&mut br, t) as u8;
                            }
                        }
                    } else {
                        let at = op - k;
                        let mut p1 = if at >= 1 { *dst.sub(1) } else { 0 } as usize;
                        let mut p2 = if at >= 2 { *dst.sub(2) } else { 0 } as usize;
                        while k >= 2 {
                            br.refill();
                            let t = *ltab.get_unchecked((*lut.add(p1) | *lut.add(256 + p2)) as usize);
                            p2 = read_sym(&mut br, t) as usize;
                            *dst = p2 as u8;
                            let t = *ltab.get_unchecked((*lut.add(p2) | *lut.add(256 + p1)) as usize);
                            p1 = read_sym(&mut br, t) as usize;
                            *dst.add(1) = p1 as u8;
                            dst = dst.add(2);
                            k -= 2;
                        }
                        if k != 0 {
                            br.refill();
                            let t = *ltab.get_unchecked((*lut.add(p1) | *lut.add(256 + p2)) as usize);
                            *dst = read_sym(&mut br, t) as u8;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                if op == end {
                    break Some(());
                }
            }

            let dist: usize;
            let mut push = false;
            if v & (1 << 18) != 0 {
                dist = d0 as usize;
            } else {
                if blen2 == 0 {
                    let (nbr, t, l) = switch(br, tabs, b, 2);
                    br = nbr;
                    blen2 = l;
                    fill_dtab(&mut dtab, t as usize);
                }
                blen2 = blen2.wrapping_sub(1);
                if br.bits < 39 {
                    br.refill();
                }
                let e = read_wide(&mut br, *dtab.get_unchecked(((v >> 19) & 3) as usize));
                push = e & D_PUSH != 0;
                if e & D_SHORT == 0 {
                    dist = (e >> 32) as usize + ((br.read(((e >> 8) & 31) as u32) << npostfix) as usize);
                } else {
                    let r = match (e >> 17) & 3 {
                        0 => d0,
                        1 => d1,
                        2 => d2,
                        _ => d3,
                    } as i32
                        + (e >> 24) as u8 as i8 as i32;
                    if r <= 0 {
                        break None; // ERROR_FORMAT_DISTANCE
                    }
                    dist = r as usize;
                }
            }
            let maxd = if op < mbd { op } else { mbd };
            if dist > maxd {
                // static dictionary reference (never enters the ring)
                if copy < 4 || copy > 24 {
                    break None;
                }
                let word_id = dist - maxd - 1;
                let shift = kBrotliDictionarySizeBitsByLength[copy] as usize;
                let tidx = word_id >> shift;
                if tidx >= 121 {
                    break None;
                }
                let woff = kBrotliDictionaryOffsetsByLength[copy] as usize + (word_id & ((1 << shift) - 1)) * copy;
                let word = &kBrotliDictionary[woff..woff + copy];
                let n = if tidx == 0 {
                    copy
                } else {
                    let mut buf = [0u8; 64];
                    let n = TransformDictionaryWord(&mut buf, word, copy as i32, tidx as i32) as usize;
                    if n > end - op {
                        break None;
                    }
                    core::ptr::copy_nonoverlapping(buf.as_ptr(), optr.add(op), n);
                    n
                };
                if n > end - op {
                    break None;
                }
                if tidx == 0 {
                    core::ptr::copy_nonoverlapping(word.as_ptr(), optr.add(op), n);
                }
                op += n;
            } else {
                if push {
                    d3 = d2;
                    d2 = d1;
                    d1 = d0;
                    d0 = dist as u32;
                }
                if copy > end - op {
                    break None;
                }
                copy_match(optr.add(op), dist, copy);
                op += copy;
            }
            if op == end {
                break Some(());
            }
        };
        self.out.set_len(op);
        self.br = br;
        self.dist = [d0, d1, d2, d3];
        res
    }
}
