| case                                              | wasm      | prev              | fast             | native           |
|---------------------------------------------------|-----------|-------------------|------------------|------------------|
| esm->cjs zod-errors.js (1.6KB esm)                | 15.46 ms  | 143.3 us  x107.86 | 98.2 us  x157.43 | 621.5 us  x24.87 |
| esm->cjs zod-schemas.js (51KB esm)                | 15.69 ms  | 3.09 ms  x5.08    | 2.80 ms  x5.61   | 3.83 ms  x4.09   |
| esm->cjs rollup node-entry (948KB esm)            | 136.90 ms | 64.02 ms  x2.14   | 53.82 ms  x2.54  | 33.16 ms  x4.13  |
| esm->cjs three.module (1.2MB esm)                 | 77.01 ms  | 33.48 ms  x2.30   | 25.73 ms  x2.99  | 19.05 ms  x4.04  |
| cjs passthrough react-dom-client.prod (536KB cjs) | 62.60 ms  | 27.81 ms  x2.25   | 22.21 ms  x2.82  | 16.02 ms  x3.91  |
| cjs passthrough babel-parser (513KB cjs)          | 82.50 ms  | 34.32 ms  x2.40   | 29.60 ms  x2.79  | 17.93 ms  x4.60  |
| esm->cjs batch 17 zod/v4/core files               | 268.02 ms | 14.48 ms  x18.51  | 11.52 ms  x23.26 | 21.17 ms  x12.66 |
| ts->esm script-engine.ts (141KB)                  | 31.07 ms  | 7.86 ms  x3.95    | 5.99 ms  x5.19   | 5.52 ms  x5.62   |
| ts->cjs script-engine.ts                          | 31.06 ms  | 7.82 ms  x3.97    | 6.07 ms  x5.12   | 5.73 ms  x5.42   |
| ts->esm memory-volume.ts (138KB)                  | 31.39 ms  | 7.64 ms  x4.11    | 5.89 ms  x5.33   | 5.49 ms  x5.72   |
| ts->cjs memory-volume.ts                          | 31.28 ms  | 7.43 ms  x4.21    | 5.98 ms  x5.23   | 5.61 ms  x5.57   |
| ts->esm syntax-transforms.ts (25KB)               | 15.73 ms  | 1.34 ms  x11.69   | 1.12 ms  x13.99  | 1.57 ms  x10.01  |
| ts->cjs syntax-transforms.ts                      | 15.69 ms  | 1.48 ms  x10.58   | 1.20 ms  x13.12  | 1.68 ms  x9.33   |
| ts->esm module-transformer.ts (9KB)               | 15.80 ms  | 563.6 us  x28.03  | 461.9 us  x34.21 | 914.0 us  x17.29 |
| ts->cjs module-transformer.ts                     | 15.64 ms  | 603.7 us  x25.91  | 465.6 us  x33.60 | 1.03 ms  x15.23  |
| tsx->js small component x20                       | 15.59 ms  | 538.5 us  x28.95  | 430.0 us  x36.26 | 848.3 us  x18.38 |
| vite ts+sourcemap script-engine.ts                | 31.31 ms  | 9.66 ms  x3.24    | 7.61 ms  x4.12   | 7.02 ms  x4.46   |
| vite ts+sourcemap memory-volume.ts                | 31.34 ms  | 9.74 ms  x3.22    | 7.79 ms  x4.03   | 7.18 ms  x4.37   |
| vite tsx+sourcemap component x20                  | 15.67 ms  | 556.8 us  x28.14  | 462.3 us  x33.90 | 964.7 us  x16.24 |
| build bundle zod (plugin fs)                      | 1.16 s    | 132.40 ms  x8.77  | 133.92 ms  x8.67 | 12.94 ms  x89.76 |

