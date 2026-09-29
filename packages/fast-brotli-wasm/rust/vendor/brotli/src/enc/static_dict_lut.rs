#![allow(dead_code)]
pub static kInvalidMatch: u32 = 0x0fff_ffff;

pub static kDictNumBits: i32 = 15;

pub static kDictHashMul32: u32 = 0x1e35_a7bd;
// fast-brotli-wasm: filled at the first encoder use by fast_tables::init()
// (the values are not stored in the module; see fast_tables.rs)
pub static mut kStaticDictionaryBuckets: [u16; 32768] = [0; 32768];

#[derive(Clone, Copy)]
#[repr(C)]
pub struct DictWord {
    pub l: u8,
    pub t: u8,
    pub i: u16,
}
impl DictWord {
    #[inline(always)]
    pub fn len(self) -> u8 {
        self.l
    }
    #[inline(always)]
    pub fn transform(self) -> u8 {
        self.t
    }
    #[inline(always)]
    pub fn idx(self) -> u16 {
        self.i
    }
}
type D = DictWord;

// fast-brotli-wasm: filled at the first encoder use by fast_tables::init()
// (the values are not stored in the module; see fast_tables.rs)
pub static mut kStaticDictionaryWords: [DictWord; 31705] = [DictWord { l: 0, t: 0, i: 0 }; 31705];

/// fast-brotli-wasm: kStaticDictionaryBuckets[h]
#[inline(always)]
pub fn dict_bucket(h: usize) -> u16 {
    unsafe { kStaticDictionaryBuckets[h] }
}
/// fast-brotli-wasm: kStaticDictionaryWords[k]
#[inline(always)]
pub fn dict_word(k: usize) -> DictWord {
    unsafe { kStaticDictionaryWords[k] }
}
