#![allow(dead_code, unused_imports)]
use super::hash_to_binary_tree::{
    kInfinity, Allocable, BackwardMatch, BackwardMatchMut, H10Params, StoreAndFindMatchesH10,
    Union1, ZopfliNode, H10,
};
use super::{
    kDistanceCacheIndex, kDistanceCacheOffset, kHashMul32, kHashMul64, kHashMul64Long,
    kInvalidMatch, AnyHasher, BrotliEncoderParams, BrotliHasherParams,
};
use alloc;
use alloc::{Allocator, SliceWrapper, SliceWrapperMut};
use core;
use core::cmp::{max, min};
use enc::command::{
    BrotliDistanceParams, CombineLengthCodes, Command, CommandCopyLen, ComputeDistanceCode,
    GetCopyLengthCode, GetInsertLengthCode, InitCommand, PrefixEncodeCopyDistance,
};
use enc::constants::{kCopyExtra, kInsExtra};
use enc::dictionary_hash::kStaticDictionaryHash;
use enc::encode;
use enc::literal_cost::BrotliEstimateBitCostsForLiterals;
use enc::static_dict::{
    kBrotliEncDictionary, BrotliDictionary, BrotliFindAllStaticDictionaryMatches,
};
use enc::static_dict::{
    FindMatchLengthWithLimit, BROTLI_UNALIGNED_LOAD32, BROTLI_UNALIGNED_LOAD64,
};
use enc::util::{floatX, FastLog2, FastLog2f64, Log2FloorNonZero};

const BROTLI_WINDOW_GAP: usize = 16;
const BROTLI_MAX_STATIC_DICTIONARY_MATCH_LEN: usize = 37;

/*
static kBrotliMinWindowBits: i32 = 10i32;

static kBrotliMaxWindowBits: i32 = 24i32;

static kInvalidMatch: u32 = 0xfffffffu32;

static kCutoffTransformsCount: u32 = 10u32;

static kCutoffTransforms: u64 = 0x71b520au64 << 32 | 0xda2d3200u32 as (u64);

pub static kHashMul32: u32 = 0x1e35a7bdu32;

pub static kHashMul64: u64 = 0x1e35a7bdu64 << 32 | 0x1e35a7bdu64;

pub static kHashMul64Long: u64 = 0x1fe35a7bu32 as (u64) << 32 | 0xd3579bd3u32 as (u64);

*/
pub const BROTLI_MAX_EFFECTIVE_DISTANCE_ALPHABET_SIZE: usize = 544;
pub const BROTLI_NUM_LITERAL_SYMBOLS: usize = 256;
pub const BROTLI_NUM_COMMAND_SYMBOLS: usize = 704;

pub const BROTLI_SIMPLE_DISTANCE_ALPHABET_SIZE: usize = encode::BROTLI_NUM_DISTANCE_SHORT_CODES
    as usize
    + (2 * encode::BROTLI_LARGE_MAX_DISTANCE_BITS as usize);

#[inline(always)]
pub fn BrotliInitZopfliNodes(array: &mut [ZopfliNode], length: usize) {
    let stub = ZopfliNode::default();
    let mut i: usize;
    i = 0usize;
    while i < length {
        array[i] = stub;
        i = i.wrapping_add(1);
    }
}

impl ZopfliNode {
    #[inline(always)]
    fn copy_length(&self) -> u32 {
        self.length & 0x01ff_ffff
    }

    #[inline(always)]
    fn copy_distance(&self) -> u32 {
        self.distance
    }

    #[inline(always)]
    fn length_code(&self) -> u32 {
        self.copy_length()
            .wrapping_add(9)
            .wrapping_sub(self.length >> 25)
    }
}

impl ZopfliNode {
    #[inline(always)]
    fn distance_code(&self) -> u32 {
        let short_code: u32 = self.dcode_insert_length >> 27;
        if short_code == 0u32 {
            self.copy_distance().wrapping_add(16).wrapping_sub(1)
        } else {
            short_code.wrapping_sub(1)
        }
    }
}

pub fn BrotliZopfliCreateCommands(
    num_bytes: usize,
    block_start: usize,
    max_backward_limit: usize,
    nodes: &[ZopfliNode],
    dist_cache: &mut [i32],
    last_insert_len: &mut usize,
    params: &BrotliEncoderParams,
    commands: &mut [Command],
    num_literals: &mut usize,
) {
    let mut pos: usize = 0usize;
    let mut offset: u32 = match (nodes[0]).u {
        Union1::next(off) => off,
        _ => 0,
    };
    let mut i: usize;
    let gap: usize = 0usize;
    i = 0usize;
    while offset != !(0u32) {
        {
            let next: &ZopfliNode = &nodes[pos.wrapping_add(offset as usize)];
            let copy_length = next.copy_length() as usize;
            let mut insert_length: usize = (next.dcode_insert_length & 0x07ff_ffff) as usize;
            pos = pos.wrapping_add(insert_length);
            offset = match next.u {
                Union1::next(off) => off,
                _ => 0,
            };
            if i == 0usize {
                insert_length = insert_length.wrapping_add(*last_insert_len);
                *last_insert_len = 0usize;
            }
            {
                let distance: usize = next.copy_distance() as usize;
                let len_code: usize = next.length_code() as usize;
                let max_distance: usize = min(block_start.wrapping_add(pos), max_backward_limit);
                let is_dictionary = distance > max_distance.wrapping_add(gap);
                let dist_code: usize = next.distance_code() as usize;
                InitCommand(
                    &mut commands[i],
                    &params.dist,
                    insert_length,
                    copy_length,
                    len_code,
                    dist_code,
                );
                if !is_dictionary && dist_code > 0 {
                    dist_cache[3] = dist_cache[2];
                    dist_cache[2] = dist_cache[1];
                    dist_cache[1] = dist_cache[0];
                    dist_cache[0] = distance as i32;
                }
            }
            *num_literals = num_literals.wrapping_add(insert_length);
            pos = pos.wrapping_add(copy_length);
        }
        i = i.wrapping_add(1);
    }
    *last_insert_len = last_insert_len.wrapping_add(num_bytes.wrapping_sub(pos));
}

#[inline(always)]
fn MaxZopfliLen(params: &BrotliEncoderParams) -> usize {
    (if params.quality <= 10i32 {
        150i32
    } else {
        325i32
    }) as usize
}

pub struct ZopfliCostModel<AllocF: Allocator<floatX>> {
    pub cost_cmd_: [floatX; BROTLI_NUM_COMMAND_SYMBOLS],
    pub cost_dist_: AllocF::AllocatedMemory,
    pub distance_histogram_size: u32,
    pub literal_costs_: AllocF::AllocatedMemory,
    pub min_cost_cmd_: floatX,
    pub num_bytes_: usize,
}

#[derive(Copy, Clone, Debug)]
pub struct PosData {
    pub pos: usize,
    pub distance_cache: [i32; 4],
    pub costdiff: floatX,
    pub cost: floatX,
}

/// fast-brotli-wasm: the original keeps the 8 best start positions in a ring
/// (sorted by costdiff; a new entry goes before entries with an equal
/// costdiff and the last one is dropped when full). Entries never move towards
/// the front, and UpdateNodes only reads the first MaxZopfliCandidates, so
/// the queue here is a plain sorted array of that many entries: the entries
/// it holds are exactly the first `cap_` of the original's.
#[derive(Copy, Clone, Debug)]
pub struct StartPosQueue {
    pub q_: [PosData; 8],
    pub idx_: usize, // number of entries
    cap_: usize,
}
impl Default for StartPosQueue {
    #[inline(always)]
    fn default() -> Self {
        StartPosQueue {
            q_: [PosData {
                pos: 0,
                distance_cache: [0; 4],
                costdiff: 0.0,
                cost: 0.0,
            }; 8],
            idx_: 0,
            cap_: 8,
        }
    }
}

#[inline(always)]
fn StoreLookaheadH10() -> usize {
    128usize
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    fn init(m: &mut AllocF, dist: &BrotliDistanceParams, num_bytes: usize) -> Self {
        Self {
            num_bytes_: num_bytes,
            cost_cmd_: [0.0; 704],
            min_cost_cmd_: 0.0,
            literal_costs_: if num_bytes.wrapping_add(2) > 0usize {
                m.alloc_cell(num_bytes.wrapping_add(2))
            } else {
                AllocF::AllocatedMemory::default()
            },
            cost_dist_: if dist.alphabet_size > 0u32 {
                m.alloc_cell(num_bytes.wrapping_add(dist.alphabet_size as usize))
            } else {
                AllocF::AllocatedMemory::default()
            },
            distance_histogram_size: min(dist.alphabet_size, 544),
        }
    }

    fn set_from_literal_costs(
        &mut self,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
    ) {
        let literal_costs = self.literal_costs_.slice_mut();
        let mut literal_carry: floatX = 0.0;
        let cost_dist = self.cost_dist_.slice_mut();
        let cost_cmd = &mut self.cost_cmd_[..];
        let num_bytes: usize = self.num_bytes_;
        BrotliEstimateBitCostsForLiterals(
            position,
            num_bytes,
            ringbuffer_mask,
            ringbuffer,
            &mut literal_costs[1..],
        );
        literal_costs[0] = 0.0 as (floatX);
        for i in 0usize..num_bytes {
            literal_carry = literal_carry as floatX + literal_costs[i.wrapping_add(1)] as floatX;
            literal_costs[i.wrapping_add(1)] =
                (literal_costs[i] as floatX + literal_carry) as floatX;
            literal_carry -=
                (literal_costs[i.wrapping_add(1)] as floatX - literal_costs[i] as floatX);
        }
        for i in 0..BROTLI_NUM_COMMAND_SYMBOLS {
            cost_cmd[i] = FastLog2(11 + i as u64);
        }
        for i in 0usize..self.distance_histogram_size as usize {
            cost_dist[i] = FastLog2((20u64).wrapping_add(i as (u64))) as (floatX);
        }
        self.min_cost_cmd_ = FastLog2(11) as (floatX);
    }
}

#[inline(always)]
fn InitStartPosQueue(params: &BrotliEncoderParams) -> StartPosQueue {
    let mut q = StartPosQueue::default();
    q.cap_ = MaxZopfliCandidates(params);
    q
}

#[inline(always)]
fn HashBytesH10(data: &[u8]) -> u32 {
    let h: u32 = BROTLI_UNALIGNED_LOAD32(data).wrapping_mul(kHashMul32);
    h >> (32i32 - 17i32)
}

pub fn StitchToPreviousBlockH10<
    AllocU32: Allocator<u32>,
    Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
