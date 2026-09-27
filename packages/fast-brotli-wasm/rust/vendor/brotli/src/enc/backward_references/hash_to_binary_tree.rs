#![allow(dead_code, unused_imports)]
use super::{
    kDistanceCacheIndex, kDistanceCacheOffset, kHashMul32, kHashMul64, kHashMul64Long,
    kInvalidMatch, AnyHasher, BrotliEncoderParams, BrotliHasherParams, CloneWithAlloc, H9Opts,
    HasherSearchResult, HowPrepared, Struct1,
};
use alloc;
use alloc::{Allocator, SliceWrapper, SliceWrapperMut};
use core;
use core::cmp::{max, min};
use enc::command::{
    CombineLengthCodes, Command, CommandCopyLen, ComputeDistanceCode, GetCopyLengthCode,
    GetInsertLengthCode, InitCommand, PrefixEncodeCopyDistance,
};
use enc::constants::{kCopyExtra, kInsExtra};
use enc::dictionary_hash::kStaticDictionaryHash;
use enc::literal_cost::BrotliEstimateBitCostsForLiterals;
use enc::static_dict::{
    kBrotliEncDictionary, BrotliDictionary, BrotliFindAllStaticDictionaryMatches,
};
use enc::static_dict::{
    FindMatchLengthWithLimit, BROTLI_UNALIGNED_LOAD32, BROTLI_UNALIGNED_LOAD64,
};
use enc::util::{floatX, FastLog2, Log2FloorNonZero};

pub const kInfinity: floatX = 1.7e38 as floatX;
#[derive(Clone, Copy, Debug)]
pub enum Union1 {
    cost(floatX),
    next(u32),
    shortcut(u32),
}

#[derive(Clone, Copy, Debug)]
pub struct ZopfliNode {
    //highest 7 bit is used to reconstruct the length code
    pub length: u32,
    // distance associated with the length
    pub distance: u32,
    // number of literal inserts before the copy; highest 5 bits contain distance short code + 1 (or zero if no short code)
    pub dcode_insert_length: u32,
    pub u: Union1,
}
impl Default for ZopfliNode {
    fn default() -> Self {
        ZopfliNode {
            length: 1,
            distance: 0,
            dcode_insert_length: 0,
            u: Union1::cost(kInfinity),
        }
    }
}

pub trait Allocable<T: Copy, AllocT: Allocator<T>> {
    fn new(m: &mut AllocT, init: T) -> Self;
    fn new_uninit(m: &mut AllocT) -> Self;
    fn free(&mut self, m: &mut AllocT);
}
pub trait H10Params {
    fn max_tree_search_depth() -> u32;
    fn max_tree_comp_length() -> u32;
}

pub struct H10DefaultParams {}
impl H10Params for H10DefaultParams {
    #[inline(always)]
    fn max_tree_search_depth() -> u32 {
        64
    }
    #[inline(always)]
    fn max_tree_comp_length() -> u32 {
        128
    }
}

const BUCKET_BITS: usize = 17;

pub struct H10Buckets<AllocU32: Allocator<u32>>(AllocU32::AllocatedMemory);

impl<AllocU32: Allocator<u32>> Allocable<u32, AllocU32> for H10Buckets<AllocU32> {
    fn new(m: &mut AllocU32, initializer: u32) -> H10Buckets<AllocU32> {
        let mut ret = m.alloc_cell(1 << BUCKET_BITS);
        for item in ret.slice_mut().iter_mut() {
            *item = initializer;
        }
        H10Buckets::<AllocU32>(ret)
    }
    fn new_uninit(m: &mut AllocU32) -> H10Buckets<AllocU32> {
        H10Buckets::<AllocU32>(m.alloc_cell(1 << BUCKET_BITS))
    }
    fn free(&mut self, m: &mut AllocU32) {
        m.free_cell(core::mem::take(&mut self.0));
    }
}

impl<AllocU32: Allocator<u32>> PartialEq<H10Buckets<AllocU32>> for H10Buckets<AllocU32> {
    fn eq(&self, other: &H10Buckets<AllocU32>) -> bool {
        return self.0.slice() == other.0.slice();
    }
}

