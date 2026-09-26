| case                                              | wasm                 | native                      |
|---------------------------------------------------|----------------------|-----------------------------|
| esm->cjs zod-errors.js (1.6KB esm)                | 10.23 ms (0.2 MB/s)  | 1.43 ms (1.1 MB/s)  x7.14   |
| esm->cjs zod-schemas.js (51KB esm)                | 49.29 ms (1.0 MB/s)  | 8.24 ms (6.2 MB/s)  x5.98   |
| esm->cjs rollup node-entry (948KB esm)            | 406.28 ms (2.3 MB/s) | 83.99 ms (11.3 MB/s)  x4.84 |
| esm->cjs three.module (1.2MB esm)                 | 201.93 ms (3.3 MB/s) | 46.17 ms (14.4 MB/s)  x4.37 |
| cjs passthrough react-dom-client.prod (536KB cjs) | 173.30 ms (3.1 MB/s) | 40.51 ms (13.2 MB/s)  x4.28 |
| cjs passthrough babel-parser (513KB cjs)          | 212.05 ms (2.4 MB/s) | 45.12 ms (11.4 MB/s)  x4.70 |
| esm->cjs batch 17 zod/v4/core files               | 328.95 ms (0.7 MB/s) | 45.39 ms (4.9 MB/s)  x7.25  |
| ts->esm script-engine.ts (141KB)                  | 62.73 ms (2.3 MB/s)  | 13.38 ms (10.8 MB/s)  x4.69 |
| ts->cjs script-engine.ts                          | 62.47 ms (2.3 MB/s)  | 13.41 ms (10.8 MB/s)  x4.66 |
| ts->esm memory-volume.ts (138KB)                  | 61.87 ms (2.3 MB/s)  | 13.55 ms (10.5 MB/s)  x4.57 |
| ts->cjs memory-volume.ts                          | 63.22 ms (2.2 MB/s)  | 13.55 ms (10.5 MB/s)  x4.66 |
| ts->esm syntax-transforms.ts (25KB)               | 16.17 ms (1.6 MB/s)  | 3.55 ms (7.4 MB/s)  x4.55   |
| ts->cjs syntax-transforms.ts                      | 30.38 ms (0.9 MB/s)  | 4.06 ms (6.5 MB/s)  x7.48   |
| ts->esm module-transformer.ts (9KB)               | 19.60 ms (0.5 MB/s)  | 1.89 ms (5.4 MB/s)  x10.34  |
| ts->cjs module-transformer.ts                     | 24.96 ms (0.4 MB/s)  | 2.20 ms (4.6 MB/s)  x11.35  |
| tsx->js small component x20                       | 23.44 ms (0.2 MB/s)  | 1.76 ms (2.5 MB/s)  x13.35  |
| build bundle zod (plugin fs)                      | 1.29 s               | 32.95 ms  x39.10            |

