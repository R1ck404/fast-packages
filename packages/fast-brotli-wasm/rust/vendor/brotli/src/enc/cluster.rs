#![allow(dead_code)]
use super::bit_cost::{
    BrotliPopulationCost, PopulationCostOfBins, PopulationCostOfBinsLimited, PopulationCostOfBitmap,
};
use super::histogram::{
    CostAccessors, HistogramAddHistogram, HistogramClear, HistogramSelfAddHistogram,
};
use super::util::FastLog2;
use alloc;
use alloc::{Allocator, SliceWrapper, SliceWrapperMut};
use core;
use core::cmp::min;
// fast-brotli-wasm: repr(C) for the 4-pair SIMD filter (field order)
#[derive(Clone, Copy)]
#[repr(C)]
pub struct HistogramPair {
    pub idx1: u32,
    pub idx2: u32,
    pub cost_combo: super::util::floatX,
    pub cost_diff: super::util::floatX,
}

impl Default for HistogramPair {
    #[inline(always)]
    fn default() -> HistogramPair {
        HistogramPair {
            idx1: 0,
            idx2: 0,
            cost_combo: 0.0 as super::util::floatX,
            cost_diff: 0.0 as super::util::floatX,
        }
    }
}
/* Returns entropy reduction of the context map when we combine two clusters. */
#[inline(always)]
fn ClusterCostDiff(size_a: usize, size_b: usize) -> super::util::floatX {
    let size_c: usize = size_a.wrapping_add(size_b);
    size_a as (super::util::floatX) * FastLog2(size_a as u64)
        + size_b as (super::util::floatX) * FastLog2(size_b as u64)
        - size_c as (super::util::floatX) * FastLog2(size_c as u64)
}

#[inline(always)]
fn HistogramPairIsLess(p1: &HistogramPair, p2: &HistogramPair) -> bool {
    if p1.cost_diff != p2.cost_diff {
        p1.cost_diff > p2.cost_diff
    } else {
        p1.idx2.wrapping_sub(p1.idx1) > p2.idx2.wrapping_sub(p2.idx1)
    }
}

/// fast-brotli-wasm: for pairs base[i..i+4]: if none involves idx a or b and
/// none is better than base[0] (!HistogramPairIsLess(base[0], p)), moves them
/// to base[to..to+4] (to < i, to != 0) and returns true (what the filter
/// loop would do with them); otherwise does nothing and returns false.
#[cfg(target_arch = "wasm32")]
#[inline(always)]
unsafe fn PairGroupPlainMove(base: *mut HistogramPair, i: usize, to: usize, a: u32, b: u32) -> bool {
    use core::arch::wasm32::*;
    let p = base.add(i) as *const v128;
    let p0 = v128_load(p);
    let p1 = v128_load(p.add(1));
    let p2 = v128_load(p.add(2));
    let p3 = v128_load(p.add(3));
    // lanes: idx1, idx2, cost_combo, cost_diff
    let t0 = i32x4_shuffle::<0, 4, 1, 5>(p0, p1); // i1(0) i1(1) i2(0) i2(1)
    let t1 = i32x4_shuffle::<0, 4, 1, 5>(p2, p3);
    let idx1 = i32x4_shuffle::<0, 1, 4, 5>(t0, t1);
    let idx2 = i32x4_shuffle::<2, 3, 6, 7>(t0, t1);
    let c0 = i32x4_shuffle::<3, 7, 2, 6>(p0, p1); // cd(0) cd(1) ..
    let c1 = i32x4_shuffle::<3, 7, 2, 6>(p2, p3);
    let cd = i32x4_shuffle::<0, 1, 4, 5>(c0, c1);
    let va = u32x4_splat(a);
    let vb = u32x4_splat(b);
    let rm = v128_or(
        v128_or(i32x4_eq(idx1, va), i32x4_eq(idx2, va)),
        v128_or(i32x4_eq(idx1, vb), i32x4_eq(idx2, vb)),
    );
    let front = &*base;
    // HistogramPairIsLess(front, p): cd differ ? front.cd > p.cd : front.d > p.d
    let fcd = f32x4_splat(front.cost_diff);
    let fd = u32x4_splat(front.idx2.wrapping_sub(front.idx1));
    let d = i32x4_sub(idx2, idx1);
    let better = v128_bitselect(f32x4_gt(fcd, cd), u32x4_gt(fd, d), f32x4_ne(fcd, cd));
    if v128_any_true(v128_or(rm, better)) {
        return false;
    }
    let q = base.add(to) as *mut v128;
    v128_store(q, p0);
    v128_store(q.add(1), p1);
    v128_store(q.add(2), p2);
    v128_store(q.add(3), p3);
    true
}