impl<AllocU32: Allocator<u32>> SliceWrapper<u32> for H10Buckets<AllocU32> {
    #[inline(always)]
    fn slice(&self) -> &[u32] {
        self.0.slice()
    }
}
impl<AllocU32: Allocator<u32>> SliceWrapperMut<u32> for H10Buckets<AllocU32> {
    #[inline(always)]
    fn slice_mut(&mut self) -> &mut [u32] {
        self.0.slice_mut()
    }
}

pub struct H10<
    AllocU32: Allocator<u32>,
    Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
> where
    Buckets: PartialEq<Buckets>,
{
    pub window_mask_: usize,
    pub common: Struct1,
    pub buckets_: Buckets,
    pub invalid_pos_: u32,
    pub forest: AllocU32::AllocatedMemory,
    pub _params: core::marker::PhantomData<Params>,
}

impl<
        AllocU32: Allocator<u32>,
        Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
        Params: H10Params,
    > PartialEq<H10<AllocU32, Buckets, Params>> for H10<AllocU32, Buckets, Params>
where
    Buckets: PartialEq<Buckets>,
{
    fn eq(&self, other: &H10<AllocU32, Buckets, Params>) -> bool {
        self.window_mask_ == other.window_mask_
            && self.common == other.common
            && self.buckets_ == other.buckets_
            && self.invalid_pos_ == other.invalid_pos_
            && self.forest.slice() == other.forest.slice()
            && self._params == other._params
    }
}

/// fast-brotli-wasm: total input size of the current one-shot compression
/// (0 = unknown). See initialize_h10.
pub static mut FAST_INPUT_SIZE_HINT: usize = 0;

pub fn InitializeH10<AllocU32: Allocator<u32>>(
    m32: &mut AllocU32,
    one_shot: bool,
    params: &BrotliEncoderParams,
    input_size: usize,
) -> H10<AllocU32, H10Buckets<AllocU32>, H10DefaultParams> {
    initialize_h10::<AllocU32, H10Buckets<AllocU32>>(m32, one_shot, params, input_size)
}
fn initialize_h10<
    AllocU32: Allocator<u32>,
    Buckets: SliceWrapperMut<u32> + SliceWrapper<u32> + Allocable<u32, AllocU32>,
>(
    m32: &mut AllocU32,
    one_shot: bool,
    params: &BrotliEncoderParams,
    input_size: usize,
) -> H10<AllocU32, Buckets, H10DefaultParams>
where
    Buckets: PartialEq<Buckets>,
{
    let mut num_nodes = 1 << params.lgwin;
    if one_shot && input_size < num_nodes {
        num_nodes = input_size;
    }
    // fast-brotli-wasm: when the caller knows the whole input (one-shot
    // compress through the streaming API), positions never reach past it, so
    // the forest (2 * 2^lgwin u32 = 32MB at lgwin 22) only needs that many
    // nodes. Every node is written before it is read, so this cannot change
    // the output.
    let hint = unsafe { FAST_INPUT_SIZE_HINT };
    if hint != 0 && hint < num_nodes {
        num_nodes = hint;
    }
    let window_mask = (1 << params.lgwin) - 1;
    let invalid_pos = 0u32.wrapping_sub(window_mask);
    let buckets = <Buckets as Allocable<u32, AllocU32>>::new(m32, invalid_pos);
    H10::<AllocU32, Buckets, H10DefaultParams> {
        common: Struct1 {
            params: params.hasher,
            is_prepared_: 1,
            dict_num_lookups: 0,
            dict_num_matches: 0,
        },
        _params: core::marker::PhantomData::<H10DefaultParams>,
        window_mask_: window_mask as usize,
        invalid_pos_: invalid_pos,
        buckets_: buckets,
        // fast-brotli-wasm: every forest node is written before it is read
        forest: m32.alloc_cell_uninit(num_nodes * 2),
    }
}

impl<
        AllocU32: Allocator<u32>,
        Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
        Params: H10Params,
    > H10<AllocU32, Buckets, Params>