>(
    handle: &mut H10<AllocU32, Buckets, Params>,
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
) where
    Buckets: PartialEq<Buckets>,
{
    if (num_bytes >= handle.HashTypeLength() - 1
        && position >= Params::max_tree_comp_length() as usize)
    {
        /* Store the last `MAX_TREE_COMP_LENGTH - 1` positions in the hasher.
        These could not be calculated before, since they require knowledge
        of both the previous and the current block. */
        let i_start = position - Params::max_tree_comp_length() as usize;
        let i_end = min(position, i_start.wrapping_add(num_bytes));
        for i in i_start..i_end {
            /* Maximum distance is window size - 16, see section 9.1. of the spec.
            Furthermore, we have to make sure that we don't look further back
            from the start of the next block than the window size, otherwise we
            could access already overwritten areas of the ring-buffer. */
            let max_backward = handle.window_mask_ - max(BROTLI_WINDOW_GAP - 1, position - i);
            let mut _best_len = 0;
            /* We know that i + MAX_TREE_COMP_LENGTH <= position + num_bytes, i.e. the
            end of the current block and that we have at least
            MAX_TREE_COMP_LENGTH tail in the ring-buffer. */
            StoreAndFindMatchesH10(
                handle,
                ringbuffer,
                i,
                ringbuffer_mask,
                <Params as H10Params>::max_tree_comp_length() as usize,
                max_backward,
                &mut _best_len,
                &mut [],
            );
        }
    }
}
fn FindAllMatchesH10<
    AllocU32: Allocator<u32>,
    Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
>(
    handle: &mut H10<AllocU32, Buckets, Params>,
    dictionary: Option<&BrotliDictionary>,
    data: &[u8],
    ring_buffer_mask: usize,
    cur_ix: usize,
    max_length: usize,
    max_backward: usize,
    gap: usize,
    params: &BrotliEncoderParams,
    matches: &mut [u64],
) -> usize
where
    Buckets: PartialEq<Buckets>,
{
    let mut matches_offset = 0usize;
    let cur_ix_masked: usize = cur_ix & ring_buffer_mask;
    let mut best_len: usize = 1usize;
    let short_match_max_backward: usize = (if params.quality != 11i32 {
        16i32
    } else {
        64i32
    }) as usize;
    let mut stop: usize = cur_ix.wrapping_sub(short_match_max_backward);
    let mut dict_matches = [kInvalidMatch; BROTLI_MAX_STATIC_DICTIONARY_MATCH_LEN + 1];
    let mut i: usize;
    if cur_ix < short_match_max_backward {
        stop = 0usize;
    }
    i = cur_ix.wrapping_sub(1);
    // fast-brotli-wasm: the scan below looks for the nearest earlier positions
    // (at most 15 or 63 back) whose first two bytes match. When those 64 bytes are
    // contiguous in the ring buffer, the candidates are found with SIMD and
    // visited in the same order (nearest first) with the same checks.
    #[cfg(target_arch = "wasm32")]
    if cur_ix >= short_match_max_backward
        && cur_ix_masked >= short_match_max_backward
        && cur_ix_masked.wrapping_add(1) < data.len()
        && max_backward >= short_match_max_backward - 1
    {
        unsafe {
            use core::arch::wasm32::*;
            let w = short_match_max_backward; // 16 or 64
            let base = data.as_ptr().add(cur_ix_masked - w);
            let c0 = u8x16_splat(data[cur_ix_masked]);
            let c1 = u8x16_splat(data[cur_ix_masked + 1]);
            let mut mask = 0u64;
            let mut q = 0;
            while q < w / 16 {
                let a = v128_load(base.add(q * 16) as *const v128);
                let b = v128_load(base.add(q * 16 + 1) as *const v128);
                let m = u8x16_bitmask(v128_and(u8x16_eq(a, c0), u8x16_eq(b, c1))) as u64;
                mask |= m << (q * 16);
                q += 1;
            }
            // bit t <-> position cur_ix - w + t; the loop covers t = 1..w-1
            mask &= !1u64;
            while mask != 0 && best_len <= 2 {
                let t = 63 - mask.leading_zeros() as usize;
                mask &= !(1u64 << t);
                let backward = w - t;
                let prev_ix = cur_ix_masked - backward;
                let len: usize =
                    FindMatchLengthWithLimit(&data[prev_ix..], &data[cur_ix_masked..], max_length);
                if len > best_len {
                    best_len = len;
                    BackwardMatchMut(&mut matches[matches_offset]).init(backward, len);
                    matches_offset += 1;
                }
            }
        }
        i = stop;
    }
    'break14: while i > stop && (best_len <= 2usize) {
        'continue15: loop {
            {
                let mut prev_ix: usize = i;
                let backward: usize = cur_ix.wrapping_sub(prev_ix);
                if backward > max_backward {
                    break 'break14;
                }
                prev_ix &= ring_buffer_mask;
                if data[cur_ix_masked] as i32 != data[prev_ix] as i32
                    || data[cur_ix_masked.wrapping_add(1)] as i32
                        != data[prev_ix.wrapping_add(1)] as i32
                {
                    break 'continue15;
                }
                {
                    let len: usize = FindMatchLengthWithLimit(
                        &data[prev_ix..],
                        &data[cur_ix_masked..],
                        max_length,
                    );
                    if len > best_len {
                        best_len = len;
                        BackwardMatchMut(&mut matches[matches_offset]).init(backward, len);
                        matches_offset += 1;
                    }
                }
            }
            break;
        }
        i = i.wrapping_sub(1);
    }
    if best_len < max_length {
        let loc_offset = StoreAndFindMatchesH10(
            handle,
            data,
            cur_ix,
            ring_buffer_mask,
            max_length,
            max_backward,
            &mut best_len,
            matches.split_at_mut(matches_offset).1,
        );
        matches_offset += loc_offset;
    }
    // fast-brotli-wasm: dict_matches is still all kInvalidMatch here (the
    // original clears it again), and the search is skipped when no length it
    // could report would be read (minlen > maxlen): it has no other effect
    {
        let minlen = max(4, best_len.wrapping_add(1));
        if dictionary.is_some()
            && minlen <= min(37, max_length)
            && BrotliFindAllStaticDictionaryMatches(
                dictionary.unwrap(),
                &data[cur_ix_masked..],
                minlen,
                max_length,
                &mut dict_matches[..],
            ) != 0
        {
            assert!(params.use_dictionary);
            let maxlen = min(37, max_length);
            for l in minlen..=maxlen {
                let dict_id: u32 = dict_matches[l];
                if dict_id < kInvalidMatch {
                    let distance: usize = max_backward
                        .wrapping_add(gap)
                        .wrapping_add((dict_id >> 5) as usize)
                        .wrapping_add(1);
                    if distance <= params.dist.max_distance {
                        BackwardMatchMut(&mut matches[matches_offset]).init_dictionary(
                            distance,
                            l,
                            (dict_id & 31u32) as usize,
                        );
                        matches_offset += 1;
                    }
                }
            }
        }
    }
    matches_offset
}

#[inline(always)]
fn BackwardMatchLength(xself: &BackwardMatch) -> usize {
    (xself.length_and_code() >> 5) as usize
}

#[inline(always)]
fn MaxZopfliCandidates(params: &BrotliEncoderParams) -> usize {
    (if params.quality <= 10i32 { 1i32 } else { 5i32 }) as usize
}

#[inline(always)]
fn ComputeDistanceShortcut(
    block_start: usize,
    pos: usize,
    max_backward: usize,
    gap: usize,
    nodes: &[ZopfliNode],
) -> u32 {
    let clen: usize = nodes[pos].copy_length() as usize;
    let ilen: usize = ((nodes[pos]).dcode_insert_length) as usize & 0x07ff_ffff;
    let dist: usize = nodes[pos].copy_distance() as usize;
    if pos == 0usize {
        0u32
    } else if dist.wrapping_add(clen) <= block_start.wrapping_add(pos).wrapping_add(gap)
        && dist <= max_backward.wrapping_add(gap)
        && nodes[pos].distance_code() > 0
    {
        pos as u32
    } else {
        match (nodes[(pos.wrapping_sub(clen).wrapping_sub(ilen) as usize)]).u {
            Union1::shortcut(shrt) => shrt,
            _ => 0,
        }
    }
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    #[inline(always)]
    fn get_literal_costs(&self, from: usize, to: usize) -> floatX {
        self.literal_costs_.slice()[to] - self.literal_costs_.slice()[from]
    }
}

fn ComputeDistanceCache(
    pos: usize,
    mut starting_dist_cache: &[i32],
    nodes: &[ZopfliNode],
    dist_cache: &mut [i32],
) {
    let mut idx: i32 = 0i32;
    let mut p: usize = match (nodes[pos]).u {
        Union1::shortcut(shrt) => shrt,
        _ => 0,
    } as usize;
    while idx < 4i32 && (p > 0usize) {
        let ilen: usize = ((nodes[p]).dcode_insert_length) as usize & 0x07ff_ffff;
        let clen = nodes[p].copy_length() as usize;
        let dist = nodes[p].copy_distance() as usize;
        dist_cache[({
            let _old = idx;
            idx += 1;
            _old
        } as usize)] = dist as i32;
        p = match (nodes[(p.wrapping_sub(clen).wrapping_sub(ilen) as usize)]).u {
            Union1::shortcut(shrt) => shrt,
            _ => 0,
        } as usize;
    }
    while idx < 4i32 {
        {
            dist_cache[(idx as usize)] = {
                let (_old, _upper) = starting_dist_cache.split_at(1);
                starting_dist_cache = _upper;
                _old[0]
            };
        }
        idx += 1;
    }
}

#[inline(always)]
fn StartPosQueueSize(xself: &StartPosQueue) -> usize {
    xself.idx_
}

#[inline(always)]
fn StartPosQueuePush(xself: &mut StartPosQueue, posdata: &PosData) {
    // the original moves the new entry back past every entry with a smaller
    // costdiff (costdiffs are never NaN here)
    let cap = xself.cap_;
    let q: &mut [PosData; 8] = &mut xself.q_;
    let mut i = xself.idx_;
    if i >= cap {
        // behind the last visible entry: never visible
        if posdata.costdiff > q[cap - 1].costdiff {
            return;
        }
        i = cap - 1;
    } else {
        xself.idx_ = i + 1;
    }
    while i > 0 && !(posdata.costdiff > q[i - 1].costdiff) {
        q[i] = q[i - 1];
        i -= 1;
    }
    q[i] = *posdata;
}

