#![allow(dead_code)]
// fast-brotli-wasm: filled at the first encoder use by fast_tables::init()
// (the values are not stored in the module; see fast_tables.rs)
pub static mut kStaticDictionaryHash: [u16; 32768] = [0; 32768];

/// fast-brotli-wasm: the table, once fast_tables::init() has run
#[inline(always)]
pub fn static_dictionary_hash() -> &'static [u16; 32768] {
    unsafe { &*core::ptr::addr_of!(kStaticDictionaryHash) }
}