where
    Buckets: PartialEq<Buckets>,
{
    pub fn free(&mut self, m32: &mut AllocU32) {
        m32.free_cell(core::mem::take(&mut self.forest));
        self.buckets_.free(m32);
    }
}
impl<
        Alloc: alloc::Allocator<u16> + alloc::Allocator<u32>,
        Buckets: Allocable<u32, Alloc> + SliceWrapperMut<u32> + SliceWrapper<u32>,
        Params: H10Params,
    > CloneWithAlloc<Alloc> for H10<Alloc, Buckets, Params>
where
    Buckets: PartialEq<Buckets>,
{
    fn clone_with_alloc(&self, m: &mut Alloc) -> Self {
        let mut ret = H10::<Alloc, Buckets, Params> {
            window_mask_: self.window_mask_,
            common: self.common.clone(),
            buckets_: Buckets::new_uninit(m),
            invalid_pos_: self.invalid_pos_,
            forest: <Alloc as Allocator<u32>>::alloc_cell(m, self.forest.len()),
            _params: core::marker::PhantomData::<Params>,
        };
        ret.buckets_
            .slice_mut()
            .clone_from_slice(self.buckets_.slice());
        ret.forest.slice_mut().clone_from_slice(self.forest.slice());
        ret
    }
}

impl<
        AllocU32: Allocator<u32>,
        Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
        Params: H10Params,
    > AnyHasher for H10<AllocU32, Buckets, Params>
where
    Buckets: PartialEq<Buckets>,
{
    /*  fn GetH10Tree(&mut self) -> Option<&mut H10<AllocU32, Buckets, H10Params>> {
      Some(self)
    }*/
    #[inline(always)]
    fn Opts(&self) -> H9Opts {
        H9Opts {
            literal_byte_score: 340,
        }
    }
    #[inline(always)]
    fn PrepareDistanceCache(&self, _distance_cache: &mut [i32]) {}
    #[inline(always)]
    fn HashTypeLength(&self) -> usize {
        4
    }
    #[inline(always)]
    fn StoreLookahead(&self) -> usize {
        Params::max_tree_comp_length() as usize
    }
    fn StitchToPreviousBlock(
        &mut self,
        num_bytes: usize,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
    ) {
        super::hq::StitchToPreviousBlockH10(self, num_bytes, position, ringbuffer, ringbuffer_mask)
    }
    #[inline(always)]
    fn GetHasherCommon(&mut self) -> &mut Struct1 {
        &mut self.common
    }
    #[inline(always)]
    fn HashBytes(&self, data: &[u8]) -> usize {
        let h = BROTLI_UNALIGNED_LOAD32(data).wrapping_mul(kHashMul32);
        (h >> (32i32 - BUCKET_BITS as i32)) as usize
    }
    #[inline(always)]
    fn Store(&mut self, data: &[u8], mask: usize, ix: usize) {
        let max_backward: usize = self.window_mask_.wrapping_sub(16).wrapping_add(1);
        StoreAndFindMatchesH10(
            self,
            data,
            ix,
            mask,
            Params::max_tree_comp_length() as usize,
            max_backward,
            &mut 0,
            &mut [],
        );
    }
    fn StoreRange(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) {
        let mut i: usize = ix_start;
        let mut j: usize = ix_start;
        if ix_start.wrapping_add(63) <= ix_end {
            i = ix_end.wrapping_sub(63);
        }
        if ix_start.wrapping_add(512) <= i {
            while j < i {
                {
                    self.Store(data, mask, j);
                }
                j = j.wrapping_add(8);
            }
        }
        while i < ix_end {
            {
                self.Store(data, mask, i);
            }
            i = i.wrapping_add(1);
        }
    }
    fn BulkStoreRange(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) {
        for i in ix_start..ix_end {
            self.Store(data, mask, i);
        }
    }
    fn Prepare(&mut self, _one_shot: bool, _input_size: usize, _data: &[u8]) -> HowPrepared {
        if self.common.is_prepared_ != 0 {
            return HowPrepared::ALREADY_PREPARED;
        }
        let invalid_pos = self.invalid_pos_;
        for bucket in self.buckets_.slice_mut().iter_mut() {
            *bucket = invalid_pos;
        }
        self.common.is_prepared_ = 1;
        HowPrepared::NEWLY_PREPARED
    }

    fn FindLongestMatch(
        &mut self,
        _dictionary: Option<&BrotliDictionary>,
        _dictionary_hash: &[u16],
        _data: &[u8],
        _ring_buffer_mask: usize,
        _distance_cache: &[i32],
        _cur_ix: usize,
        _max_length: usize,
        _max_backward: usize,
        _gap: usize,
        _max_distance: usize,
        _out: &mut HasherSearchResult,
    ) -> bool {
        unimplemented!();
    }
}