/// fast-brotli-wasm: EvaluateNode with ComputeDistanceShortcut inlined and
/// ComputeDistanceCache replaced by a table: the distance cache that
/// ComputeDistanceCache(pos) builds is F(S(pos)) for S = the node shortcut,
/// with F(0) = starting_dist_cache and, for a position p whose shortcut is p,
/// F(p) = [dist(p), F(S(p - clen(p) - ilen(p)))[0..3]]. Nodes at and before
/// pos are final, so F(p) is stored in `dcs[p]` when p is evaluated and the
/// chain walk becomes one load.
fn EvaluateNode<AllocF: Allocator<floatX>>(
    block_start: usize,
    pos: usize,
    max_backward_limit: usize,
    gap: usize,
    starting_dist_cache: &[i32],
    model: &ZopfliCostModel<AllocF>,
    queue: &mut StartPosQueue,
    nodes: &mut [ZopfliNode],
    dcs: &mut [[i32; 4]],
) {
    let node = nodes[pos];
    let node_cost: floatX = match node.u {
        Union1::cost(cst) => cst,
        _ => 0.0,
    };
    let starting = [
        starting_dist_cache[0],
        starting_dist_cache[1],
        starting_dist_cache[2],
        starting_dist_cache[3],
    ];
    let shortcut: u32 = if pos == 0usize {
        0
    } else {
        let clen: usize = node.copy_length() as usize;
        let ilen: usize = node.dcode_insert_length as usize & 0x07ff_ffff;
        let dist: usize = node.copy_distance() as usize;
        let prev_shortcut = match nodes[pos.wrapping_sub(clen).wrapping_sub(ilen)].u {
            Union1::shortcut(shrt) => shrt,
            _ => 0,
        };
        if dist.wrapping_add(clen) <= block_start.wrapping_add(pos).wrapping_add(gap)
            && dist <= max_backward_limit.wrapping_add(gap)
            && node.distance_code() > 0
        {
            let g = if prev_shortcut == 0 {
                starting
            } else {
                dcs[prev_shortcut as usize]
            };
            dcs[pos] = [dist as i32, g[0], g[1], g[2]];
            pos as u32
        } else {
            prev_shortcut
        }
    };
    (nodes[pos]).u = Union1::shortcut(shortcut);
    if node_cost <= model.get_literal_costs(0, pos) {
        let mut posdata = PosData {
            pos,
            cost: node_cost,
            costdiff: node_cost - model.get_literal_costs(0, pos),
            distance_cache: if shortcut == 0 {
                starting
            } else {
                dcs[shortcut as usize]
            },
        };
        StartPosQueuePush(queue, &mut posdata);
    }
}

/// fast-brotli-wasm: scratch table for EvaluateNode (one entry per node,
/// written before it is read)
fn ZopfliDistanceCaches(n: usize) -> std::vec::Vec<[i32; 4]> {
    let mut v = std::vec::Vec::with_capacity(n);
    unsafe { v.set_len(n) };
    v
}

#[inline(always)]
fn StartPosQueueAt(xself: &StartPosQueue, k: usize) -> &PosData {
    &xself.q_[k & 7]
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    #[inline(always)]
    fn get_min_cost_cmd(&self) -> floatX {
        self.min_cost_cmd_
    }
}

/// fast-brotli-wasm: same loop as the original (first length whose node
/// costs more than the running threshold), over the dense `costs` and four
/// nodes at a time within each stretch of constant threshold.
#[inline(always)]
fn ComputeMinimumCopyLength(
    start_cost: floatX,
    costs: &[floatX],
    num_bytes: usize,
    pos: usize,
) -> usize {
    let mut min_cost: floatX = start_cost;
    let mut len: usize = 2usize;
    let mut next_len_bucket: usize = 4usize;
    let mut next_len_offset: usize = 10usize;
    let limit = num_bytes.wrapping_sub(pos); // pos + len <= num_bytes
    if pos.wrapping_add(len) > num_bytes {
        return len;
    }
    let _ = &costs[num_bytes];
    loop {
        let seg_end = min(next_len_offset - 1, limit);
        #[cfg(target_arch = "wasm32")]
        unsafe {
            use core::arch::wasm32::*;
            let t = f32x4_splat(min_cost);
            let base = costs.as_ptr().add(pos);
            while len + 3 <= seg_end {
                let ok = i32x4_bitmask(f32x4_le(v128_load(base.add(len) as *const v128), t));
                if ok != 15 {
                    return len + (!ok).trailing_zeros() as usize;
                }
                len += 4;
            }
        }
        while len <= seg_end {
            if !(unsafe { *costs.get_unchecked(pos + len) } <= min_cost) {
                return len;
            }
            len += 1;
        }
        if len > limit {
            return len;
        }
        min_cost += 1.0 as floatX;
        next_len_offset = next_len_offset.wrapping_add(next_len_bucket);
        next_len_bucket = next_len_bucket.wrapping_mul(2);
    }
}

/// fast-brotli-wasm: dense copy of the nodes' costs for UpdateNodes. Nodes
/// after the current position are always in the `cost` state there, so the
/// copy only needs to follow cost updates.
fn ZopfliCosts(nodes: &[ZopfliNode], n: usize) -> std::vec::Vec<floatX> {
    let mut v = std::vec::Vec::with_capacity(n + 4);
    for node in &nodes[..n] {
        v.push(match node.u {
            Union1::cost(c) => c,
            _ => 0.0,
        });
    }
    v.resize(n + 4, kInfinity);
    v
}

#[inline(always)]
fn GetInsertExtra(inscode: u16) -> u32 {
    kInsExtra[(inscode as usize)]
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    #[inline(always)]
    fn get_distance_cost(&self, distcode: usize) -> floatX {
        self.cost_dist_.slice()[distcode]
    }
}

#[inline(always)]
fn GetCopyExtra(copycode: u16) -> u32 {
    // fast-brotli-wasm: copy length codes are < 24 by construction
    debug_assert!((copycode as usize) < kCopyExtra.len());
    unsafe { *kCopyExtra.get_unchecked(copycode as usize) }
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    #[inline(always)]
    fn get_command_cost(&self, cmdcode: u16) -> floatX {
        // fast-brotli-wasm: command codes are < 704 by construction
        debug_assert!((cmdcode as usize) < BROTLI_NUM_COMMAND_SYMBOLS);
        unsafe { *self.cost_cmd_.get_unchecked(cmdcode as usize) }
    }
}

/// fast-brotli-wasm: (GetCopyLengthCode(l), CopyLengthCodeRunEnd(l)) for
/// l < 134 as (code | run_end << 8).
const fn copy_code_table() -> [u16; 134] {
    let mut t = [0u16; 134];
    let mut l = 2;
    while l < 134 {
        let (code, end) = if l < 10 {
            (l - 2, l)
        } else {
            let nbits = (63 - ((l - 6) as u64).leading_zeros()) as usize - 1;
            (((nbits << 1) + ((l - 6) >> nbits) + 4), ((l - 6) | ((1 << nbits) - 1)) + 6)
        };
        t[l] = (code | end << 8) as u16;
        l += 1;
    }
    t
}
static COPY_CODE_TABLE: [u16; 134] = copy_code_table();

/// fast-brotli-wasm: (GetCopyLengthCode(l), CopyLengthCodeRunEnd(l)).
#[inline(always)]
fn CopyCodeAndRunEnd(l: usize) -> (u16, usize) {
    if l < 134 {
        let e = COPY_CODE_TABLE[l];
        ((e & 0xff) as u16, (e >> 8) as usize)
    } else {
        (GetCopyLengthCode(l), CopyLengthCodeRunEnd(l))
    }
}

/// fast-brotli-wasm: last copy length with the same GetCopyLengthCode as `l`.
#[inline(always)]
pub(crate) fn CopyLengthCodeRunEnd(l: usize) -> usize {
    if l < 10 {
        l
    } else if l < 134 {
        let nbits = Log2FloorNonZero((l - 6) as u64) - 1;
        ((l - 6) | ((1usize << nbits) - 1)) + 6
    } else if l < 2118 {
        let b = Log2FloorNonZero((l - 70) as u64);
        (1usize << (b + 1)) - 1 + 70
    } else {
        usize::MAX
    }
}

/// fast-brotli-wasm: copy lengths below LEN_TABLE have their command costs
/// (per insert length code) in tables, so that the lengths of a match are
/// relaxed four at a time with the original float operations:
/// cost(l) = (d + kCopyExtra[code(l)]) + cost_cmd[CombineLengthCodes(ins, code(l), _)].
const LEN_TABLE: usize = 336;
/// rows of the use_last_distance table (insert codes < 8, copy codes < 16,
/// i.e. lengths < 70, give command codes < 128)
const LEN_TABLE1: usize = 76;

const fn copy_code_const(l: usize) -> usize {
    if l < 10 {
        l - 2
    } else if l < 134 {
        let nbits = (63 - ((l - 6) as u64).leading_zeros()) as usize - 1;
        (nbits << 1) + ((l - 6) >> nbits) + 4
    } else if l < 2118 {
        (63 - ((l - 70) as u64).leading_zeros()) as usize + 12
    } else {
        23
    }
}

const fn copy_extra_table() -> [floatX; LEN_TABLE] {
    const EXTRA: [u32; 24] = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
    ];
    let mut t = [0.0 as floatX; LEN_TABLE];
    let mut l = 2;
    while l < LEN_TABLE {
        t[l] = EXTRA[copy_code_const(l)] as floatX;
        l += 1;
    }
    t
}
/// kCopyExtra[GetCopyLengthCode(l)] as floatX
static COPY_EXTRA_F: [floatX; LEN_TABLE] = copy_extra_table();

pub(crate) struct LenCosts {
    // row ic: cost_cmd[CombineLengthCodes(ic, GetCopyLengthCode(l), 0)], l < limit
    t0: std::vec::Vec<floatX>,
    // row ic < 8: cost_cmd[CombineLengthCodes(ic, GetCopyLengthCode(l), 1)], l < LEN_TABLE1
    t1: std::vec::Vec<floatX>,
    built0: u32,
    built1: u32,
    // filled entries per t0 row
    limit: usize,
    // dom[a] bit b: cost_cmd[CombineLengthCodes(b, c, 0)] >= that of (a, c) for
    // every copy code c (valid when bit b of dom_built_pairs[a] is set)
    dom: [u32; 24],
    dom_built_pairs: [u32; 24],
}

impl LenCosts {
    fn new(num_bytes: usize) -> Self {
        let mut t0 = std::vec::Vec::with_capacity(24 * LEN_TABLE);
        let mut t1 = std::vec::Vec::with_capacity(8 * LEN_TABLE1);
        // (rows are filled when first used, and only filled entries are read)
        unsafe {
            t0.set_len(24 * LEN_TABLE);
            t1.set_len(8 * LEN_TABLE1);
        }
        LenCosts {
            t0,
            t1,
            built0: 0,
            built1: 0,
            limit: min(LEN_TABLE, num_bytes.wrapping_add(4)),
            dom: [0; 24],
            dom_built_pairs: [0; 24],
        }
    }
    /// fast-brotli-wasm: whether every command cost with insert code `b` is >=
    /// the one with insert code `a` and the same copy length code
    #[inline(always)]
    fn dominates<AllocF: Allocator<floatX>>(&mut self, a: usize, b: usize, model: &ZopfliCostModel<AllocF>) -> bool {
        let bit = 1u32 << b;
        if self.dom_built_pairs[a] & bit == 0 {
            let mut ok = true;
            for c in 0..24u16 {
                let ca = model.get_command_cost(CombineLengthCodes(a as u16, c, 0));
                let cb = model.get_command_cost(CombineLengthCodes(b as u16, c, 0));
                if !(cb >= ca) {
                    ok = false;
                    break;
                }
            }
            if ok {
                self.dom[a] |= bit;
            }
            self.dom_built_pairs[a] |= bit;
        }
        self.dom[a] & bit != 0
    }
    /// last length that RelaxVec may start a group at with the t0 rows
    #[inline(always)]
    fn vec_end(&self) -> usize {
        self.limit.wrapping_sub(4)
    }
    #[inline(always)]
    fn row0<AllocF: Allocator<floatX>>(&mut self, ic: usize, model: &ZopfliCostModel<AllocF>) -> *const floatX {
        if self.built0 & (1u32 << ic) == 0 {
            self.build0(ic, model);
        }
        unsafe { self.t0.as_ptr().add(ic * LEN_TABLE) }
    }
    #[inline(always)]
    fn row1<AllocF: Allocator<floatX>>(&mut self, ic: usize, model: &ZopfliCostModel<AllocF>) -> *const floatX {
        if self.built1 & (1u32 << ic) == 0 {
            self.build1(ic, model);
        }
        unsafe { self.t1.as_ptr().add(ic * LEN_TABLE1) }
    }
    #[inline(never)]
    fn build0<AllocF: Allocator<floatX>>(&mut self, ic: usize, model: &ZopfliCostModel<AllocF>) {
        let row = &mut self.t0[ic * LEN_TABLE..ic * LEN_TABLE + self.limit];
        FillLenRow(row, ic, 0, model);
        self.built0 |= 1u32 << ic;
    }
    #[inline(never)]
    fn build1<AllocF: Allocator<floatX>>(&mut self, ic: usize, model: &ZopfliCostModel<AllocF>) {
        let row = &mut self.t1[ic * LEN_TABLE1..(ic + 1) * LEN_TABLE1];
        FillLenRow(row, ic, 1, model);
        self.built1 |= 1u32 << ic;
    }
}