/// fast-brotli-wasm: bitmaps cover alphabets up to this many 64-bin words
const BITMAP_WORDS: usize = 12;

/// fast-brotli-wasm: bit i of `bm` = (h[i] != 0)
fn NonzeroBitmap(h: &[u32], bm: &mut [u64]) {
    for (w, word) in bm.iter_mut().enumerate() {
        let lo = w << 6;
        let hi = min(h.len(), lo + 64);
        let mut m = 0u64;
        for i in lo..hi {
            m |= ((h[i] != 0) as u64) << (i - lo);
        }
        *word = m;
    }
}

/* Computes the bit cost reduction by combining out[idx1] and out[idx2] and if
it is below a threshold, stores the pair (idx1, idx2) in the *pairs queue. */
fn BrotliCompareAndPushToQueue<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
>(
    out: &[HistogramType],
    cluster_size: &[u32],
    mut idx1: u32,
    mut idx2: u32,
    max_num_pairs: usize,
    scratch_space: &mut HistogramType::i32vec,
    pairs: &mut [HistogramPair],
    num_pairs: &mut usize,
    bm: &[u64],
    words: usize,
) {
    let mut is_good_pair: i32 = 0i32;
    let mut p: HistogramPair = HistogramPair {
        idx1: 0,
        idx2: 0,
        cost_combo: 0.0,
        cost_diff: 0.0,
    };
    if idx1 == idx2 {
    } else {
        if idx2 < idx1 {
            core::mem::swap(&mut idx2, &mut idx1);
        }
        p.idx1 = idx1;
        p.idx2 = idx2;
        p.cost_diff = 0.5 as super::util::floatX
            * ClusterCostDiff(
                cluster_size[idx1 as usize] as usize,
                cluster_size[idx2 as usize] as usize,
            );
        p.cost_diff -= (out[idx1 as usize]).bit_cost();
        p.cost_diff -= (out[idx2 as usize]).bit_cost();
        if (out[idx1 as usize]).total_count() == 0usize {
            p.cost_combo = (out[idx2 as usize]).bit_cost();
            is_good_pair = 1i32;
        } else if (out[idx2 as usize]).total_count() == 0usize {
            p.cost_combo = (out[idx1 as usize]).bit_cost();
            is_good_pair = 1i32;
        } else {
            let threshold: super::util::floatX = if *num_pairs == 0usize {
                1e38 as super::util::floatX
            } else {
                pairs[0].cost_diff.max(0.0)
            };

            // fast-brotli-wasm: the cost of the sum without building it, and
            // only as far as needed to know whether it is below the limit
            let cost_combo: super::util::floatX = if words != 0 {
                // (the nonzero bins of the sum are in the union of the bitmaps)
                let mut u = [0u64; BITMAP_WORDS];
                let b1 = &bm[idx1 as usize * words..idx1 as usize * words + words];
                let b2 = &bm[idx2 as usize * words..idx2 as usize * words + words];
                for w in 0..words {
                    u[w] = b1[w] | b2[w];
                }
                PopulationCostOfBitmap(
                    out[idx1 as usize].slice(),
                    out[idx2 as usize].slice(),
                    &u[..words],
                    out[idx1 as usize]
                        .total_count()
                        .wrapping_add(out[idx2 as usize].total_count()),
                    0.0,
                    threshold - p.cost_diff,
                )
            } else if out[idx1 as usize].slice().len() == out[idx2 as usize].slice().len() {
                PopulationCostOfBinsLimited(
                    out[idx1 as usize].slice(),
                    Some(out[idx2 as usize].slice()),
                    out[idx1 as usize]
                        .total_count()
                        .wrapping_add(out[idx2 as usize].total_count()),
                    0.0,
                    threshold - p.cost_diff,
                )
            } else {
                let mut combo: HistogramType = out[idx1 as usize].clone();
                HistogramAddHistogram(&mut combo, &out[idx2 as usize]);
                BrotliPopulationCost(&combo, scratch_space)
            };
            if cost_combo < threshold - p.cost_diff {
                p.cost_combo = cost_combo;
                is_good_pair = 1i32;
            }
        }
        if is_good_pair != 0 {
            p.cost_diff += p.cost_combo;
            if *num_pairs > 0usize && HistogramPairIsLess(&pairs[0], &p) {
                /* Replace the top of the queue if needed. */
                if *num_pairs < max_num_pairs {
                    pairs[*num_pairs] = pairs[0];
                    *num_pairs = num_pairs.wrapping_add(1);
                }
                pairs[0] = p;
            } else if *num_pairs < max_num_pairs {
                pairs[*num_pairs] = p;
                *num_pairs = num_pairs.wrapping_add(1);
            }
        }
    }
}

