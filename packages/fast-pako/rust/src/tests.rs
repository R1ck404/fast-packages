// Native tests (cargo test --target x86_64-pc-windows-msvc). Debug builds
// have overflow checks, which catch index/accounting bugs in the fast paths.
// Run single-threaded (the crate uses wasm-style global state):
//   cargo test --release --target x86_64-pc-windows-msvc -- --test-threads=1

use crate::*;

fn corpus(name: &str) -> Vec<u8> {
    let p = format!("{}/../../corpus/{}", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {}", p))
}

/// streaming inflate with fixed push size; returns concatenated output
unsafe fn stream_inflate(data: &[u8], step: usize, fast: bool) -> Vec<u8> {
    crate::inflate::FAST_ON = fast;
    #[allow(static_mut_refs)]
    EMITTED.clear();
    let s = inf_init(core::ptr::null_mut(), 47, 65536, 1, 0);
    assert!(!s.is_null());
    let mut i = 0;
    while i < data.len() {
        let n = step.min(data.len() - i);
        let p = inf_input(s, n);
        core::ptr::copy_nonoverlapping(data.as_ptr().add(i), p, n);
        let r = inf_push(s, n, 0, 0);
        assert!(r >= 0, "push failed r={} at {}", r, i);
        let res = &*fz_res();
        if res.ended != 0 {
            assert_eq!(res.end_status, 0, "error status at {}", i);
            break;
        }
        i += n;
    }
    inf_destroy(s);
    let mut out = Vec::new();
    #[allow(static_mut_refs)]
    for (_, c) in EMITTED.iter() {
        out.extend_from_slice(c);
    }
    out
}

#[test]
fn streaming_fast_matches_slow() {
    let tgz = corpus("lodash-es-4.18.1.tgz");
    unsafe {
        let slow = stream_inflate(&tgz, 1000, false);
        for step in [1usize, 7, 100, 1000, 4096, 16384, 1 << 20] {
            let fast = stream_inflate(&tgz, step, true);
            assert_eq!(fast.len(), slow.len(), "step {}", step);
            assert!(fast == slow, "step {}", step);
        }
    }
}

#[test]
#[ignore]
fn native_inflate_speed() {
    // cargo test --release --target x86_64-pc-windows-msvc -- --ignored --nocapture native_inflate_speed
    let raw = std::env::var("RAW").is_ok();
    let tgz = corpus(if raw { "typescript.raw" } else { "typescript-5.9.3.tgz" });
    let wb: i32 = if raw { -15 } else { 47 };
    unsafe {
        let s = inf_init(core::ptr::null_mut(), wb, 65536, 0, 0);
        let mut best = f64::MAX;
        let mut out_len = 0;
        for _ in 0..8 {
            let cs: usize = std::env::var("CS").ok().map(|v| v.parse().unwrap()).unwrap_or(65536); let s = inf_init(s, wb, cs, 0, 0);
            let p = inf_input(s, tgz.len());
            core::ptr::copy_nonoverlapping(tgz.as_ptr(), p, tgz.len());
            let t0 = std::time::Instant::now();
            inf_push(s, tgz.len(), 0, 0);
            let dt = t0.elapsed().as_secs_f64();
            out_len = (*fz_res()).out_len;
            if dt < best { best = dt; }
        }
        println!("native tgz: {:.2} ms, {:.0} MB/s", best * 1e3, out_len as f64 / 1e6 / best);
    }
}

#[test]
#[ignore]
fn native_crc_speed() {
    let tgz = corpus("typescript-5.9.3.tgz");
    let big: Vec<u8> = tgz.iter().cycle().take(23 << 20).cloned().collect();
    let mut best = f64::MAX;
    let mut c = 0;
    for _ in 0..5 {
        let t0 = std::time::Instant::now();
        c = crate::checksum::crc32(0, &big);
        best = best.min(t0.elapsed().as_secs_f64());
    }
    println!("native crc32 23MB: {:.2} ms, {:.0} MB/s ({:x})", best * 1e3, big.len() as f64 / 1e6 / best, c);
}

#[test]
#[ignore]
fn native_table_build_cost() {
    // cost of building tables for a typical dynamic block
    let mut lens = [0u16; 320];
    // a plausible litlen code: 256 literals of len 8/9, lengths 7..12
    for i in 0..144 { lens[i] = 8; }
    for i in 144..256 { lens[i] = 9; }
    for i in 256..280 { lens[i] = 7; }
    for i in 280..288 { lens[i] = 8; }
    let mut t = vec![0u32; crate::fasttab::LSIZE];
    let mut z = vec![0u32; 4096];
    let mut work = [0u16; 288];
    let n = 20000;
    let t0 = std::time::Instant::now();
    let cnt = crate::fasttab::count_lens(&lens[..288]);
    for _ in 0..n { crate::fasttab::build(&lens, 288, &cnt, true, &mut t); }
    let a = t0.elapsed().as_secs_f64() / n as f64;
    let t0 = std::time::Instant::now();
    for _ in 0..n { let mut b = 10; crate::inftrees::inflate_table(crate::inftrees::LENS, &lens, 288, &mut z, &mut work, &mut b); }
    let b = t0.elapsed().as_secs_f64() / n as f64;
    println!("fasttab::build {:.2} us, inflate_table {:.2} us", a * 1e6, b * 1e6);
}

#[test]
fn crc32_sparse_matches_tables() {
    // xorshift data, many lengths around the thresholds and block sizes
    let mut x: u32 = 0x1234_5678;
    let mut data = vec![0u8; 200_000];
    for b in data.iter_mut() {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *b = x as u8;
    }
    let mut lens: Vec<usize> = vec![0, 1, 7, 8, 100, 2399, 2400, 2401, 4799, 4800, 7199, 7200, 7201, 7207, 7208, 16384, 16391, 18800, 18807, 19199, 65536, 65537, 100_003, 199_990];
    for i in 0..300 {
        lens.push(7000 + i * 97 % 60_000);
    }
    for (k, &n) in lens.iter().enumerate() {
        for off in [0usize, 1, 3, 5] {
            if off + n > data.len() {
                continue;
            }
            let b = &data[off..off + n];
            for init in [0u32, 0xffff_ffff, 0x1234_5678 ^ k as u32] {
                assert_eq!(crate::checksum::crc32(init, b), crate::checksum::crc32_tables(init, b), "len {} off {} init {:x}", n, off, init);
            }
        }
    }
    // all-zero and all-ones buffers
    let z = vec![0u8; 50_000];
    let o = vec![0xffu8; 50_000];
    assert_eq!(crate::checksum::crc32(0, &z), crate::checksum::crc32_tables(0, &z));
    assert_eq!(crate::checksum::crc32(7, &o), crate::checksum::crc32_tables(7, &o));
}

#[test]
fn chorba_relation() {
    // y = x^64 mod P (reflected: bit 31 = x^0); the sparse crc32 relies on
    // 1 + y^89 + y^117 + y^155 + y^300 = 0 (mod P)
    use crate::checksum::multmodp;
    let mut x64: u32 = 1 << 31;
    for _ in 0..64 {
        x64 = multmodp(1 << 30, x64);
    }
    let mut pw = vec![1u32 << 31];
    for k in 1..=300 {
        pw.push(multmodp(pw[k - 1], x64));
    }
    assert_eq!(pw[0] ^ pw[89] ^ pw[117] ^ pw[155] ^ pw[300], 0);
    assert_ne!(pw[0] ^ pw[89] ^ pw[117] ^ pw[155] ^ pw[299], 0);
}