/// fast-brotli-wasm: row[l] = cost_cmd[CombineLengthCodes(ic, GetCopyLengthCode(l), last)]
/// for 2 <= l < row.len(), one lookup per copy length code
fn FillLenRow<AllocF: Allocator<floatX>>(row: &mut [floatX], ic: usize, last: i32, model: &ZopfliCostModel<AllocF>) {
    let n = row.len();
    let mut l = 2usize;
    while l < n {
        let (code, end) = CopyCodeAndRunEnd(l);
        let v = model.get_command_cost(CombineLengthCodes(ic as u16, code, last));
        let e = min(end.wrapping_add(1), n);
        for x in &mut row[l..e] {
            *x = v;
        }
        l = e;
    }
}

/// fast-brotli-wasm: relax nodes pos+from ..= pos+to (2 <= from, `row` filled
/// up to to + 3) with cost(l) = (d + COPY_EXTRA_F[l]) + row[l], len_code = l,
/// four lengths at a time. Each node is compared once, so the order does not
/// matter.
#[inline(always)]
fn RelaxVec(
    costs: &mut [floatX],
    nodes: &mut [ZopfliNode],
    pos: usize,
    start: usize,
    from: usize,
    to: usize,
    d: floatX,
    row: *const floatX,
    dist: usize,
    short_code: usize,
    result: &mut usize,
) {
    let _ = &nodes[pos.wrapping_add(to)];
    let _ = &costs[pos.wrapping_add(to).wrapping_add(3)];
    debug_assert!(from >= 2 && to + 3 < LEN_TABLE);
    unsafe {
        let e = COPY_EXTRA_F.as_ptr();
        let cb = costs.as_mut_ptr().add(pos);
        let mut l = from;
        #[cfg(target_arch = "wasm32")]
        {
            use core::arch::wasm32::*;
            let dv = f32x4_splat(d);
            while l <= to {
                let c = f32x4_add(
                    f32x4_add(dv, v128_load(e.add(l) as *const v128)),
                    v128_load(row.add(l) as *const v128),
                );
                let mut m = i32x4_bitmask(f32x4_lt(c, v128_load(cb.add(l) as *const v128))) as u32;
                if to - l < 3 {
                    m &= (1u32 << (to - l + 1)) - 1;
                }
                while m != 0 {
                    let ll = l + m.trailing_zeros() as usize;
                    m &= m - 1;
                    let cost = (d + *e.add(ll)) + *row.add(ll);
                    *cb.add(ll) = cost;
                    SetZopfliNode(nodes.get_unchecked_mut(pos + ll), pos, start, ll, ll, dist, short_code, cost);
                    *result = max(*result, ll);
                }
                l += 4;
            }
            return;
        }
        #[allow(unreachable_code)]
        while l <= to {
            let cost = (d + *e.add(l)) + *row.add(l);
            if cost < *cb.add(l) {
                *cb.add(l) = cost;
                SetZopfliNode(nodes.get_unchecked_mut(pos + l), pos, start, l, l, dist, short_code, cost);
                *result = max(*result, l);
            }
            l += 1;
        }
    }
}

#[inline(always)]
fn SetZopfliNode(
    next: &mut ZopfliNode,
    pos: usize,
    start_pos: usize,
    len: usize,
    len_code: usize,
    dist: usize,
    short_code: usize,
    cost: floatX,
) {
    next.length = (len | len.wrapping_add(9u32 as usize).wrapping_sub(len_code) << 25) as u32;
    next.distance = dist as u32;
    next.dcode_insert_length = pos.wrapping_sub(start_pos) as u32 | (short_code << 27) as u32;
    next.u = Union1::cost(cost);
}

#[inline(always)]
fn UpdateZopfliNode(
    nodes: &mut [ZopfliNode],
    pos: usize,
    start_pos: usize,
    len: usize,
    len_code: usize,
    dist: usize,
    short_code: usize,
    cost: floatX,
) {
    let next = &mut nodes[pos.wrapping_add(len)];
    next.length = (len | len.wrapping_add(9u32 as usize).wrapping_sub(len_code) << 25) as u32;
    next.distance = dist as u32;
    next.dcode_insert_length = pos.wrapping_sub(start_pos) as u32 | (short_code << 27) as u32;
    next.u = Union1::cost(cost);
}

#[inline(always)]
fn BackwardMatchLengthCode(xself: &BackwardMatch) -> usize {
    let code: usize = (xself.length_and_code() & 31u32) as usize;
    if code != 0 {
        code
    } else {
        BackwardMatchLength(xself)
    }
}

/// fast-brotli-wasm: relax nodes pos+from ..= pos+to with one `cost` (a run
/// of lengths sharing a command code): nodes whose cost is higher get
/// (len, len_code, dist, short_code, cost). `costs` mirrors the nodes' costs
/// (see ZopfliCosts), so four nodes are compared at a time. Each node is
/// compared once, so the order does not matter. `len_code` 0 means "= len".
#[inline(always)]
fn RelaxRun(
    costs: &mut [floatX],
    nodes: &mut [ZopfliNode],
    pos: usize,
    start: usize,
    from: usize,
    to: usize,
    cost: floatX,
    len_code: usize,
    dist: usize,
    short_code: usize,
    result: &mut usize,
) {
    if from > to {
        return;
    }
    let _ = &nodes[pos.wrapping_add(to)];
    let _ = &costs[pos.wrapping_add(to)];
    let mut l = from;
    #[inline(always)]
    fn update(
        costs: &mut [floatX],
        nodes: &mut [ZopfliNode],
        pos: usize,
        start: usize,
        l: usize,
        cost: floatX,
        len_code: usize,
        dist: usize,
        short_code: usize,
        result: &mut usize,
    ) {
        unsafe {
            *costs.get_unchecked_mut(pos + l) = cost;
            SetZopfliNode(
                nodes.get_unchecked_mut(pos + l),
                pos,
                start,
                l,
                if len_code == 0 { l } else { len_code },
                dist,
                short_code,
                cost,
            );
        }
        *result = max(*result, l);
    }
    #[cfg(target_arch = "wasm32")]
    unsafe {
        use core::arch::wasm32::*;
        let c = f32x4_splat(cost);
        let base = costs.as_ptr().add(pos);
        // (costs has 4 entries of padding past the last node, so the last
        // group may read past `to`; those lanes are masked off)
        while l <= to {
            let mut m = i32x4_bitmask(f32x4_lt(c, v128_load(base.add(l) as *const v128))) as u32;
            if to - l < 3 {
                m &= (1u32 << (to - l + 1)) - 1;
            }
            while m != 0 {
                let k = m.trailing_zeros() as usize;
                m &= m - 1;
                update(costs, nodes, pos, start, l + k, cost, len_code, dist, short_code, result);
            }
            l += 4;
        }
        return;
    }
    while l <= to {
        if cost < unsafe { *costs.get_unchecked(pos + l) } {
            update(costs, nodes, pos, start, l, cost, len_code, dist, short_code, result);
        }
        l += 1;
    }
}

/// fast-brotli-wasm: the node updates for one distance-cache candidate `j`
/// that matched `len` bytes at distance `backward` (the body of the original
/// j loop after the match was found).
// (fast-brotli-wasm: hits are rare; kept out of line so that the probe and
// replay loops do not carry its setup)
#[inline(never)]
fn DistanceCacheHit<AllocF: Allocator<floatX>>(
    j: usize,
    backward: usize,
    len: usize,
    best_len: &mut usize,
    pos: usize,
    start: usize,
    inscode: u16,
    base_cost: floatX,
    model: &ZopfliCostModel<AllocF>,
    costs: &mut [floatX],
    nodes: &mut [ZopfliNode],
    lt: &mut LenCosts,
    result: &mut usize,
) {
    let dist_cost = base_cost + model.get_distance_cost(j);
    let mut l = best_len.wrapping_add(1);
    if l > len {
        return;
    }
    *best_len = len;
    let ic = inscode as usize;
    // lengths < 70 with the last distance (j == 0) and insert code < 8 have
    // command codes < 128 (no distance symbol): base_cost + t1
    if j == 0 && ic < 8 && l < 70 {
        let e = min(len, 69);
        let row = lt.row1(ic, model);
        RelaxVec(costs, nodes, pos, start, l, e, base_cost, row, backward, 1, result);
        l = e + 1;
    }
    let e = min(len, lt.vec_end());
    if l <= e {
        let row = lt.row0(ic, model);
        RelaxVec(costs, nodes, pos, start, l, e, dist_cost, row, backward, j.wrapping_add(1), result);
        l = e + 1;
    }
    // the cost only depends on the copy length code, so it is computed once
    // per run of lengths sharing a code (same float operations, same order)
    while l <= len {
        let (copycode, run_end) = CopyCodeAndRunEnd(l);
        let run_end = min(len, run_end);
        let cmdcode: u16 = CombineLengthCodes(inscode, copycode, (j == 0usize) as i32);
        let cost: floatX = (if cmdcode < 128 { base_cost } else { dist_cost })
            + (GetCopyExtra(copycode) as floatX)
            + model.get_command_cost(cmdcode);
        RelaxRun(costs, nodes, pos, start, l, run_end, cost, 0, backward, j.wrapping_add(1), result);
        l = run_end + 1;
    }
}