```json
{
 "wasm": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 10.23339999999996,
   "min": 6.679399999999987,
   "samples": 84,
   "batch": 1,
   "mbps": 0.15723024605702957
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 49.287250000000085,
   "min": 37.74359999999979,
   "samples": 20,
   "batch": 1,
   "mbps": 1.0423791142739736
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 406.28164999999944,
   "min": 366.7687999999989,
   "samples": 10,
   "batch": 1,
   "mbps": 2.3334871264798727
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 201.92799999999988,
   "min": 184.1222999999991,
   "samples": 10,
   "batch": 1,
   "mbps": 3.282219404936415
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 173.29759999999897,
   "min": 158.32330000000002,
   "samples": 10,
   "batch": 1,
   "mbps": 3.0930376416061343
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 212.04674999999952,
   "min": 189.45740000000114,
   "samples": 10,
   "batch": 1,
   "mbps": 2.4202870357598085
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 328.95014999999876,
   "min": 311.67029999999795,
   "samples": 10,
   "batch": 1,
   "mbps": 0.669183461384653
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 62.733100000001286,
   "min": 56.2586999999985,
   "samples": 17,
   "batch": 1,
   "mbps": 2.3079682017945395
  },
  "ts->cjs script-engine.ts": {
   "impl": "wasm",
   "name": "ts->cjs script-engine.ts",
   "ms": 62.46930000000066,
   "min": 58.81299999999828,
   "samples": 16,
   "batch": 1,
   "mbps": 2.3177144613433875
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 61.865600000000995,
   "min": 60.077000000001135,
   "samples": 16,
   "batch": 1,
   "mbps": 2.29591242952461
  },
  "ts->cjs memory-volume.ts": {
   "impl": "wasm",
   "name": "ts->cjs memory-volume.ts",
   "ms": 63.224200000000565,
   "min": 60.30500000000029,
   "samples": 16,
   "batch": 1,
   "mbps": 2.246576469136798
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 16.16595000000052,
   "min": 14.861399999999776,
   "samples": 29,
   "batch": 2,
   "mbps": 1.633000225783152
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "wasm",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 30.383200000000215,
   "min": 20.481050000000323,
   "samples": 19,
   "batch": 2,
   "mbps": 0.8688683219673968
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 19.59717499999988,
   "min": 14.45154999999977,
   "samples": 26,
   "batch": 2,
   "mbps": 0.5208914039906294
  },
  "ts->cjs module-transformer.ts": {
   "impl": "wasm",
   "name": "ts->cjs module-transformer.ts",
   "ms": 24.96140000000014,
   "min": 13.317500000001019,
   "samples": 19,
   "batch": 2,
   "mbps": 0.40895142099401244
  },
  "tsx->js small component x20": {
   "impl": "wasm",
   "name": "tsx->js small component x20",
   "ms": 23.440300000000207,
   "min": 12.91714999999931,
   "samples": 21,
   "batch": 2,
   "mbps": 0.19056923332892328
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 1288.2859499999977,
   "min": 1219.1655000000028,
   "samples": 10,
   "batch": 1
  }
 },
 "native": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 1.4327666666666725,
   "min": 1.3281066666666674,
   "samples": 45,
   "batch": 15,
   "mbps": 1.1230021171160647
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 8.242533333333236,
   "min": 7.208766666666634,
   "samples": 39,
   "batch": 3,
   "mbps": 6.233035151005428
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "native",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 83.9858999999999,
   "min": 80.13220000000001,
   "samples": 12,
   "batch": 1,
   "mbps": 11.2882400498179
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "native",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 46.16509999999971,
   "min": 44.230099999999766,
   "samples": 22,
   "batch": 1,
   "mbps": 14.356559392268275
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 40.50510000000031,
   "min": 37.22320000000036,
   "samples": 25,
   "batch": 1,
   "mbps": 13.233296547842022
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 45.12219999999979,
   "min": 42.72270000000026,
   "samples": 22,
   "batch": 1,
   "mbps": 11.373869181910507
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "native",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 45.38580000000002,
   "min": 43.22400000000016,
   "samples": 23,
   "batch": 1,
   "mbps": 4.850151368930368
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "native",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 13.378975000000082,
   "min": 12.345100000000457,
   "samples": 38,
   "batch": 2,
   "mbps": 10.821905265537838
  },
  "ts->cjs script-engine.ts": {
   "impl": "native",
   "name": "ts->cjs script-engine.ts",
   "ms": 13.409599999999955,
   "min": 12.646549999999479,
   "samples": 37,
   "batch": 2,
   "mbps": 10.797190072783714
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "native",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 13.551350000000184,
   "min": 12.670250000000124,
   "samples": 36,
   "batch": 2,
   "mbps": 10.48146494629672
  },
  "ts->cjs memory-volume.ts": {
   "impl": "native",
   "name": "ts->cjs memory-volume.ts",
   "ms": 13.553200000000288,
   "min": 12.654000000000451,
   "samples": 37,
   "batch": 2,
   "mbps": 10.480034235457087
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "native",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 3.5527750000001106,
   "min": 3.260200000000168,
   "samples": 35,
   "batch": 8,
   "mbps": 7.430529656395121
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "native",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 4.061742857142755,
   "min": 3.6172142857145184,
   "samples": 35,
   "batch": 7,
   "mbps": 6.4994267063401585
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "native",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.8944642857142233,
   "min": 1.7354571428573504,
   "samples": 38,
   "batch": 14,
   "mbps": 5.388330662645101
  },
  "ts->cjs module-transformer.ts": {
   "impl": "native",
   "name": "ts->cjs module-transformer.ts",
   "ms": 2.198954545454564,
   "min": 2.073681818181781,
   "samples": 41,
   "batch": 11,
   "mbps": 4.642206006986752
  },
  "tsx->js small component x20": {
   "impl": "native",
   "name": "tsx->js small component x20",
   "ms": 1.7553750000001207,
   "min": 1.6166857142857876,
   "samples": 40,
   "batch": 14,
   "mbps": 2.5447553941463745
  },
  "build bundle zod (plugin fs)": {
   "impl": "native",
   "name": "build bundle zod (plugin fs)",
   "ms": 32.95130000000063,
   "min": 25.32180000000153,
   "samples": 89,
   "batch": 1
  }
 }
}
```
