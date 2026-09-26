| case                                              | wasm      | fast             | native           |
|---------------------------------------------------|-----------|------------------|------------------|
| esm->cjs zod-errors.js (1.6KB esm)                | 12.11 ms  | 493.3 us  x24.55 | 1.49 ms  x8.11   |
| esm->cjs zod-schemas.js (51KB esm)                | 44.68 ms  | 10.18 ms  x4.39  | 8.50 ms  x5.26   |
| esm->cjs rollup node-entry (948KB esm)            | 379.49 ms | 145.46 ms  x2.61 | 81.62 ms  x4.65  |
| esm->cjs three.module (1.2MB esm)                 | 186.33 ms | 89.72 ms  x2.08  | 45.26 ms  x4.12  |
| cjs passthrough react-dom-client.prod (536KB cjs) | 174.74 ms | 75.18 ms  x2.32  | 38.35 ms  x4.56  |
| cjs passthrough babel-parser (513KB cjs)          | 208.32 ms | 86.86 ms  x2.40  | 44.64 ms  x4.67  |
| esm->cjs batch 17 zod/v4/core files               | 336.51 ms | 52.79 ms  x6.37  | 46.10 ms  x7.30  |
| ts->esm script-engine.ts (141KB)                  | 62.49 ms  | 21.42 ms  x2.92  | 16.20 ms  x3.86  |
| ts->cjs script-engine.ts                          | 61.90 ms  | 22.88 ms  x2.71  | 17.47 ms  x3.54  |
| ts->esm memory-volume.ts (138KB)                  | 63.63 ms  | 21.75 ms  x2.93  | 13.63 ms  x4.67  |
| ts->cjs memory-volume.ts                          | 62.75 ms  | 23.18 ms  x2.71  | 13.67 ms  x4.59  |
| ts->esm syntax-transforms.ts (25KB)               | 15.78 ms  | 4.02 ms  x3.92   | 3.50 ms  x4.51   |
| ts->cjs syntax-transforms.ts                      | 23.47 ms  | 4.15 ms  x5.66   | 3.84 ms  x6.11   |
| ts->esm module-transformer.ts (9KB)               | 15.48 ms  | 1.69 ms  x9.16   | 1.82 ms  x8.48   |
| ts->cjs module-transformer.ts                     | 15.64 ms  | 1.85 ms  x8.43   | 2.13 ms  x7.35   |
| tsx->js small component x20                       | 15.56 ms  | 1.54 ms  x10.12  | 1.74 ms  x8.94   |
| vite ts+sourcemap script-engine.ts                | 78.10 ms  | 25.58 ms  x3.05  | 17.37 ms  x4.50  |
| vite ts+sourcemap memory-volume.ts                | 77.81 ms  | 27.52 ms  x2.83  | 17.73 ms  x4.39  |
| vite tsx+sourcemap component x20                  | 15.81 ms  | 1.90 ms  x8.31   | 1.98 ms  x7.97   |
| build bundle zod (plugin fs)                      | 1.29 s    | 352.25 ms  x3.65 | 38.52 ms  x33.41 |