/// fast-brotli-wasm: the original j loop over the 16 distance-cache
/// candidates of `dc`, without a branch per candidate: for the current
/// best_len the candidates that pass all pre-checks (distance in range, the
/// byte at best_len matches) are collected as a bit mask, then visited in j
/// order; a longer match changes best_len, so the mask is rebuilt for the
/// candidates after it. Calls `hit` exactly where the original ran the node
/// updates.
#[inline(always)]
fn ProbeDistanceCache<F: FnMut(usize, usize, usize, &mut usize)>(
    dc: &[i32; 4],
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    cur_ix: usize,
    cur_ix_masked: usize,
    max_distance: usize,
    max_len: usize,
    best_len: &mut usize,
    mut hit: F,
) {
    let mut j = 0usize;
    loop {
        if !(j < 16 && *best_len < max_len) {
            return;
        }
        let bl = *best_len;
        let continuation: u8 = ringbuffer[cur_ix_masked.wrapping_add(bl)];
        if cur_ix_masked.wrapping_add(bl) > ringbuffer_mask {
            return;
        }
        // fast-brotli-wasm: the candidate mask is computed out of line; most
        // probes end right after it (no candidate matches at best_len)
        let mut mask = ProbeMask(
            dc,
            ringbuffer,
            ringbuffer_mask,
            cur_ix,
            cur_ix_masked,
            max_distance,
            bl,
            continuation,
            j,
        );
        let mut found = false;
        while mask != 0 {
            let jj = mask.trailing_zeros() as usize;
            mask &= mask - 1;
            let backward = (dc[(kDistanceCacheIndex[jj] as usize) & 3]
                + i32::from(kDistanceCacheOffset[jj])) as usize;
            let prev_ix = cur_ix.wrapping_sub(backward) & ringbuffer_mask;
            let len = FindMatchLengthWithLimit(
                &ringbuffer[prev_ix..],
                &ringbuffer[cur_ix_masked..],
                max_len,
            );
            if len > *best_len {
                hit(jj, backward, len, best_len);
                j = jj + 1;
                found = true;
                break;
            }
        }
        if !found {
            return;
        }
    }
}

/// fast-brotli-wasm: ProbeDistanceCache's candidate mask for `bl` (valid
/// distance, byte at bl equal to `continuation`) for candidates j and later
#[inline(never)]
fn ProbeMask(
    dc: &[i32; 4],
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    cur_ix: usize,
    cur_ix_masked: usize,
    max_distance: usize,
    bl: usize,
    continuation: u8,
    j: usize,
) -> u32 {
    match CandidateMaskWindows(dc, ringbuffer, cur_ix, cur_ix_masked, max_distance, bl, continuation) {
        Some(m) => m & !((1u32 << j) - 1),
        None => {
            let mut mask = 0u32;
            let mut jj = j;
            while jj < 16 {
                let backward = (dc[(kDistanceCacheIndex[jj] as usize) & 3]
                    + i32::from(kDistanceCacheOffset[jj])) as usize;
                // backward <= max_distance (<= cur_ix) and prev_ix < cur_ix
                let ok = backward.wrapping_sub(1) < max_distance;
                let prev_ix = cur_ix.wrapping_sub(backward) & ringbuffer_mask;
                let ok = ok && prev_ix.wrapping_add(bl) <= ringbuffer_mask;
                let idx = if ok { prev_ix.wrapping_add(bl) } else { 0 };
                let byte = unsafe { *ringbuffer.get_unchecked(idx) };
                mask |= ((ok && byte == continuation) as u32) << jj;
                jj += 1;
            }
            mask
        }
    }
}

// fast-brotli-wasm: bit t of the 7-byte window around distance d (the byte
// for offset 3 - t) -> candidate bits j for d = distance_cache[0] / [1]
const fn window_to_j_table(js: [u32; 7]) -> [u16; 128] {
    let mut t = [0u16; 128];
    let mut m = 0;
    while m < 128 {
        let mut out = 0u16;
        let mut b = 0;
        while b < 7 {
            if m & (1 << b) != 0 {
                out |= 1 << js[b];
            }
            b += 1;
        }
        t[m] = out;
        m += 1;
    }
    t
}
// offsets +3, +2, +1, 0, -1, -2, -3 are candidates j = ...
static WINDOW0_J: [u16; 128] = window_to_j_table([9, 7, 5, 0, 4, 6, 8]);
static WINDOW1_J: [u16; 128] = window_to_j_table([15, 13, 11, 1, 10, 12, 14]);

/// fast-brotli-wasm: the candidate mask of ProbeDistanceCache (valid
/// distance and matching byte at best_len), from two 8-byte windows (the
/// candidates cluster around distance_cache[0] and [1]) instead of 16 loads.
/// None when the windows would not be contiguous in the ring buffer.
#[inline(always)]
fn CandidateMaskWindows(
    dc: &[i32; 4],
    ringbuffer: &[u8],
    cur_ix: usize,
    cur_ix_masked: usize,
    max_distance: usize,
    bl: usize,
    continuation: u8,
) -> Option<u32> {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        use core::arch::wasm32::*;
        // no wrap so far: prev_ix = cur_ix - backward for every valid candidate
        if cur_ix != cur_ix_masked {
            return None;
        }
        let at = cur_ix + bl; // byte index for backward 0
        let md = max_distance as i64;
        let c = u8x16_splat(continuation);
        let mut mask = 0u32;
        for (w, table) in [(0usize, &WINDOW0_J), (1usize, &WINDOW1_J)] {
            // common case: all seven distances d - 3 ..= d + 3 are valid (and
            // the window is inside the data since d + 3 <= max_distance <= cur_ix)
            let du = dc[w] as u32 as usize;
            if dc[w] >= 4 && du + 3 <= max_distance {
                let v = v128_load64_zero(ringbuffer.as_ptr().add(at - du - 3) as *const u64);
                let eq = u8x16_bitmask(u8x16_eq(v, c)) as u32;
                mask |= table[(eq & 0x7f) as usize] as u32;
                continue;
            }
            let d = dc[w] as i64;
            // offsets 3 - t valid when 1 <= d + 3 - t <= max_distance
            let lo = max(0, d + 3 - md);
            let hi = min(6, d + 2);
            if lo > hi {
                continue;
            }
            let base = at as i64 - d - 3;
            if base < 0 || base as usize + 8 > ringbuffer.len() {
                return None;
            }
            let v = v128_load64_zero(ringbuffer.as_ptr().add(base as usize) as *const u64);
            let eq = u8x16_bitmask(u8x16_eq(v, c)) as u32;
            let valid = ((1u32 << (hi + 1)) - 1) & !((1u32 << lo) - 1);
            mask |= table[(eq & valid & 0x7f) as usize] as u32;
        }
        for w in 2..4 {
            let d = dc[w] as i64;
            if d >= 1 && d <= md {
                let idx = at - d as usize;
                if *ringbuffer.get_unchecked(idx) == continuation {
                    mask |= 1 << w;
                }
            }
        }
        return Some(mask);
    }
    #[allow(unreachable_code)]
    None
}

#[inline(always)]
fn UpdateNodes<AllocF: Allocator<floatX>>(
    num_bytes: usize,
    block_start: usize,
    pos: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &BrotliEncoderParams,
    max_backward_limit: usize,
    starting_dist_cache: &[i32],
    num_matches: usize,
    matches: &[u64],
    model: &ZopfliCostModel<AllocF>,
    queue: &mut StartPosQueue,
    nodes: &mut [ZopfliNode],
    costs: &mut [floatX],
    lt: &mut LenCosts,
    dcs: &mut [[i32; 4]],
    scratch: &mut UpdateScratch,
) -> usize {
    let cur_ix: usize = block_start.wrapping_add(pos);
    let cur_ix_masked: usize = cur_ix & ringbuffer_mask;
    let max_distance: usize = min(cur_ix, max_backward_limit);
    let max_len: usize = num_bytes.wrapping_sub(pos);
    let max_zopfli_len: usize = MaxZopfliLen(params);
    let max_iters: usize = MaxZopfliCandidates(params);
    let min_len: usize;
    let mut result: usize = 0usize;
    let mut k: usize;
    let gap: usize = 0usize;
    EvaluateNode(
        block_start,
        pos,
        max_backward_limit,
        gap,
        starting_dist_cache,
        model,
        queue,
        nodes,
        dcs,
    );
    {
        let posdata = StartPosQueueAt(queue, 0usize);
        let min_cost =
            posdata.cost + model.get_min_cost_cmd() + model.get_literal_costs(posdata.pos, pos);
        min_len = ComputeMinimumCopyLength(min_cost, costs, num_bytes, pos);
    }
    // fast-brotli-wasm: the distance-cache probe depends only on the queue
    // entry's distance cache (pos, min_len and max_len are fixed for this
    // call), not on its costs. Queue entries often share a distance cache, so
    // the probe's hits are recorded once and replayed with the other entry's
    // costs. (Scratch arrays are left uninitialized: only entries that were
    // written are read.)
    let nq = min(max_iters, StartPosQueueSize(queue));
    // (per-match distance symbol costs are the same for every queue entry)
    let UpdateScratch { memo_dc, memo_hits, memo_nhits, match_extra, match_dcost } = scratch;
    let mut memo_n = 0usize;
    let mut match_prepared = 0usize;
    // (the same for every queue entry)
    let lc_pos: floatX = model.get_literal_costs(0, pos);
    let mut k0_info: (u16, floatX) = (0, 0.0);
    k = 0usize;
    while k < nq {
        let posdata = StartPosQueueAt(queue, k);
        let start: usize = posdata.pos;
        let dc = posdata.distance_cache;
        let mut m = 0usize;
        while m < memo_n && memo_dc[m] != dc {
            m += 1;
        }
        // fast-brotli-wasm: the later entries only matter through their
        // distance-cache hits; with a recorded probe without hits there is
        // nothing to do (their costs are not even needed)
        if k >= 2 && m < memo_n && memo_nhits[m] == 0 {
            k = k.wrapping_add(1);
            continue;
        }
        let insertlen = pos.wrapping_sub(start);
        let inscode: u16 = InsertLengthCodeFast(insertlen);
        let base_cost: floatX = posdata.costdiff + InsertExtraF(insertlen, inscode) + lc_pos;
        let mut best_len: usize = min_len.wrapping_sub(1);
        if m < memo_n {
            for h in 0..memo_nhits[m] {
                let (j, backward, len) = memo_hits[m][h];
                DistanceCacheHit(
                    j as usize, backward as usize, len as usize, &mut best_len, pos, start,
                    inscode, base_cost, model, costs, nodes, lt, &mut result,
                );
            }
        } else {
            let slot = memo_n;
            memo_dc[slot] = dc;
            memo_nhits[slot] = 0;
            memo_n += 1;
            let hits = &mut memo_hits[slot];
            let nhits = &mut memo_nhits[slot];
            ProbeDistanceCache(
                &dc,
                ringbuffer,
                ringbuffer_mask,
                cur_ix,
                cur_ix_masked,
                max_distance,
                max_len,
                &mut best_len,
                |j, backward, len, best_len| {
                    hits[*nhits] = (j as u8, backward as u32, len as u32);
                    *nhits += 1;
                    DistanceCacheHit(
                        j, backward, len, best_len, pos, start, inscode, base_cost, model,
                        costs, nodes, lt, &mut result,
                    );
                },
            );
        }
        if k >= 2usize {
            k = k.wrapping_add(1);
            continue;
        }
        // fast-brotli-wasm: entry 1 relaxes the same (length, match) pairs as
        // entry 0 with cost (((base + extra) + dcost) + copy extra) + cmd cost.
        // With base_1 >= base_0 and every command cost of its insert code >=
        // entry 0's, each candidate is >= entry 0's one (float additions are
        // monotone), which already bounds that node's cost (costs only go
        // down): no update is possible, so the loop is skipped.
        if k == 1 {
            let (ic0, base0) = k0_info;
            if base_cost >= base0 && lt.dominates(ic0 as usize, inscode as usize, model) {
                k = k.wrapping_add(1);
                continue;
            }
        } else {
            k0_info = (inscode, base_cost);
        }
        let mut len: usize = min_len;
        for j in 0usize..num_matches {
            let mut match_: BackwardMatch = BackwardMatch(matches[j]);
            // fast-brotli-wasm: a match shorter than the next length to relax
            // relaxes nothing (and does not move `len`)
            if BackwardMatchLength(&match_) < len {
                continue;
            }
            let dist: usize = match_.distance() as usize;
            let is_dictionary_match = dist > max_distance.wrapping_add(gap);
            if j >= match_prepared {
                let dist_symbol = DistanceSymbol(
                    dist.wrapping_add(16).wrapping_sub(1),
                    params.dist.num_direct_distance_codes as usize,
                    params.dist.distance_postfix_bits as usize,
                );
                let distnumextra: u32 = u32::from(dist_symbol) >> 10;
                if j < match_extra.len() {
                    match_extra[j] = distnumextra as floatX;
                    match_dcost[j] =
                        model.get_distance_cost((dist_symbol as i32 & 0x03ff) as usize);
                    match_prepared = j + 1;
                }
                // (only reached without a cache slot for > 128 matches)
                if j >= match_extra.len() {
                    let dist_cost = base_cost
                        + (distnumextra as floatX)
                        + model.get_distance_cost((dist_symbol as i32 & 0x03ff) as usize);
                    MatchUpdates(
                        &mut match_, &mut len, dist, is_dictionary_match, dist_cost, pos, start,
                        inscode, max_zopfli_len, model, costs, nodes, lt, &mut result,
                    );
                    continue;
                }
            }
            let dist_cost = base_cost + match_extra[j] + match_dcost[j];
            MatchUpdates(
                &mut match_, &mut len, dist, is_dictionary_match, dist_cost, pos, start, inscode,
                max_zopfli_len, model, costs, nodes, lt, &mut result,
            );
        }
        k = k.wrapping_add(1);
    }
    result
}