pub fn BrotliHistogramCombine<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
>(
    out: &mut [HistogramType],
    cluster_size: &mut [u32],
    symbols: &mut [u32],
    clusters: &mut [u32],
    pairs: &mut [HistogramPair],
    mut num_clusters: usize,
    symbols_size: usize,
    max_clusters: usize,
    max_num_pairs: usize,
    scratch_space: &mut HistogramType::i32vec,
) -> usize {
    let mut cost_diff_threshold: super::util::floatX = 0.0 as super::util::floatX;
    let mut min_cluster_size: usize = 1;
    let mut num_pairs: usize = 0usize;
    // fast-brotli-wasm: bitmaps of the nonzero bins of the clusters' histograms
    // (kept up to date on merges), so that pair costs only visit those bins
    let words = if num_clusters != 0 {
        (out[clusters[0] as usize].slice().len() + 63) >> 6
    } else {
        0
    };
    let words = if words <= BITMAP_WORDS { words } else { 0 };
    let mut bm = std::vec::Vec::<u64>::new();
    if words != 0 {
        bm.resize(out.len() * words, 0);
        for &c in clusters[..num_clusters].iter() {
            let h = out[c as usize].slice();
            NonzeroBitmap(h, &mut bm[c as usize * words..c as usize * words + words]);
        }
    }
    {
        /* We maintain a vector of histogram pairs, with the property that the pair
        with the maximum bit cost reduction is the first. */
        for idx1 in 0..num_clusters {
            for idx2 in idx1 + 1..num_clusters {
                BrotliCompareAndPushToQueue(
                    out,
                    cluster_size,
                    clusters[idx1],
                    clusters[idx2],
                    max_num_pairs,
                    scratch_space,
                    pairs,
                    &mut num_pairs,
                    &bm,
                    words,
                );
            }
        }
    }
    while num_clusters > min_cluster_size {
        let mut i: usize;
        if (pairs[0]).cost_diff >= cost_diff_threshold {
            cost_diff_threshold = 1e38 as super::util::floatX;
            min_cluster_size = max_clusters;
            {
                continue;
            }
        }
        /* Take the best pair from the top of heap. */
        let best_idx1: u32 = (pairs[0]).idx1;
        let best_idx2: u32 = (pairs[0]).idx2;
        HistogramSelfAddHistogram(out, (best_idx1 as usize), (best_idx2 as usize));
        for w in 0..words {
            let v = bm[best_idx2 as usize * words + w];
            bm[best_idx1 as usize * words + w] |= v;
        }
        (out[(best_idx1 as usize)]).set_bit_cost((pairs[0]).cost_combo);
        {
            let _rhs = cluster_size[(best_idx2 as usize)];
            let _lhs = &mut cluster_size[(best_idx1 as usize)];
            *_lhs = (*_lhs).wrapping_add(_rhs);
        }
        for i in 0usize..symbols_size {
            if symbols[i] == best_idx2 {
                symbols[i] = best_idx1;
            }
        }
        i = 0usize;
        'break9: while i < num_clusters {
            {
                if clusters[i] == best_idx2 {
                    for offset in 0..(num_clusters - i - 1) {
                        clusters[i + offset] = clusters[i + 1 + offset];
                    }
                    break 'break9;
                }
            }
            i = i.wrapping_add(1);
        }
        num_clusters = num_clusters.wrapping_sub(1);
        {
            /* Remove pairs intersecting the just combined best pair. */
            // fast-brotli-wasm: the same loop over raw pointers; groups of
            // four pairs that are all kept and none of which beats pairs[0]
            // (the common case) are moved at once
            let n = min(num_pairs, pairs.len());
            let mut copy_to_idx: usize = 0usize;
            unsafe {
                let base = pairs.as_mut_ptr();
                let mut i = 0usize;
                while i < n {
                    #[cfg(target_arch = "wasm32")]
                    if copy_to_idx != 0 && i + 4 <= n {
                        if PairGroupPlainMove(base, i, copy_to_idx, best_idx1, best_idx2) {
                            i += 4;
                            copy_to_idx += 4;
                            continue;
                        }
                    }
                    let p: HistogramPair = *base.add(i);
                    i += 1;
                    if (p.idx1 == best_idx1)
                        | (p.idx2 == best_idx1)
                        | (p.idx1 == best_idx2)
                        | (p.idx2 == best_idx2)
                    {
                        /* Remove invalid pair from the queue. */
                        continue;
                    }
                    let front: HistogramPair = *base;
                    if HistogramPairIsLess(&front, &p) {
                        /* Replace the top of the queue if needed. */
                        *base = p;
                        *base.add(copy_to_idx) = front;
                    } else {
                        *base.add(copy_to_idx) = p;
                    }
                    copy_to_idx += 1;
                }
            }
            num_pairs = copy_to_idx;
        }
        for i in 0usize..num_clusters {
            BrotliCompareAndPushToQueue(
                out,
                cluster_size,
                best_idx1,
                clusters[i],
                max_num_pairs,
                scratch_space,
                pairs,
                &mut num_pairs,
                &bm,
                words,
            );
        }
    }
    num_clusters
}