pub struct BackwardMatch(pub u64);

//    pub distance : u32,
//    pub length_and_code : u32,
impl BackwardMatch {
    #[inline(always)]
    pub fn distance(&self) -> u32 {
        self.0 as u32
    }
    #[inline(always)]
    pub fn length_and_code(&self) -> u32 {
        (self.0 >> 32) as u32
    }
}
pub struct BackwardMatchMut<'a>(pub &'a mut u64);

//    pub distance : u32,
//    pub length_and_code : u32,
impl<'a> BackwardMatchMut<'a> {
    #[inline(always)]
    pub fn distance(&self) -> u32 {
        *self.0 as u32
    }
    #[inline(always)]
    pub fn length_and_code(&self) -> u32 {
        (*self.0 >> 32) as u32
    }
    #[inline(always)]
    pub fn set_distance(&mut self, data: u32) {
        *self.0 &= 0xffffffff00000000;
        *self.0 |= u64::from(data)
    }
    #[inline(always)]
    pub fn set_length_and_code(&mut self, data: u32) {
        *self.0 = u64::from((*self.0) as u32) | (u64::from(data) << 32);
    }
    #[inline(always)]
    pub fn init(&mut self, dist: usize, len: usize) {
        self.set_distance(dist as u32);
        self.set_length_and_code((len << 5) as u32);
    }
    #[inline(always)]
    pub(crate) fn init_dictionary(&mut self, dist: usize, len: usize, len_code: usize) {
        self.set_distance(dist as u32);
        self.set_length_and_code((len << 5 | if len == len_code { 0 } else { len_code }) as u32);
    }
}

macro_rules! LeftChildIndexH10 {
    ($xself: expr, $pos: expr) => {
        (2usize).wrapping_mul($pos & (*$xself).window_mask_)
    };
}
macro_rules! RightChildIndexH10 {
    ($xself: expr, $pos: expr) => {
        (2usize)
            .wrapping_mul($pos & (*$xself).window_mask_)
            .wrapping_add(1)
    };
}
/*
fn LeftChildIndexH10<AllocU32: Allocator<u32>,
     Buckets: Allocable<u32, AllocU32>+SliceWrapperMut<u32>+SliceWrapper<u32>,
     Params:H10Params>(
    mut xself : &mut H10<AllocU32, Buckets, Params>, pos : usize
) -> usize {
    (2usize).wrapping_mul(pos & xself.window_mask_)
}

fn RightChildIndexH10<AllocU32: Allocator<u32>,
     Buckets: Allocable<u32, AllocU32>+SliceWrapperMut<u32>+SliceWrapper<u32>,
     Params:H10Params>(
    mut xself : &mut H10<AllocU32, Buckets, Params>, pos : usize
) -> usize {
    (2usize).wrapping_mul(
        pos & xself.window_mask_
    ).wrapping_add(
        1
    )
}
*/

pub fn StoreAndFindMatchesH10<
    AllocU32: Allocator<u32>,
    Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