/// fast-brotli-wasm: UpdateNodes' scratch arrays, kept by the caller so the
/// per-call setup is cheap (only entries written in the same call are read)
pub(crate) struct UpdateScratch {
    memo_dc: [[i32; 4]; 8],
    memo_hits: [[(u8, u32, u32); 16]; 8],
    memo_nhits: [usize; 8],
    match_extra: [floatX; 128],
    match_dcost: [floatX; 128],
}

/// fast-brotli-wasm: GetInsertLengthCode(l) for l < 2114
const fn ins_code_table() -> [u8; 2114] {
    let mut t = [0u8; 2114];
    let mut l = 0;
    while l < 2114 {
        t[l] = if l < 6 {
            l
        } else if l < 130 {
            let nbits = (63 - ((l - 2) as u64).leading_zeros()) as usize - 1;
            (nbits << 1) + ((l - 2) >> nbits) + 2
        } else {
            (63 - ((l - 66) as u64).leading_zeros()) as usize + 10
        } as u8;
        l += 1;
    }
    t
}
static INS_CODE_TABLE: [u8; 2114] = ins_code_table();

/// fast-brotli-wasm: GetInsertLengthCode
#[inline(always)]
fn InsertLengthCodeFast(insertlen: usize) -> u16 {
    if insertlen < 2114 {
        unsafe { *INS_CODE_TABLE.get_unchecked(insertlen) as u16 }
    } else if insertlen < 6210 {
        21
    } else if insertlen < 22594 {
        22
    } else {
        23
    }
}

/// fast-brotli-wasm: kInsExtra[GetInsertLengthCode(l)] as floatX for l < 2114
const fn ins_extra_len_table() -> [floatX; 2114] {
    const EXTRA: [u32; 24] = [
        0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
    ];
    let codes = ins_code_table();
    let mut t = [0.0 as floatX; 2114];
    let mut l = 0;
    while l < 2114 {
        t[l] = EXTRA[codes[l] as usize] as floatX;
        l += 1;
    }
    t
}
static INS_EXTRA_BY_LEN_F: [floatX; 2114] = ins_extra_len_table();

#[inline(always)]
fn InsertExtraF(insertlen: usize, inscode: u16) -> floatX {
    if insertlen < 2114 {
        unsafe { *INS_EXTRA_BY_LEN_F.get_unchecked(insertlen) }
    } else {
        unsafe { *INS_EXTRA_F.get_unchecked(inscode as usize) }
    }
}

/// fast-brotli-wasm: kInsExtra[code] as floatX
static INS_EXTRA_F: [floatX; 24] = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0, 5.0, 5.0, 6.0, 7.0, 8.0,
    9.0, 10.0, 12.0, 14.0, 24.0,
];

/// fast-brotli-wasm: the distance symbol of PrefixEncodeCopyDistance (the
/// same arithmetic in 32 bits; distance codes are < 2^31 here)
#[inline(always)]
fn DistanceSymbol(distance_code: usize, num_direct_codes: usize, postfix_bits: usize) -> u16 {
    if distance_code < 16 + num_direct_codes {
        distance_code as u16
    } else {
        let dist: u32 = (1u32 << (postfix_bits + 2))
            .wrapping_add((distance_code.wrapping_sub(16).wrapping_sub(num_direct_codes)) as u32);
        let bucket: u32 = (31 - dist.leading_zeros()).wrapping_sub(1);
        let postfix_mask: u32 = (1u32 << postfix_bits).wrapping_sub(1);
        let postfix: u32 = dist & postfix_mask;
        let prefix: u32 = (dist >> bucket) & 1;
        let nbits: u32 = bucket.wrapping_sub(postfix_bits as u32);
        ((nbits << 10)
            | (16u32
                .wrapping_add(num_direct_codes as u32)
                .wrapping_add(
                    (2u32.wrapping_mul(nbits.wrapping_sub(1)).wrapping_add(prefix)) << postfix_bits,
                )
                .wrapping_add(postfix))) as u16
    }
}

/// fast-brotli-wasm: the node updates for one LZ77/dictionary match (the body
/// of the original match loop): one cost per run of lengths with the same
/// copy length code (a dictionary match has a single code).
#[inline(always)]
fn MatchUpdates<AllocF: Allocator<floatX>>(
    match_: &mut BackwardMatch,
    len: &mut usize,
    dist: usize,
    is_dictionary_match: bool,
    dist_cost: floatX,
    pos: usize,
    start: usize,
    inscode: u16,
    max_zopfli_len: usize,
    model: &ZopfliCostModel<AllocF>,
    costs: &mut [floatX],
    nodes: &mut [ZopfliNode],
    lt: &mut LenCosts,
    result: &mut usize,
) {
    let max_match_len: usize = BackwardMatchLength(match_);
    if *len < max_match_len && (is_dictionary_match || max_match_len > max_zopfli_len) {
        *len = max_match_len;
    }
    if !is_dictionary_match {
        let e = min(max_match_len, lt.vec_end());
        if *len <= e {
            let row = lt.row0(inscode as usize, model);
            RelaxVec(costs, nodes, pos, start, *len, e, dist_cost, row, dist, 0, result);
            *len = e + 1;
        }
    }
    while *len <= max_match_len {
        let (len_code, copycode, run_end) = if is_dictionary_match {
            let len_code = BackwardMatchLengthCode(match_);
            (len_code, GetCopyLengthCode(len_code), max_match_len)
        } else {
            let (copycode, run_end) = CopyCodeAndRunEnd(*len);
            (*len, copycode, min(max_match_len, run_end))
        };
        let cmdcode: u16 = CombineLengthCodes(inscode, copycode, 0i32);
        let cost: floatX =
            dist_cost + GetCopyExtra(copycode) as (floatX) + model.get_command_cost(cmdcode);
        RelaxRun(
            costs,
            nodes,
            pos,
            start,
            *len,
            run_end,
            cost,
            if is_dictionary_match { len_code } else { 0 },
            dist,
            0,
            result,
        );
        *len = run_end + 1;
    }
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    #[inline(always)]
    fn cleanup(&mut self, m: &mut AllocF) {
        m.free_cell(core::mem::take(&mut self.literal_costs_));
        m.free_cell(core::mem::take(&mut self.cost_dist_));
    }
}

impl ZopfliNode {
    #[inline(always)]
    fn command_length(&self) -> u32 {
        self.copy_length()
            .wrapping_add(self.dcode_insert_length & 0x07ff_ffff)
    }
}

#[inline(always)]
fn ComputeShortestPathFromNodes(num_bytes: usize, nodes: &mut [ZopfliNode]) -> usize {
    let mut index: usize = num_bytes;
    let mut num_commands: usize = 0usize;
    while (nodes[index].dcode_insert_length & 0x07ff_ffff) == 0 && nodes[index].length == 1 {
        index = index.wrapping_sub(1);
    }
    nodes[index].u = Union1::next(!(0u32));
    while index != 0 {
        let len = nodes[index].command_length() as usize;
        index = index.wrapping_sub(len);
        (nodes[index]).u = Union1::next(len as u32);
        num_commands = num_commands.wrapping_add(1);
    }
    num_commands
}

const MAX_NUM_MATCHES_H10: usize = 128;
pub fn BrotliZopfliComputeShortestPath<
    AllocU32: Allocator<u32>,
    Buckets: Allocable<u32, AllocU32> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
    AllocF: Allocator<floatX>,