/// fast-brotli-wasm: BrotliHistogramBitCostDistance(histogram, candidate)
/// when the caller only needs to know whether it is below `limit` (+inf when
/// it is certainly not), without building the sum.
#[inline(always)]
pub fn HistogramBitCostDistanceBelow<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
>(
    histogram: &HistogramType,
    candidate: &HistogramType,
    scratch_space: &mut HistogramType::i32vec,
    limit: super::util::floatX,
) -> super::util::floatX {
    if histogram.total_count() == 0usize {
        0.0 as super::util::floatX
    } else if histogram.slice().len() == candidate.slice().len() {
        PopulationCostOfBinsLimited(
            histogram.slice(),
            Some(candidate.slice()),
            histogram.total_count() + candidate.total_count(),
            candidate.bit_cost(),
            limit,
        ) - candidate.bit_cost()
    } else {
        BrotliHistogramBitCostDistance(histogram, candidate, scratch_space)
    }
}

/* What is the bit cost of moving histogram from cur_symbol to candidate. */
#[inline(always)]
pub fn BrotliHistogramBitCostDistance<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
>(
    histogram: &HistogramType,
    candidate: &HistogramType,
    scratch_space: &mut HistogramType::i32vec,
) -> super::util::floatX {
    if histogram.total_count() == 0usize {
        0.0 as super::util::floatX
    } else {
        let mut tmp: HistogramType = histogram.clone();
        HistogramAddHistogram(&mut tmp, candidate);
        BrotliPopulationCost(&tmp, scratch_space) - candidate.bit_cost()
    }
}

/* Find the best 'out' histogram for each of the 'in' histograms.
When called, clusters[0..num_clusters) contains the unique values from
symbols[0..in_size), but this property is not preserved in this function.
Note: we assume that out[]->bit_cost_ is already up-to-date. */