```json
{
 "wasm": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 12.108799999999974,
   "min": 3.4632000000001426,
   "samples": 93,
   "batch": 1,
   "mbps": 0.13287856765327724
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 44.67780000000016,
   "min": 32.967099999999846,
   "samples": 28,
   "batch": 1,
   "mbps": 1.149922332791673
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 379.4885999999997,
   "min": 367.3833999999997,
   "samples": 10,
   "batch": 1,
   "mbps": 2.4982384187561917
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 186.33300000000054,
   "min": 183.66580000000067,
   "samples": 10,
   "batch": 1,
   "mbps": 3.5569222842974577
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 174.7448000000004,
   "min": 161.90949999999975,
   "samples": 10,
   "batch": 1,
   "mbps": 3.067421748744448
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 208.32034999999996,
   "min": 186.15219999999863,
   "samples": 10,
   "batch": 1,
   "mbps": 2.463580730351116
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 336.5070999999989,
   "min": 298.9386000000013,
   "samples": 10,
   "batch": 1,
   "mbps": 0.6541555883962054
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 62.48819999999978,
   "min": 56.795500000000175,
   "samples": 20,
   "batch": 1,
   "mbps": 2.317013452139772
  },
  "ts->cjs script-engine.ts": {
   "impl": "wasm",
   "name": "ts->cjs script-engine.ts",
   "ms": 61.897899999999936,
   "min": 56.89559999999983,
   "samples": 19,
   "batch": 1,
   "mbps": 2.339110050583302
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 63.634500000000116,
   "min": 60.308499999999185,
   "samples": 19,
   "batch": 1,
   "mbps": 2.2320910826674165
  },
  "ts->cjs memory-volume.ts": {
   "impl": "wasm",
   "name": "ts->cjs memory-volume.ts",
   "ms": 62.74975000000086,
   "min": 58.745599999998376,
   "samples": 20,
   "batch": 1,
   "mbps": 2.263562803039025
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 15.776849999999286,
   "min": 13.95429999999942,
   "samples": 34,
   "batch": 2,
   "mbps": 1.6732744495891891
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "wasm",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 23.468325000000732,
   "min": 13.577649999999267,
   "samples": 28,
   "batch": 2,
   "mbps": 1.1248778939272053
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 15.475749999999607,
   "min": 8.007649999999558,
   "samples": 40,
   "batch": 2,
   "mbps": 0.6596126197438095
  },
  "ts->cjs module-transformer.ts": {
   "impl": "wasm",
   "name": "ts->cjs module-transformer.ts",
   "ms": 15.641049999998359,
   "min": 12.719499999999243,
   "samples": 39,
   "batch": 2,
   "mbps": 0.6526416065418288
  },
  "tsx->js small component x20": {
   "impl": "wasm",
   "name": "tsx->js small component x20",
   "ms": 15.558499999999185,
   "min": 13.004649999998946,
   "samples": 39,
   "batch": 2,
   "mbps": 0.28710993990424744
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 78.10464999999749,
   "min": 72.44109999999637,
   "samples": 16,
   "batch": 1,
   "mbps": 1.8537436631494368
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 77.80529999999999,
   "min": 73.89630000000034,
   "samples": 16,
   "batch": 1,
   "mbps": 1.8255568708044312
  },
  "vite tsx+sourcemap component x20": {
   "impl": "wasm",
   "name": "vite tsx+sourcemap component x20",
   "ms": 15.80934999999954,
   "min": 9.599549999998999,
   "samples": 39,
   "batch": 2,
   "mbps": 0.28255431121457425
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 1286.9341999999997,
   "min": 1231.015800000001,
   "samples": 10,
   "batch": 1
  }
 },
 "fast": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.49326250000000493,
   "min": 0.4391250000000089,
   "samples": 164,
   "batch": 12,
   "mbps": 3.261954841489033
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 10.179550000000063,
   "min": 8.464749999999867,
   "samples": 53,
   "batch": 2,
   "mbps": 5.046981448099344
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 145.4607000000001,
   "min": 136.0677999999998,
   "samples": 10,
   "batch": 1,
   "mbps": 6.517588599532379
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 89.72344999999996,
   "min": 75.13869999999952,
   "samples": 14,
   "batch": 1,
   "mbps": 7.386831424783603
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 75.18299999999999,
   "min": 62.264100000000326,
   "samples": 16,
   "batch": 1,
   "mbps": 7.129484058896295
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 86.86414999999943,
   "min": 71.28989999999976,
   "samples": 14,
   "batch": 1,
   "mbps": 5.908237172642607
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 52.786699999998746,
   "min": 38.677999999999884,
   "samples": 23,
   "batch": 1,
   "mbps": 4.17014134242158
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 21.422300000000178,
   "min": 18.99539999999979,
   "samples": 50,
   "batch": 1,
   "mbps": 6.75865803391787
  },
  "ts->cjs script-engine.ts": {
   "impl": "fast",
   "name": "ts->cjs script-engine.ts",
   "ms": 22.882050000000163,
   "min": 19.971199999999953,
   "samples": 48,
   "batch": 1,
   "mbps": 6.327492510504913
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 21.752800000000207,
   "min": 19.117300000001705,
   "samples": 50,
   "batch": 1,
   "mbps": 6.529642161009095
  },
  "ts->cjs memory-volume.ts": {
   "impl": "fast",
   "name": "ts->cjs memory-volume.ts",
   "ms": 23.18279999999868,
   "min": 19.50720000000001,
   "samples": 47,
   "batch": 1,
   "mbps": 6.126869920803704
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 4.02450000000014,
   "min": 3.55059999999988,
   "samples": 86,
   "batch": 3,
   "mbps": 6.559572617716258
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "fast",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 4.145237499999894,
   "min": 3.726274999999987,
   "samples": 64,
   "batch": 4,
   "mbps": 6.368513263715451
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.690112499999941,
   "min": 1.6006624999999985,
   "samples": 77,
   "batch": 8,
   "mbps": 6.039834626393424
  },
  "ts->cjs module-transformer.ts": {
   "impl": "fast",
   "name": "ts->cjs module-transformer.ts",
   "ms": 1.854562499999929,
   "min": 1.6453250000004118,
   "samples": 72,
   "batch": 8,
   "mbps": 5.504263134836594
  },
  "tsx->js small component x20": {
   "impl": "fast",
   "name": "tsx->js small component x20",
   "ms": 1.5376499999997577,
   "min": 1.25525000000016,
   "samples": 85,
   "batch": 8,
   "mbps": 2.9050824309828007
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 25.58125000000109,
   "min": 23.919699999998556,
   "samples": 44,
   "batch": 1,
   "mbps": 5.65984852186636
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 27.515049999999974,
   "min": 23.94409999999698,
   "samples": 40,
   "batch": 1,
   "mbps": 5.162193054346626
  },
  "vite tsx+sourcemap component x20": {
   "impl": "fast",
   "name": "vite tsx+sourcemap component x20",
   "ms": 1.9015285714283112,
   "min": 1.4807000000000698,
   "samples": 80,
   "batch": 7,
   "mbps": 2.349162703689834
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 352.25294999999824,
   "min": 344.51550000000134,
   "samples": 10,
   "batch": 1
  }
 },
 "native": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 1.4929281250000024,
   "min": 1.3505625000000094,
   "samples": 50,
   "batch": 16,
   "mbps": 1.0777477984748913
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 8.501666666666702,
   "min": 7.63749999999997,
   "samples": 47,
   "batch": 3,
   "mbps": 6.043050382277959
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "native",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 81.62390000000005,
   "min": 78.70829999999978,
   "samples": 15,
   "batch": 1,
   "mbps": 11.614894657079597
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "native",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 45.257800000000316,
   "min": 43.7509,
   "samples": 27,
   "batch": 1,
   "mbps": 14.644370694112295
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 38.34574999999995,
   "min": 36.953700000000026,
   "samples": 32,
   "batch": 1,
   "mbps": 13.978498269038962
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 44.64099999999962,
   "min": 42.48450000000048,
   "samples": 27,
   "batch": 1,
   "mbps": 11.496471853229192
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "native",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 46.103399999999965,
   "min": 43.490999999999985,
   "samples": 25,
   "batch": 1,
   "mbps": 4.774658701961247
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "native",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 16.198350000000573,
   "min": 12.730499999999665,
   "samples": 35,
   "batch": 2,
   "mbps": 8.93831779162661
  },
  "ts->cjs script-engine.ts": {
   "impl": "native",
   "name": "ts->cjs script-engine.ts",
   "ms": 17.465999999999894,
   "min": 14.141250000000582,
   "samples": 32,
   "batch": 2,
   "mbps": 8.289591205771263
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "native",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 13.634300000000621,
   "min": 12.785649999999805,
   "samples": 36,
   "batch": 2,
   "mbps": 10.417696544743297
  },
  "ts->cjs memory-volume.ts": {
   "impl": "native",
   "name": "ts->cjs memory-volume.ts",
   "ms": 13.667849999999362,
   "min": 12.429850000000442,
   "samples": 44,
   "batch": 2,
   "mbps": 10.392124584335257
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "native",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 3.500524999999925,
   "min": 3.2733124999999745,
   "samples": 43,
   "batch": 8,
   "mbps": 7.541440212539709
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "native",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 3.8435571428573376,
   "min": 3.5414857142859546,
   "samples": 45,
   "batch": 7,
   "mbps": 6.868377135763025
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "native",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.824585714285474,
   "min": 1.6852571428571537,
   "samples": 47,
   "batch": 14,
   "mbps": 5.594694686074288
  },
  "ts->cjs module-transformer.ts": {
   "impl": "native",
   "name": "ts->cjs module-transformer.ts",
   "ms": 2.1280333333334056,
   "min": 2.0309749999999744,
   "samples": 47,
   "batch": 12,
   "mbps": 4.796917341520176
  },
  "tsx->js small component x20": {
   "impl": "native",
   "name": "tsx->js small component x20",
   "ms": 1.7405642857143644,
   "min": 1.6145428571427536,
   "samples": 49,
   "batch": 14,
   "mbps": 2.5664090873648187
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "native",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 17.368924999999763,
   "min": 15.809250000000247,
   "samples": 32,
   "batch": 2,
   "mbps": 8.335921768330623
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "native",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 17.734325000000354,
   "min": 16.894249999999374,
   "samples": 34,
   "batch": 2,
   "mbps": 8.009213770470383
  },
  "vite tsx+sourcemap component x20": {
   "impl": "native",
   "name": "vite tsx+sourcemap component x20",
   "ms": 1.9844115384614551,
   "min": 1.830438461538646,
   "samples": 46,
   "batch": 13,
   "mbps": 2.2510451654918984
  },
  "build bundle zod (plugin fs)": {
   "impl": "native",
   "name": "build bundle zod (plugin fs)",
   "ms": 38.52404999999999,
   "min": 30.095400000001973,
   "samples": 78,
   "batch": 1
  }
 }
}
```