>(
    m: &mut AllocF,
    dictionary: Option<&BrotliDictionary>,
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &BrotliEncoderParams,
    max_backward_limit: usize,
    dist_cache: &[i32],
    handle: &mut H10<AllocU32, Buckets, Params>,
    nodes: &mut [ZopfliNode],
) -> usize
where
    Buckets: PartialEq<Buckets>,
{
    let max_zopfli_len: usize = MaxZopfliLen(params);
    let mut model: ZopfliCostModel<AllocF>;
    let mut queue: StartPosQueue;
    let mut matches = [0; MAX_NUM_MATCHES_H10];
    let store_end: usize = if num_bytes >= StoreLookaheadH10() {
        position
            .wrapping_add(num_bytes)
            .wrapping_sub(StoreLookaheadH10())
            .wrapping_add(1)
    } else {
        position
    };
    let mut i: usize;
    let gap: usize = 0usize;
    let lz_matches_offset: usize = 0usize;
    (nodes[0]).length = 0u32;
    (nodes[0]).u = Union1::cost(0.0);
    let mut costs = ZopfliCosts(nodes, num_bytes.wrapping_add(1));
    let mut lt = LenCosts::new(num_bytes);
    let mut dcs = ZopfliDistanceCaches(num_bytes.wrapping_add(1));
    #[allow(invalid_value)]
    let mut scratch: UpdateScratch = unsafe { core::mem::MaybeUninit::uninit().assume_init() };
    model = ZopfliCostModel::init(m, &params.dist, num_bytes);
    if !(0i32 == 0) {
        return 0usize;
    }
    model.set_from_literal_costs(position, ringbuffer, ringbuffer_mask);
    queue = InitStartPosQueue(params);
    i = 0usize;
    while i.wrapping_add(handle.HashTypeLength()).wrapping_sub(1) < num_bytes {
        {
            let pos: usize = position.wrapping_add(i);
            let max_distance: usize = min(pos, max_backward_limit);
            let mut skip: usize;
            let mut num_matches: usize = FindAllMatchesH10(
                handle,
                dictionary,
                ringbuffer,
                ringbuffer_mask,
                pos,
                num_bytes.wrapping_sub(i),
                max_distance,
                gap,
                params,
                &mut matches[lz_matches_offset..],
            );
            if num_matches > 0usize
                && (BackwardMatchLength(&BackwardMatch(matches[num_matches.wrapping_sub(1)]))
                    > max_zopfli_len)
            {
                matches[0] = matches[num_matches.wrapping_sub(1)];
                num_matches = 1usize;
            }
            skip = UpdateNodes(
                num_bytes,
                position,
                i,
                ringbuffer,
                ringbuffer_mask,
                params,
                max_backward_limit,
                dist_cache,
                num_matches,
                &matches[..],
                &mut model,
                &mut queue,
                nodes,
                &mut costs,
                &mut lt,
                &mut dcs,
                &mut scratch,
            );
            if skip < 16384usize {
                skip = 0usize;
            }
            if num_matches == 1usize
                && (BackwardMatchLength(&BackwardMatch(matches[0])) > max_zopfli_len)
            {
                skip = max(BackwardMatchLength(&BackwardMatch(matches[0])), skip);
            }
            if skip > 1usize {
                handle.StoreRange(
                    ringbuffer,
                    ringbuffer_mask,
                    pos.wrapping_add(1),
                    min(pos.wrapping_add(skip), store_end),
                );
                skip = skip.wrapping_sub(1);
                while skip != 0 {
                    i = i.wrapping_add(1);
                    if i.wrapping_add(handle.HashTypeLength()).wrapping_sub(1) >= num_bytes {
                        break;
                    }
                    EvaluateNode(
                        position,
                        i,
                        max_backward_limit,
                        gap,
                        dist_cache,
                        &mut model,
                        &mut queue,
                        nodes,
                        &mut dcs,
                    );
                    skip = skip.wrapping_sub(1);
                }
            }
        }
        i = i.wrapping_add(1);
    }

    model.cleanup(m);

    ComputeShortestPathFromNodes(num_bytes, nodes)
}

pub fn BrotliCreateZopfliBackwardReferences<
    Alloc: Allocator<u32> + Allocator<floatX> + Allocator<ZopfliNode>,
    Buckets: Allocable<u32, Alloc> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
>(
    alloc: &mut Alloc,
    dictionary: Option<&BrotliDictionary>,
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &BrotliEncoderParams,
    hasher: &mut H10<Alloc, Buckets, Params>,
    dist_cache: &mut [i32],
    last_insert_len: &mut usize,
    commands: &mut [Command],
    num_commands: &mut usize,
    num_literals: &mut usize,
) where
    Buckets: PartialEq<Buckets>,
{
    let max_backward_limit: usize = (1usize << params.lgwin).wrapping_sub(16);
    let mut nodes: <Alloc as Allocator<ZopfliNode>>::AllocatedMemory;
    nodes = if num_bytes.wrapping_add(1) > 0usize {
        <Alloc as Allocator<ZopfliNode>>::alloc_cell(alloc, num_bytes.wrapping_add(1))
    } else {
        <Alloc as Allocator<ZopfliNode>>::AllocatedMemory::default()
    };
    if !(0i32 == 0) {
        return;
    }
    BrotliInitZopfliNodes(nodes.slice_mut(), num_bytes.wrapping_add(1));
    *num_commands = num_commands.wrapping_add(BrotliZopfliComputeShortestPath(
        alloc,
        dictionary,
        num_bytes,
        position,
        ringbuffer,
        ringbuffer_mask,
        params,
        max_backward_limit,
        dist_cache,
        hasher,
        nodes.slice_mut(),
    ));
    if !(0i32 == 0) {
        return;
    }
    BrotliZopfliCreateCommands(
        num_bytes,
        position,
        max_backward_limit,
        nodes.slice(),
        dist_cache,
        last_insert_len,
        params,
        commands,
        num_literals,
    );
    {
        <Alloc as Allocator<ZopfliNode>>::free_cell(alloc, core::mem::take(&mut nodes));
    }
}

fn SetCost(histogram: &[u32], histogram_size: usize, literal_histogram: i32, cost: &mut [floatX]) {
    let mut sum: u64 = 0;
    let mut missing_symbol_sum: u64;

    let mut i: usize;
    for i in 0usize..histogram_size {
        sum = sum.wrapping_add(u64::from(histogram[i]));
    }
    let log2sum: floatX = FastLog2(sum) as (floatX);
    missing_symbol_sum = sum;
    if literal_histogram == 0 {
        for i in 0usize..histogram_size {
            if histogram[i] == 0u32 {
                missing_symbol_sum = missing_symbol_sum.wrapping_add(1);
            }
        }
    }
    let missing_symbol_cost: floatX =
        FastLog2f64(missing_symbol_sum) as (floatX) + 2i32 as (floatX);
    i = 0usize;
    while i < histogram_size {
        'continue56: loop {
            {
                if histogram[i] == 0u32 {
                    cost[i] = missing_symbol_cost;
                    break 'continue56;
                }
                cost[i] = log2sum - FastLog2(u64::from(histogram[i])) as (floatX);
                if cost[i] < 1i32 as (floatX) {
                    cost[i] = 1i32 as (floatX);
                }
            }
            break;
        }
        i = i.wrapping_add(1);
    }
}

impl<AllocF: Allocator<floatX>> ZopfliCostModel<AllocF> {
    fn set_from_commands(
        &mut self,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
        commands: &[Command],
        num_commands: usize,
        last_insert_len: usize,
    ) {
        let mut histogram_literal = [0u32; BROTLI_NUM_LITERAL_SYMBOLS];
        let mut histogram_cmd = [0u32; BROTLI_NUM_COMMAND_SYMBOLS];
        let mut histogram_dist = [0u32; BROTLI_SIMPLE_DISTANCE_ALPHABET_SIZE];
        let mut cost_literal = [0.0 as floatX; BROTLI_NUM_LITERAL_SYMBOLS];
        let mut pos: usize = position.wrapping_sub(last_insert_len);
        let mut min_cost_cmd: floatX = kInfinity;
        let mut i: usize;
        let cost_cmd: &mut [floatX] = &mut self.cost_cmd_[..];
        i = 0usize;
        while i < num_commands {
            {
                let inslength: usize = (commands[i]).insert_len_ as usize;
                let copylength: usize = CommandCopyLen(&commands[i]) as usize;
                let distcode: usize = (commands[i].dist_prefix_ as i32 & 0x03ff) as usize;
                let cmdcode: usize = (commands[i]).cmd_prefix_ as usize;
                {
                    let _rhs = 1;
                    let _lhs = &mut histogram_cmd[cmdcode];
                    *_lhs = (*_lhs).wrapping_add(_rhs as u32);
                }
                if cmdcode >= 128usize {
                    let _rhs = 1;
                    let _lhs = &mut histogram_dist[distcode];
                    *_lhs = (*_lhs).wrapping_add(_rhs as u32);
                }
                for j in 0usize..inslength {
                    let _rhs = 1;
                    let _lhs = &mut histogram_literal
                        [(ringbuffer[(pos.wrapping_add(j) & ringbuffer_mask)] as usize)];
                    *_lhs = (*_lhs).wrapping_add(_rhs as u32);
                }
                pos = pos.wrapping_add(inslength.wrapping_add(copylength));
            }
            i = i.wrapping_add(1);
        }
        SetCost(
            &histogram_literal[..],
            BROTLI_NUM_LITERAL_SYMBOLS,
            1i32,
            &mut cost_literal,
        );
        SetCost(
            &histogram_cmd[..],
            BROTLI_NUM_COMMAND_SYMBOLS,
            0i32,
            &mut cost_cmd[..],
        );
        SetCost(
            &histogram_dist[..],
            self.distance_histogram_size as usize,
            0i32,
            self.cost_dist_.slice_mut(),
        );
        for i in 0usize..704usize {
            min_cost_cmd = min_cost_cmd.min(cost_cmd[i]);
        }
        self.min_cost_cmd_ = min_cost_cmd;
        {
            let literal_costs: &mut [floatX] = self.literal_costs_.slice_mut();
            let mut literal_carry: floatX = 0.0;
            let num_bytes: usize = self.num_bytes_;
            literal_costs[0] = 0.0 as (floatX);
            for i in 0usize..num_bytes {
                literal_carry += cost_literal
                    [(ringbuffer[(position.wrapping_add(i) & ringbuffer_mask)] as usize)]
                    as floatX;
                literal_costs[i.wrapping_add(1)] =
                    (literal_costs[i] as floatX + literal_carry) as floatX;
                literal_carry -=
                    (literal_costs[i.wrapping_add(1)] as floatX - literal_costs[i] as floatX);
            }
        }
    }
}

fn ZopfliIterate<AllocF: Allocator<floatX>>(
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &BrotliEncoderParams,
    max_backward_limit: usize,
    gap: usize,
    dist_cache: &[i32],
    model: &ZopfliCostModel<AllocF>,
    num_matches: &[u32],
    matches: &[u64],
    nodes: &mut [ZopfliNode],
) -> usize {
    let max_zopfli_len: usize = MaxZopfliLen(params);
    let mut queue: StartPosQueue;
    let mut cur_match_pos: usize = 0usize;
    let mut i: usize;
    (nodes[0]).length = 0u32;
    (nodes[0]).u = Union1::cost(0.0);
    let mut costs = ZopfliCosts(nodes, num_bytes.wrapping_add(1));
    let mut lt = LenCosts::new(num_bytes);
    let mut dcs = ZopfliDistanceCaches(num_bytes.wrapping_add(1));
    #[allow(invalid_value)]
    let mut scratch: UpdateScratch = unsafe { core::mem::MaybeUninit::uninit().assume_init() };
    queue = InitStartPosQueue(params);
    i = 0usize;
    while i.wrapping_add(3) < num_bytes {
        {
            let mut skip: usize = UpdateNodes(
                num_bytes,
                position,
                i,
                ringbuffer,
                ringbuffer_mask,
                params,
                max_backward_limit,
                dist_cache,
                num_matches[i] as usize,
                &matches[cur_match_pos..],
                model,
                &mut queue,
                nodes,
                &mut costs,
                &mut lt,
                &mut dcs,
                &mut scratch,
            );
            if skip < 16384usize {
                skip = 0usize;
            }
            cur_match_pos = cur_match_pos.wrapping_add(num_matches[i] as usize);
            if num_matches[i] == 1u32
                && (BackwardMatchLength(&BackwardMatch(matches[cur_match_pos.wrapping_sub(1)]))
                    > max_zopfli_len)
            {
                skip = max(
                    BackwardMatchLength(&BackwardMatch(matches[cur_match_pos.wrapping_sub(1)])),
                    skip,
                );
            }
            if skip > 1usize {
                skip = skip.wrapping_sub(1);
                while skip != 0 {
                    i = i.wrapping_add(1);
                    if i.wrapping_add(3) >= num_bytes {
                        break;
                    }
                    EvaluateNode(
                        position,
                        i,
                        max_backward_limit,
                        gap,
                        dist_cache,
                        model,
                        &mut queue,
                        nodes,
                        &mut dcs,
                    );
                    cur_match_pos = cur_match_pos.wrapping_add(num_matches[i] as usize);
                    skip = skip.wrapping_sub(1);
                }
            }
        }
        i = i.wrapping_add(1);
    }
    ComputeShortestPathFromNodes(num_bytes, nodes)
}