pub fn BrotliHistogramRemap<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
>(
    inp: &[HistogramType],
    in_size: usize,
    clusters: &[u32],
    num_clusters: usize,
    scratch_space: &mut HistogramType::i32vec,
    out: &mut [HistogramType],
    symbols: &mut [u32],
) {
    for i in 0usize..in_size {
        let mut best_out: u32 = if i == 0usize {
            symbols[0]
        } else {
            symbols[i.wrapping_sub(1)]
        };
        let mut best_bits: super::util::floatX = HistogramBitCostDistanceBelow(
            &inp[i],
            &out[(best_out as usize)],
            scratch_space,
            super::util::floatX::INFINITY,
        );
        for j in 0usize..num_clusters {
            let cur_bits: super::util::floatX = HistogramBitCostDistanceBelow(
                &inp[i],
                &out[(clusters[j] as usize)],
                scratch_space,
                best_bits,
            );
            if cur_bits < best_bits {
                best_bits = cur_bits;
                best_out = clusters[j];
            }
        }
        symbols[i] = best_out;
    }
    for i in 0usize..num_clusters {
        HistogramClear(&mut out[(clusters[i] as usize)]);
    }
    for i in 0usize..in_size {
        HistogramAddHistogram(&mut out[(symbols[i] as usize)], &inp[i]);
    }
}

/* Reorders elements of the out[0..length) array and changes values in
symbols[0..length) array in the following way:
  * when called, symbols[] contains indexes into out[], and has N unique
    values (possibly N < length)
  * on return, symbols'[i] = f(symbols[i]) and
               out'[symbols'[i]] = out[symbols[i]], for each 0 <= i < length,
    where f is a bijection between the range of symbols[] and [0..N), and
    the first occurrences of values in symbols'[i] come in consecutive
    increasing order.
Returns N, the number of unique values in symbols[]. */
pub fn BrotliHistogramReindex<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
    Alloc: alloc::Allocator<u32> + alloc::Allocator<HistogramType>,
>(
    alloc: &mut Alloc,
    out: &mut [HistogramType],
    symbols: &mut [u32],
    length: usize,
) -> usize {
    static kInvalidIndex: u32 = !(0u32);
    let mut new_index = if length != 0 {
        <Alloc as Allocator<u32>>::alloc_cell(alloc, length)
    } else {
        <Alloc as Allocator<u32>>::AllocatedMemory::default()
    };
    let mut next_index: u32;
    let mut tmp: <Alloc as Allocator<HistogramType>>::AllocatedMemory;
    for i in 0usize..length {
        new_index.slice_mut()[i] = kInvalidIndex;
    }
    next_index = 0u32;
    for i in 0usize..length {
        if new_index.slice()[(symbols[i] as usize)] == kInvalidIndex {
            new_index.slice_mut()[(symbols[i] as usize)] = next_index;
            next_index = next_index.wrapping_add(1);
        }
    }
    tmp = if next_index != 0 {
        <Alloc as Allocator<HistogramType>>::alloc_cell(alloc, next_index as usize)
    } else {
        <Alloc as Allocator<HistogramType>>::AllocatedMemory::default()
    };
    next_index = 0u32;
    for i in 0usize..length {
        if new_index.slice()[(symbols[i] as usize)] == next_index {
            tmp.slice_mut()[(next_index as usize)] = out[(symbols[i] as usize)].clone();
            next_index = next_index.wrapping_add(1);
        }
        symbols[i] = new_index.slice()[(symbols[i] as usize)];
    }
    {
        <Alloc as Allocator<u32>>::free_cell(alloc, new_index);
    }
    for i in 0usize..next_index as usize {
        out[i] = tmp.slice()[i].clone();
    }
    {
        <Alloc as Allocator<HistogramType>>::free_cell(alloc, tmp)
    }
    next_index as usize
}

pub fn BrotliClusterHistograms<
    HistogramType: SliceWrapperMut<u32> + SliceWrapper<u32> + CostAccessors + Clone,
    Alloc: alloc::Allocator<u32> + alloc::Allocator<HistogramPair> + alloc::Allocator<HistogramType>,