```json
{
 "wasm": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 15.456250000000068,
   "min": 3.014599999999973,
   "samples": 102,
   "batch": 1,
   "mbps": 0.10410028305701531
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 15.687874999999963,
   "min": 13.150550000000067,
   "samples": 48,
   "batch": 2,
   "mbps": 3.274885859302176
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 136.90310000000045,
   "min": 128.54870000000028,
   "samples": 11,
   "batch": 1,
   "mbps": 6.924992932957668
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 77.01370000000043,
   "min": 67.21579999999994,
   "samples": 20,
   "batch": 1,
   "mbps": 8.605897392282106
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 62.60295000000042,
   "min": 60.208699999999226,
   "samples": 24,
   "batch": 1,
   "mbps": 8.562152422529552
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 82.5049999999992,
   "min": 65.9976999999999,
   "samples": 19,
   "batch": 1,
   "mbps": 6.22039876371135
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 268.0154499999999,
   "min": 235.9387000000006,
   "samples": 10,
   "batch": 1,
   "mbps": 0.8213257855097535
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 31.066899999999805,
   "min": 20.78189999999995,
   "samples": 50,
   "batch": 1,
   "mbps": 4.660458558787678
  },
  "ts->cjs script-engine.ts": {
   "impl": "wasm",
   "name": "ts->cjs script-engine.ts",
   "ms": 31.056649999998626,
   "min": 20.91939999999886,
   "samples": 50,
   "batch": 1,
   "mbps": 4.66199670601969
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 31.38589999999749,
   "min": 21.13249999999971,
   "samples": 47,
   "batch": 1,
   "mbps": 4.525535351862185
  },
  "ts->cjs memory-volume.ts": {
   "impl": "wasm",
   "name": "ts->cjs memory-volume.ts",
   "ms": 31.275699999998324,
   "min": 19.753899999999703,
   "samples": 49,
   "batch": 1,
   "mbps": 4.541481085955154
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 15.725300000000061,
   "min": 11.763549999999668,
   "samples": 49,
   "batch": 2,
   "mbps": 1.6787597056971821
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "wasm",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 15.693250000000262,
   "min": 9.728149999999005,
   "samples": 49,
   "batch": 2,
   "mbps": 1.6821882019339243
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 15.79989999999998,
   "min": 7.758250000000771,
   "samples": 49,
   "batch": 2,
   "mbps": 0.646080038481257
  },
  "ts->cjs module-transformer.ts": {
   "impl": "wasm",
   "name": "ts->cjs module-transformer.ts",
   "ms": 15.643499999999221,
   "min": 14.165899999999965,
   "samples": 48,
   "batch": 2,
   "mbps": 0.6525393933582964
  },
  "tsx->js small component x20": {
   "impl": "wasm",
   "name": "tsx->js small component x20",
   "ms": 15.590775000000576,
   "min": 14.490100000000893,
   "samples": 48,
   "batch": 2,
   "mbps": 0.2865155837346017
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 31.31015000000116,
   "min": 26.48790000000008,
   "samples": 48,
   "batch": 1,
   "mbps": 4.624251241210746
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 31.342100000001665,
   "min": 26.889799999997194,
   "samples": 48,
   "batch": 1,
   "mbps": 4.531859703082833
  },
  "vite tsx+sourcemap component x20": {
   "impl": "wasm",
   "name": "vite tsx+sourcemap component x20",
   "ms": 15.670050000000629,
   "min": 8.654900000001362,
   "samples": 49,
   "batch": 2,
   "mbps": 0.2850660974278844
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 1161.6388000000006,
   "min": 1113.6944999999978,
   "samples": 10,
   "batch": 1
  }
 },
 "prev": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.14329672131147475,
   "min": 0.12793934426229528,
   "samples": 163,
   "batch": 61,
   "mbps": 11.228449508643129
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 3.0877000000000083,
   "min": 2.534257142857119,
   "samples": 70,
   "batch": 7,
   "mbps": 16.63892217508173
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 64.02229999999963,
   "min": 55.71219999999994,
   "samples": 24,
   "batch": 1,
   "mbps": 14.80816840382188
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 33.47970000000032,
   "min": 26.58730000000014,
   "samples": 44,
   "batch": 1,
   "mbps": 19.796234733285953
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 27.8091000000004,
   "min": 21.896199999999226,
   "samples": 53,
   "batch": 1,
   "mbps": 19.27484168851176
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 34.3192999999992,
   "min": 26.512299999998504,
   "samples": 43,
   "batch": 1,
   "mbps": 14.954092886510267
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "prev",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 14.482200000000375,
   "min": 12.139099999998507,
   "samples": 95,
   "batch": 1,
   "mbps": 15.199900567592927
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "prev",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 7.855450000000019,
   "min": 6.115850000000137,
   "samples": 92,
   "batch": 2,
   "mbps": 18.431280194005392
  },
  "ts->cjs script-engine.ts": {
   "impl": "prev",
   "name": "ts->cjs script-engine.ts",
   "ms": 7.8240749999999935,
   "min": 6.144399999999223,
   "samples": 94,
   "batch": 2,
   "mbps": 18.505190709444904
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "prev",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 7.639199999999619,
   "min": 6.134350000000268,
   "samples": 90,
   "batch": 2,
   "mbps": 18.593308199812427
  },
  "ts->cjs memory-volume.ts": {
   "impl": "prev",
   "name": "ts->cjs memory-volume.ts",
   "ms": 7.425350000001345,
   "min": 6.1163999999989755,
   "samples": 91,
   "batch": 2,
   "mbps": 19.12879527564011
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "prev",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 1.3449000000000524,
   "min": 1.1433624999999665,
   "samples": 127,
   "batch": 8,
   "mbps": 19.628968696556598
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "prev",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 1.483511111111107,
   "min": 1.225644444444495,
   "samples": 108,
   "batch": 9,
   "mbps": 17.794945924084054
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "prev",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.5635826086956671,
   "min": 0.4760434782608923,
   "samples": 109,
   "batch": 23,
   "mbps": 18.112695179904478
  },
  "ts->cjs module-transformer.ts": {
   "impl": "prev",
   "name": "ts->cjs module-transformer.ts",
   "ms": 0.6037340909091322,
   "min": 0.5072000000000116,
   "samples": 106,
   "batch": 22,
   "mbps": 16.90810599187516
  },
  "tsx->js small component x20": {
   "impl": "prev",
   "name": "tsx->js small component x20",
   "ms": 0.5385360000000219,
   "min": 0.3679680000001099,
   "samples": 117,
   "batch": 25,
   "mbps": 8.294710102945427
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 9.663899999999558,
   "min": 7.844900000000052,
   "samples": 76,
   "batch": 2,
   "mbps": 14.98215006363959
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 9.735450000000128,
   "min": 7.826499999999214,
   "samples": 73,
   "batch": 2,
   "mbps": 14.589772429625556
  },
  "vite tsx+sourcemap component x20": {
   "impl": "prev",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.5567900000001827,
   "min": 0.4469199999999546,
   "samples": 123,
   "batch": 20,
   "mbps": 8.022773397508098
  },
  "build bundle zod (plugin fs)": {
   "impl": "prev",
   "name": "build bundle zod (plugin fs)",
   "ms": 132.40409999999974,
   "min": 118.76220000000467,
   "samples": 23,
   "batch": 1
  }
 },
 "fast": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.09818092783505214,
   "min": 0.08552371134020721,
   "samples": 150,
   "batch": 97,
   "mbps": 16.388111576040348
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 2.7950928571428575,
   "min": 2.2044857142857057,
   "samples": 78,
   "batch": 7,
   "mbps": 18.380784691538484
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 53.817099999999755,
   "min": 40.100000000000364,
   "samples": 28,
   "batch": 1,
   "mbps": 17.616203771663734
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 25.73154999999997,
   "min": 20.121100000000297,
   "samples": 56,
   "batch": 1,
   "mbps": 25.75717358651153
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 22.210000000000946,
   "min": 18.600800000000163,
   "samples": 65,
   "batch": 1,
   "mbps": 24.13399369653207
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 29.598799999999756,
   "min": 20.959000000000742,
   "samples": 52,
   "batch": 1,
   "mbps": 17.339013743800567
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 11.52285000000029,
   "min": 9.843400000001566,
   "samples": 116,
   "batch": 1,
   "mbps": 19.103607180514757
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 5.989024999999856,
   "min": 5.214699999999539,
   "samples": 110,
   "batch": 2,
   "mbps": 24.175220507512236
  },
  "ts->cjs script-engine.ts": {
   "impl": "fast",
   "name": "ts->cjs script-engine.ts",
   "ms": 6.067950000000565,
   "min": 5.144550000000891,
   "samples": 111,
   "batch": 2,
   "mbps": 23.860776703826915
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 5.888100000000122,
   "min": 5.236249999999927,
   "samples": 104,
   "batch": 2,
   "mbps": 24.122891934579414
  },
  "ts->cjs memory-volume.ts": {
   "impl": "fast",
   "name": "ts->cjs memory-volume.ts",
   "ms": 5.975274999999783,
   "min": 5.235450000000128,
   "samples": 104,
   "batch": 2,
   "mbps": 23.77095614846265
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 1.124265000000014,
   "min": 1.0027799999999842,
   "samples": 118,
   "batch": 10,
   "mbps": 23.481118775377396
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "fast",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 1.1965727272727236,
   "min": 1.01810909090901,
   "samples": 105,
   "batch": 11,
   "mbps": 22.0621775829453
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.46189464285713,
   "min": 0.3941535714285627,
   "samples": 104,
   "batch": 28,
   "mbps": 22.10027797000769
  },
  "ts->cjs module-transformer.ts": {
   "impl": "fast",
   "name": "ts->cjs module-transformer.ts",
   "ms": 0.4655730769231573,
   "min": 0.39467307692309705,
   "samples": 111,
   "batch": 26,
   "mbps": 21.925666465642358
  },
  "tsx->js small component x20": {
   "impl": "fast",
   "name": "tsx->js small component x20",
   "ms": 0.43002407407402643,
   "min": 0.33043703703703986,
   "samples": 116,
   "batch": 27,
   "mbps": 10.38779051991175
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.608650000000125,
   "min": 6.703599999998914,
   "samples": 87,
   "batch": 2,
   "mbps": 19.029131317644733
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7.785949999999502,
   "min": 6.6881499999981315,
   "samples": 85,
   "batch": 2,
   "mbps": 18.242860537250955
  },
  "vite tsx+sourcemap component x20": {
   "impl": "fast",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.4622818181818399,
   "min": 0.4068500000000561,
   "samples": 121,
   "batch": 22,
   "mbps": 9.662936815401407
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 133.9207000000024,
   "min": 121.66939999999886,
   "samples": 23,
   "batch": 1
  }
 },
 "native": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.6215078947368421,
   "min": 0.5831684210526311,
   "samples": 63,
   "batch": 38,
   "mbps": 2.5888649422245558
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 3.8342714285714203,
   "min": 2.996942857142845,
   "samples": 49,
   "batch": 7,
   "mbps": 13.399155734559397
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "native",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 33.15700000000015,
   "min": 31.438900000000103,
   "samples": 45,
   "batch": 1,
   "mbps": 28.59284615616599
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "native",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 19.04995000000008,
   "min": 18.112249999999676,
   "samples": 39,
   "batch": 2,
   "mbps": 34.7912724180377
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 16.024149999999736,
   "min": 15.231999999999971,
   "samples": 47,
   "batch": 2,
   "mbps": 33.45051063551008
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 17.934875000000375,
   "min": 16.741500000000087,
   "samples": 42,
   "batch": 2,
   "mbps": 28.615421072072664
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "native",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 21.168225000000348,
   "min": 19.78690000000006,
   "samples": 36,
   "batch": 2,
   "mbps": 10.398982437119615
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "native",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 5.524610000000029,
   "min": 5.23086000000003,
   "samples": 54,
   "batch": 5,
   "mbps": 26.207460798137646
  },
  "ts->cjs script-engine.ts": {
   "impl": "native",
   "name": "ts->cjs script-engine.ts",
   "ms": 5.728179999999702,
   "min": 5.4080799999999725,
   "samples": 53,
   "batch": 5,
   "mbps": 25.276091184286724
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "native",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 5.488639999999577,
   "min": 5.12786000000051,
   "samples": 55,
   "batch": 5,
   "mbps": 25.878541861009456
  },
  "ts->cjs memory-volume.ts": {
   "impl": "native",
   "name": "ts->cjs memory-volume.ts",
   "ms": 5.613860000000204,
   "min": 5.185199999999895,
   "samples": 54,
   "batch": 5,
   "mbps": 25.30130783453717
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "native",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 1.5708764705882725,
   "min": 1.4366941176470873,
   "samples": 57,
   "batch": 17,
   "mbps": 16.805267947080473
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "native",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 1.682783333333282,
   "min": 1.5395933333333232,
   "samples": 60,
   "batch": 15,
   "mbps": 15.687699941565544
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "native",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.9140000000000198,
   "min": 0.8334607142856579,
   "samples": 59,
   "batch": 28,
   "mbps": 11.168490153172625
  },
  "ts->cjs module-transformer.ts": {
   "impl": "native",
   "name": "ts->cjs module-transformer.ts",
   "ms": 1.0271279999999388,
   "min": 0.9646680000000925,
   "samples": 59,
   "batch": 25,
   "mbps": 9.938391320264474
  },
  "tsx->js small component x20": {
   "impl": "native",
   "name": "tsx->js small component x20",
   "ms": 0.8482758620690408,
   "min": 0.7821034482757537,
   "samples": 61,
   "batch": 29,
   "mbps": 5.265975609755629
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "native",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.021037500000148,
   "min": 6.6707750000005035,
   "samples": 54,
   "batch": 4,
   "mbps": 20.62173859632525
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "native",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7.176349999999729,
   "min": 6.6144500000000335,
   "samples": 53,
   "batch": 4,
   "mbps": 19.792512906979923
  },
  "vite tsx+sourcemap component x20": {
   "impl": "native",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.9647480769231501,
   "min": 0.8868115384614682,
   "samples": 60,
   "batch": 26,
   "mbps": 4.630224311248699
  },
  "build bundle zod (plugin fs)": {
   "impl": "native",
   "name": "build bundle zod (plugin fs)",
   "ms": 12.941399999999703,
   "min": 11.583099999999831,
   "samples": 111,
   "batch": 2
  }
 }
}
```