pub fn BrotliCreateHqZopfliBackwardReferences<
    Alloc: Allocator<u32> + Allocator<u64> + Allocator<floatX> + Allocator<ZopfliNode>,
    Buckets: Allocable<u32, Alloc> + SliceWrapperMut<u32> + SliceWrapper<u32>,
    Params: H10Params,
>(
    alloc: &mut Alloc,
    dictionary: Option<&BrotliDictionary>,
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &BrotliEncoderParams,
    hasher: &mut H10<Alloc, Buckets, Params>,
    dist_cache: &mut [i32],
    last_insert_len: &mut usize,
    commands: &mut [Command],
    num_commands: &mut usize,
    num_literals: &mut usize,
) where
    Buckets: PartialEq<Buckets>,
{
    let max_backward_limit: usize = (1usize << params.lgwin).wrapping_sub(16);
    let mut num_matches: <Alloc as Allocator<u32>>::AllocatedMemory = if num_bytes > 0usize {
        <Alloc as Allocator<u32>>::alloc_cell(alloc, num_bytes)
    } else {
        <Alloc as Allocator<u32>>::AllocatedMemory::default()
    };
    let mut matches_size: usize = (4usize).wrapping_mul(num_bytes);
    let store_end: usize = if num_bytes >= StoreLookaheadH10() {
        position
            .wrapping_add(num_bytes)
            .wrapping_sub(StoreLookaheadH10())
            .wrapping_add(1)
    } else {
        position
    };
    let mut cur_match_pos: usize = 0usize;
    let mut i: usize;

    let mut orig_dist_cache = [0i32; 4];

    let mut model: ZopfliCostModel<Alloc>;
    let mut nodes: <Alloc as Allocator<ZopfliNode>>::AllocatedMemory;
    let mut matches: <Alloc as Allocator<u64>>::AllocatedMemory = if matches_size > 0usize {
        <Alloc as Allocator<u64>>::alloc_cell(alloc, matches_size)
    } else {
        <Alloc as Allocator<u64>>::AllocatedMemory::default()
    };
    let gap: usize = 0usize;
    let shadow_matches: usize = 0usize;
    i = 0usize;
    while i.wrapping_add(hasher.HashTypeLength()).wrapping_sub(1) < num_bytes {
        {
            let pos: usize = position.wrapping_add(i);
            let max_distance: usize = min(pos, max_backward_limit);
            let max_length: usize = num_bytes.wrapping_sub(i);

            let mut j: usize;
            {
                if matches_size < cur_match_pos.wrapping_add(128).wrapping_add(shadow_matches) {
                    let mut new_size: usize = if matches_size == 0usize {
                        cur_match_pos.wrapping_add(128).wrapping_add(shadow_matches)
                    } else {
                        matches_size
                    };
                    let mut new_array: <Alloc as Allocator<u64>>::AllocatedMemory;
                    while new_size < cur_match_pos.wrapping_add(128).wrapping_add(shadow_matches) {
                        new_size = new_size.wrapping_mul(2);
                    }
                    new_array = if new_size > 0usize {
                        <Alloc as Allocator<u64>>::alloc_cell(alloc, new_size)
                    } else {
                        <Alloc as Allocator<u64>>::AllocatedMemory::default()
                    };
                    if matches_size != 0 {
                        for (dst, src) in new_array
                            .slice_mut()
                            .split_at_mut(matches_size)
                            .0
                            .iter_mut()
                            .zip(matches.slice().split_at(matches_size).0.iter())
                        {
                            *dst = *src;
                        }
                    }
                    {
                        <Alloc as Allocator<u64>>::free_cell(alloc, core::mem::take(&mut matches));
                    }
                    matches = new_array;
                    matches_size = new_size;
                }
            }
            if !(0i32 == 0) {
                return;
            }
            let num_found_matches: usize = FindAllMatchesH10(
                hasher,
                dictionary, //&params.dictionary ,
                ringbuffer,
                ringbuffer_mask,
                pos,
                max_length,
                max_distance,
                gap,
                params,
                &mut matches.slice_mut()[cur_match_pos.wrapping_add(shadow_matches)..],
            );
            let cur_match_end: usize = cur_match_pos.wrapping_add(num_found_matches);
            j = cur_match_pos;
            while j.wrapping_add(1) < cur_match_end {
                {}
                j = j.wrapping_add(1);
            }
            num_matches.slice_mut()[i] = num_found_matches as u32;
            if num_found_matches > 0usize {
                let match_len: usize = BackwardMatchLength(&BackwardMatch(
                    matches.slice()[(cur_match_end.wrapping_sub(1) as usize)],
                ));
                if match_len > 325usize {
                    let skip: usize = match_len.wrapping_sub(1);
                    let tmp = matches.slice()[(cur_match_end.wrapping_sub(1) as usize)];
                    matches.slice_mut()[cur_match_pos] = tmp;
                    cur_match_pos = cur_match_pos.wrapping_add(1);
                    num_matches.slice_mut()[i] = 1u32;
                    hasher.StoreRange(
                        ringbuffer,
                        ringbuffer_mask,
                        pos.wrapping_add(1),
                        min(pos.wrapping_add(match_len), store_end),
                    );
                    for item in num_matches
                        .slice_mut()
                        .split_at_mut(i.wrapping_add(1))
                        .1
                        .split_at_mut(skip)
                        .0
                        .iter_mut()
                    {
                        *item = 0;
                    }
                    i = i.wrapping_add(skip);
                } else {
                    cur_match_pos = cur_match_end;
                }
            }
        }
        i = i.wrapping_add(1);
    }
    let orig_num_literals: usize = *num_literals;
    let orig_last_insert_len: usize = *last_insert_len;
    for (i, j) in orig_dist_cache
        .split_at_mut(4)
        .0
        .iter_mut()
        .zip(dist_cache.split_at(4).0)
    {
        *i = *j;
    }
    let orig_num_commands: usize = *num_commands;
    nodes = if num_bytes.wrapping_add(1) > 0usize {
        <Alloc as Allocator<ZopfliNode>>::alloc_cell(alloc, num_bytes.wrapping_add(1))
    } else {
        <Alloc as Allocator<ZopfliNode>>::AllocatedMemory::default()
    };
    if !(0i32 == 0) {
        return;
    }
    model = ZopfliCostModel::init(alloc, &params.dist, num_bytes);
    if !(0i32 == 0) {
        return;
    }
    for i in 0usize..2usize {
        BrotliInitZopfliNodes(nodes.slice_mut(), num_bytes.wrapping_add(1));
        if i == 0usize {
            model.set_from_literal_costs(position, ringbuffer, ringbuffer_mask);
        } else {
            model.set_from_commands(
                position,
                ringbuffer,
                ringbuffer_mask,
                commands,
                num_commands.wrapping_sub(orig_num_commands),
                orig_last_insert_len,
            );
        }
        *num_commands = orig_num_commands;
        *num_literals = orig_num_literals;
        *last_insert_len = orig_last_insert_len;
        for (i, j) in dist_cache
            .split_at_mut(4)
            .0
            .iter_mut()
            .zip(orig_dist_cache.split_at(4).0)
        {
            *i = *j;
        }
        *num_commands = num_commands.wrapping_add(ZopfliIterate(
            num_bytes,
            position,
            ringbuffer,
            ringbuffer_mask,
            params,
            max_backward_limit,
            gap,
            dist_cache,
            &mut model,
            num_matches.slice(),
            matches.slice(),
            nodes.slice_mut(),
        ));
        BrotliZopfliCreateCommands(
            num_bytes,
            position,
            max_backward_limit,
            nodes.slice(),
            dist_cache,
            last_insert_len,
            params,
            commands,
            num_literals,
        );
    }
    model.cleanup(alloc);
    <Alloc as Allocator<ZopfliNode>>::free_cell(alloc, nodes);
    <Alloc as Allocator<u64>>::free_cell(alloc, matches);
    <Alloc as Allocator<u32>>::free_cell(alloc, num_matches);
}

#[cfg(test)]
mod fast_tests {
    use super::*;
    #[test]
    fn copy_code_table_matches() {
        for l in 2..3000usize {
            assert_eq!(CopyCodeAndRunEnd(l), (GetCopyLengthCode(l), CopyLengthCodeRunEnd(l)), "l={}", l);
        }
    }
    #[test]
    fn copy_length_code_run_end() {
        for l in 2..20000usize {
            let e = CopyLengthCodeRunEnd(l);
            let c = GetCopyLengthCode(l);
            if e != usize::MAX {
                assert_eq!(GetCopyLengthCode(e), c, "l={}", l);
                assert_ne!(GetCopyLengthCode(e + 1), c, "l={}", l);
            }
            for m in l..=e.min(20000) {
                assert_eq!(GetCopyLengthCode(m), c);
            }
        }
    }
}

/// fast-brotli-wasm (benchmarks only): the match finding of
/// BrotliCreateHqZopfliBackwardReferences (FindAllMatchesH10 over every
/// position, with the long-match skip) on `input` at quality 11; returns a
/// checksum of the matches.
#[cfg(feature = "fast-bench")]
pub fn FastBenchFindAllMatches(input: &[u8]) -> u64 {
    use super::hash_to_binary_tree::InitializeH10;
    use enc::StandardAlloc;
    let mut params = BrotliEncoderParams::default();
    params.quality = 11;
    let n = input.len();
    let mut rb = std::vec::Vec::with_capacity(n + 64);
    rb.extend_from_slice(input);
    rb.resize(n + 64, 0);
    let mut alloc = StandardAlloc::default();
    let mut hasher = InitializeH10(&mut alloc, true, &params, n);
    let mask = (1usize << 24) - 1;
    let max_backward_limit = (1usize << params.lgwin) - 16;
    let mut matches = [0u64; 256];
    let mut sum = 0u64;
    let store_end = if n >= 128 { n - 128 + 1 } else { 0 };
    let mut i = 0usize;
    while i + 3 < n {
        let max_distance = min(i, max_backward_limit);
        let num = FindAllMatchesH10(
            &mut hasher,
            Some(&kBrotliEncDictionary),
            &rb,
            mask,
            i,
            n - i,
            max_distance,
            0,
            &params,
            &mut matches[..],
        );
        for m in &matches[..num] {
            sum = sum.wrapping_mul(31).wrapping_add(*m);
        }
        if num > 0 {
            let match_len = BackwardMatchLength(&BackwardMatch(matches[num - 1]));
            if match_len > 325 {
                hasher.StoreRange(&rb, mask, i + 1, min(i + match_len, store_end));
                i += match_len - 1;
            }
        }
        i += 1;
    }
    hasher.free(&mut alloc);
    sum
}