>(
    alloc: &mut Alloc,
    inp: &[HistogramType],
    in_size: usize,
    max_histograms: usize,
    scratch_space: &mut HistogramType::i32vec,
    out: &mut [HistogramType],
    out_size: &mut usize,
    histogram_symbols: &mut [u32],
) {
    let mut cluster_size = if in_size != 0 {
        <Alloc as Allocator<u32>>::alloc_cell(alloc, in_size)
    } else {
        <Alloc as Allocator<u32>>::AllocatedMemory::default()
    };
    let mut clusters = if in_size != 0 {
        <Alloc as Allocator<u32>>::alloc_cell(alloc, in_size)
    } else {
        <Alloc as Allocator<u32>>::AllocatedMemory::default()
    };
    let mut num_clusters: usize = 0usize;
    let max_input_histograms: usize = 64usize;
    let pairs_capacity: usize = max_input_histograms
        .wrapping_mul(max_input_histograms)
        .wrapping_div(2);
    let mut pairs =
        <Alloc as Allocator<HistogramPair>>::alloc_cell(alloc, pairs_capacity.wrapping_add(1));
    let mut i: usize;
    for i in 0usize..in_size {
        cluster_size.slice_mut()[i] = 1u32;
    }
    for i in 0usize..in_size {
        out[i] = inp[i].clone();
        (out[i]).set_bit_cost(BrotliPopulationCost(&inp[i], scratch_space));
        histogram_symbols[i] = i as u32;
    }
    i = 0usize;
    while i < in_size {
        {
            let num_to_combine: usize = min(in_size.wrapping_sub(i), max_input_histograms);

            for j in 0usize..num_to_combine {
                clusters.slice_mut()[num_clusters.wrapping_add(j)] = i.wrapping_add(j) as u32;
            }
            let num_new_clusters: usize = BrotliHistogramCombine(
                out,
                cluster_size.slice_mut(),
                &mut histogram_symbols[i..],
                &mut clusters.slice_mut()[num_clusters..],
                pairs.slice_mut(),
                num_to_combine,
                num_to_combine,
                max_histograms,
                pairs_capacity,
                scratch_space,
            );
            num_clusters = num_clusters.wrapping_add(num_new_clusters);
        }
        i = i.wrapping_add(max_input_histograms);
    }
    {
        let max_num_pairs: usize = min(
            (64usize).wrapping_mul(num_clusters),
            num_clusters.wrapping_div(2).wrapping_mul(num_clusters),
        );
        {
            if pairs_capacity < max_num_pairs.wrapping_add(1) {
                let mut _new_size: usize = if pairs_capacity == 0usize {
                    max_num_pairs.wrapping_add(1)
                } else {
                    pairs_capacity
                };
                let mut new_array: <Alloc as Allocator<HistogramPair>>::AllocatedMemory;
                while _new_size < max_num_pairs.wrapping_add(1) {
                    _new_size = _new_size.wrapping_mul(2);
                }
                new_array = if _new_size != 0 {
                    <Alloc as Allocator<HistogramPair>>::alloc_cell(alloc, _new_size)
                } else {
                    <Alloc as Allocator<HistogramPair>>::AllocatedMemory::default()
                };
                new_array.slice_mut()[..pairs_capacity]
                    .clone_from_slice(&pairs.slice()[..pairs_capacity]);
                <Alloc as Allocator<HistogramPair>>::free_cell(
                    alloc,
                    core::mem::replace(&mut pairs, new_array),
                );
            }
        }
        num_clusters = BrotliHistogramCombine(
            out,
            cluster_size.slice_mut(),
            histogram_symbols,
            clusters.slice_mut(),
            pairs.slice_mut(),
            num_clusters,
            in_size,
            max_histograms,
            max_num_pairs,
            scratch_space,
        );
    }
    <Alloc as Allocator<HistogramPair>>::free_cell(alloc, pairs);
    <Alloc as Allocator<u32>>::free_cell(alloc, cluster_size);
    BrotliHistogramRemap(
        inp,
        in_size,
        clusters.slice(),
        num_clusters,
        scratch_space,
        out,
        histogram_symbols,
    );
    <Alloc as Allocator<u32>>::free_cell(alloc, clusters);
    *out_size = BrotliHistogramReindex(alloc, out, histogram_symbols, in_size);
}

/////////// DONE //////////////////////////