>(
    xself: &mut H10<AllocU32, Buckets, Params>,
    data: &[u8],
    cur_ix: usize,
    ring_buffer_mask: usize,
    max_length: usize,
    max_backward: usize,
    best_len: &mut usize,
    matches: &mut [u64],
) -> usize
where
    Buckets: PartialEq<Buckets>,
{
    let mut matches_offset = 0usize;
    let cur_ix_masked: usize = cur_ix & ring_buffer_mask;
    let max_comp_len: usize = min(max_length, 128usize);
    let should_reroot_tree = max_length >= 128;
    let key = xself.HashBytes(&data[cur_ix_masked..]);
    let forest: &mut [u32] = xself.forest.slice_mut();
    let mut prev_ix: usize = xself.buckets_.slice()[key] as usize;
    let mut node_left: usize = LeftChildIndexH10!(xself, cur_ix);
    let mut node_right: usize = RightChildIndexH10!(xself, cur_ix);
    let mut best_len_left: usize = 0usize;
    let mut best_len_right: usize = 0usize;
    let mut depth_remaining: usize;
    if should_reroot_tree {
        xself.buckets_.slice_mut()[key] = cur_ix as u32;
    }
    depth_remaining = 64usize;
    // fast-brotli-wasm: the same walk; byte comparisons through raw pointers
    // after the original's slice bounds (both windows of max_length bytes)
    // are checked once per node, and the first 8 bytes of each extension
    // compared as one u64
    let invalid_pos = xself.invalid_pos_;
    let window_mask = xself.window_mask_;
    let dp = data.as_ptr();
    let dlen = data.len();
    loop {
        let backward: usize = cur_ix.wrapping_sub(prev_ix);
        let prev_ix_masked: usize = prev_ix & ring_buffer_mask;
        if backward == 0usize || backward > max_backward || depth_remaining == 0usize {
            if should_reroot_tree {
                forest[node_left] = invalid_pos;
                forest[node_right] = invalid_pos;
            }
            break;
        }
        let cur_len: usize = min(best_len_left, best_len_right);
        if cur_ix_masked.wrapping_add(max_length) > dlen
            || prev_ix_masked.wrapping_add(max_length) > dlen
            || cur_len > max_length
        {
            // (where the original's slicing panics)
            panic!("index out of range");
        }
        let len: usize = cur_len.wrapping_add(unsafe {
            MatchLengthPtr(
                dp.add(cur_ix_masked + cur_len),
                dp.add(prev_ix_masked + cur_len),
                max_length - cur_len,
            )
        });
        if matches_offset != matches.len() && (len > *best_len) {
            *best_len = len;
            BackwardMatchMut(&mut matches[matches_offset]).init(backward, len);
            matches_offset += 1;
        }
        let left_child: usize = 2 * (prev_ix & window_mask);
        if len >= max_comp_len {
            if should_reroot_tree {
                forest[node_left] = forest[left_child];
                forest[node_right] = forest[left_child + 1];
            }
            break;
        }
        // both children of prev_ix are loaded before the comparison decides
        // between them (the writes below never target them: path nodes are
        // distinct positions within the window)
        let children = (forest[left_child], forest[left_child + 1]);
        let go_left = unsafe { *dp.add(cur_ix_masked + len) > *dp.add(prev_ix_masked + len) };
        if go_left {
            best_len_left = len;
            if should_reroot_tree {
                forest[node_left] = prev_ix as u32;
            }
            node_left = left_child + 1;
        } else {
            best_len_right = len;
            if should_reroot_tree {
                forest[node_right] = prev_ix as u32;
            }
            node_right = left_child;
        }
        prev_ix = if go_left { children.1 } else { children.0 } as usize;
        depth_remaining = depth_remaining.wrapping_sub(1);
    }
    matches_offset
}

/// fast-brotli-wasm: FindMatchLengthWithLimit on raw pointers (both ranges of
/// `limit` bytes must be readable): the first 8 bytes as one u64 compare,
/// then 16 at a time.
#[inline(always)]
unsafe fn MatchLengthPtr(a: *const u8, b: *const u8, limit: usize) -> usize {
    if limit >= 8 {
        let x = (a as *const u64).read_unaligned() ^ (b as *const u64).read_unaligned();
        if x != 0 {
            return (u64::from_le(x).trailing_zeros() >> 3) as usize;
        }
        return 8 + FindMatchLengthWithLimit(
            core::slice::from_raw_parts(a.add(8), limit - 8),
            core::slice::from_raw_parts(b.add(8), limit - 8),
            limit - 8,
        );
    }
    let mut i = 0usize;
    while i < limit {
        if *a.add(i) != *b.add(i) {
            return i;
        }
        i += 1;
    }
    limit
}
