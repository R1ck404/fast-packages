| case                                              | wasm                 | fast                        | native                      |
|---------------------------------------------------|----------------------|-----------------------------|-----------------------------|
| esm->cjs zod-errors.js (1.6KB esm)                | 15.47 ms (0.1 MB/s)  | 737.9 µs (2.2 MB/s)  x20.96 | 1.42 ms (1.1 MB/s)  x10.93  |
| esm->cjs zod-schemas.js (51KB esm)                | 46.22 ms (1.1 MB/s)  | 10.44 ms (4.9 MB/s)  x4.43  | 8.10 ms (6.3 MB/s)  x5.70   |
| esm->cjs rollup node-entry (948KB esm)            | 377.97 ms (2.5 MB/s) | 141.79 ms (6.7 MB/s)  x2.67 | 82.24 ms (11.5 MB/s)  x4.60 |
| esm->cjs three.module (1.2MB esm)                 | 205.66 ms (3.2 MB/s) | 86.80 ms (7.6 MB/s)  x2.37  | 45.22 ms (14.7 MB/s)  x4.55 |
| cjs passthrough react-dom-client.prod (536KB cjs) | 318.16 ms (1.7 MB/s) | 72.20 ms (7.4 MB/s)  x4.41  | 38.55 ms (13.9 MB/s)  x8.25 |
| cjs passthrough babel-parser (513KB cjs)          | 213.36 ms (2.4 MB/s) | 83.82 ms (6.1 MB/s)  x2.55  | 43.45 ms (11.8 MB/s)  x4.91 |
| esm->cjs batch 17 zod/v4/core files               | 327.92 ms (0.7 MB/s) | 53.28 ms (4.1 MB/s)  x6.15  | 43.84 ms (5.0 MB/s)  x7.48  |
| ts->esm script-engine.ts (141KB)                  | 62.26 ms (2.3 MB/s)  | 22.01 ms (6.6 MB/s)  x2.83  | 12.98 ms (11.2 MB/s)  x4.80 |
| ts->cjs script-engine.ts                          | 63.54 ms (2.3 MB/s)  | 23.98 ms (6.0 MB/s)  x2.65  | 13.18 ms (11.0 MB/s)  x4.82 |
| ts->esm memory-volume.ts (138KB)                  | 63.32 ms (2.2 MB/s)  | 42.07 ms (3.4 MB/s)  x1.51  | 13.24 ms (10.7 MB/s)  x4.78 |
| ts->cjs memory-volume.ts                          | 65.05 ms (2.2 MB/s)  | 47.62 ms (3.0 MB/s)  x1.37  | 13.44 ms (10.6 MB/s)  x4.84 |
| ts->esm syntax-transforms.ts (25KB)               | 16.05 ms (1.6 MB/s)  | 10.07 ms (2.6 MB/s)  x1.59  | 3.23 ms (8.2 MB/s)  x4.97   |
| ts->cjs syntax-transforms.ts                      | 23.39 ms (1.1 MB/s)  | 4.25 ms (6.2 MB/s)  x5.51   | 3.54 ms (7.5 MB/s)  x6.61   |
| ts->esm module-transformer.ts (9KB)               | 15.55 ms (0.7 MB/s)  | 1.68 ms (6.1 MB/s)  x9.27   | 1.80 ms (5.7 MB/s)  x8.66   |
| ts->cjs module-transformer.ts                     | 15.53 ms (0.7 MB/s)  | 1.96 ms (5.2 MB/s)  x7.94   | 2.13 ms (4.8 MB/s)  x7.27   |
| tsx->js small component x20                       | 17.42 ms (0.3 MB/s)  | 1.42 ms (3.2 MB/s)  x12.31  | 1.73 ms (2.6 MB/s)  x10.07  |
| build bundle zod (plugin fs)                      | 1.28 s               | 366.65 ms  x3.50            | 32.43 ms  x39.53            |

```json
{
 "wasm": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 15.466850000000022,
   "min": 5.864899999999807,
   "samples": 96,
   "batch": 1,
   "mbps": 0.10402893931214163
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 46.22479999999973,
   "min": 31.296000000000276,
   "samples": 34,
   "batch": 1,
   "mbps": 1.1114380159568087
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 377.96930000000066,
   "min": 369.52669999999944,
   "samples": 10,
   "batch": 1,
   "mbps": 2.50828043441623
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 205.66169999999966,
   "min": 182.45769999999902,
   "samples": 10,
   "batch": 1,
   "mbps": 3.222632118668674
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 318.15700000000015,
   "min": 192.5668000000005,
   "samples": 10,
   "batch": 1,
   "mbps": 1.684753125029466
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "wasm",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 213.35819999999876,
   "min": 190.39909999999873,
   "samples": 10,
   "batch": 1,
   "mbps": 2.405410244368405
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 327.9171499999993,
   "min": 263.997800000001,
   "samples": 10,
   "batch": 1,
   "mbps": 0.6712915137253432
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 62.26144999999997,
   "min": 56.1265999999996,
   "samples": 24,
   "batch": 1,
   "mbps": 2.325451784370587
  },
  "ts->cjs script-engine.ts": {
   "impl": "wasm",
   "name": "ts->cjs script-engine.ts",
   "ms": 63.535100000000966,
   "min": 59.38749999999709,
   "samples": 23,
   "batch": 1,
   "mbps": 2.2788348487685988
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 63.31529999999839,
   "min": 60.75759999999718,
   "samples": 23,
   "batch": 1,
   "mbps": 2.243344025851629
  },
  "ts->cjs memory-volume.ts": {
   "impl": "wasm",
   "name": "ts->cjs memory-volume.ts",
   "ms": 65.04520000000048,
   "min": 59.231400000000576,
   "samples": 23,
   "batch": 1,
   "mbps": 2.1836815014789552
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 16.046150000000125,
   "min": 12.626550000000861,
   "samples": 43,
   "batch": 2,
   "mbps": 1.6451921488955168
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "wasm",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 23.394399999997404,
   "min": 15.145449999999983,
   "samples": 33,
   "batch": 2,
   "mbps": 1.128432445371667
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 15.554700000000594,
   "min": 5.496399999999994,
   "samples": 50,
   "batch": 2,
   "mbps": 0.6562646659851755
  },
  "ts->cjs module-transformer.ts": {
   "impl": "wasm",
   "name": "ts->cjs module-transformer.ts",
   "ms": 15.525950000002922,
   "min": 11.069449999999051,
   "samples": 49,
   "batch": 2,
   "mbps": 0.6574798965601512
  },
  "tsx->js small component x20": {
   "impl": "wasm",
   "name": "tsx->js small component x20",
   "ms": 17.42084999999861,
   "min": 9.088500000001659,
   "samples": 43,
   "batch": 2,
   "mbps": 0.25641687977339545
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 1282.0036499999987,
   "min": 1196.7871000000014,
   "samples": 10,
   "batch": 1
  }
 },
 "fast": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.7379350000000044,
   "min": 0.5870800000000145,
   "samples": 160,
   "batch": 10,
   "mbps": 2.1804088435973226
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 10.439400000000091,
   "min": 8.731800000000021,
   "samples": 64,
   "batch": 2,
   "mbps": 4.921355633465481
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 141.79470000000038,
   "min": 134.16870000000017,
   "samples": 11,
   "batch": 1,
   "mbps": 6.686096165794614
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 86.79759999999987,
   "min": 74.97100000000046,
   "samples": 17,
   "batch": 1,
   "mbps": 7.635833248845601
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 72.20449999999983,
   "min": 60.366799999999785,
   "samples": 21,
   "batch": 1,
   "mbps": 7.4235816327237405
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 83.8152,
   "min": 69.14900000000125,
   "samples": 18,
   "batch": 1,
   "mbps": 6.123161431339422
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 53.282100000000355,
   "min": 40.83419999999933,
   "samples": 28,
   "batch": 1,
   "mbps": 4.131368696053619
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 22.012550000000374,
   "min": 18.493599999999788,
   "samples": 64,
   "batch": 1,
   "mbps": 6.577429693515633
  },
  "ts->cjs script-engine.ts": {
   "impl": "fast",
   "name": "ts->cjs script-engine.ts",
   "ms": 23.98199999999997,
   "min": 20.709200000001147,
   "samples": 55,
   "batch": 1,
   "mbps": 6.0372779584688585
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 42.067299999998795,
   "min": 23.51009999999951,
   "samples": 35,
   "batch": 1,
   "mbps": 3.376446788836081
  },
  "ts->cjs memory-volume.ts": {
   "impl": "fast",
   "name": "ts->cjs memory-volume.ts",
   "ms": 47.615600000000995,
   "min": 29.115499999999884,
   "samples": 29,
   "batch": 1,
   "mbps": 2.983013970211381
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 10.072949999999764,
   "min": 6.230550000000221,
   "samples": 67,
   "batch": 2,
   "mbps": 2.620781399689328
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "fast",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 4.245449999998527,
   "min": 3.878600000000006,
   "samples": 139,
   "batch": 2,
   "mbps": 6.218186529109789
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.6775000000003881,
   "min": 1.4987999999999981,
   "samples": 89,
   "batch": 9,
   "mbps": 6.085245901637936
  },
  "ts->cjs module-transformer.ts": {
   "impl": "fast",
   "name": "ts->cjs module-transformer.ts",
   "ms": 1.9555500000001302,
   "min": 1.7722125000000233,
   "samples": 85,
   "batch": 8,
   "mbps": 5.220014829587236
  },
  "tsx->js small component x20": {
   "impl": "fast",
   "name": "tsx->js small component x20",
   "ms": 1.4154000000000906,
   "min": 1.2328749999996944,
   "samples": 110,
   "batch": 8,
   "mbps": 3.1559983043660544
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 366.6477500000001,
   "min": 325.5913999999975,
   "samples": 10,
   "batch": 1
  }
 },
 "native": {
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 1.415203124999998,
   "min": 1.3241749999999968,
   "samples": 66,
   "batch": 16,
   "mbps": 1.136939264460713
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "native",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 8.103387499999997,
   "min": 7.401899999999955,
   "samples": 44,
   "batch": 4,
   "mbps": 6.340064571760887
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "native",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 82.23509999999987,
   "min": 79.53700000000026,
   "samples": 19,
   "batch": 1,
   "mbps": 11.528568701199383
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "native",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 45.21780000000035,
   "min": 43.46469999999954,
   "samples": 33,
   "batch": 1,
   "mbps": 14.657325212637389
  },
  "cjs passthrough react-dom-client.prod (536KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough react-dom-client.prod (536KB cjs)",
   "ms": 38.545500000000175,
   "min": 36.537099999999555,
   "samples": 39,
   "batch": 1,
   "mbps": 13.906059073043483
  },
  "cjs passthrough babel-parser (513KB cjs)": {
   "impl": "native",
   "name": "cjs passthrough babel-parser (513KB cjs)",
   "ms": 43.44599999999991,
   "min": 41.934299999998984,
   "samples": 35,
   "batch": 1,
   "mbps": 11.812687013764235
  },
  "esm->cjs batch 17 zod/v4/core files": {
   "impl": "native",
   "name": "esm->cjs batch 17 zod/v4/core files",
   "ms": 43.844599999998536,
   "min": 41.77760000000126,
   "samples": 33,
   "batch": 1,
   "mbps": 5.02064108236835
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "native",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 12.977675000000545,
   "min": 11.805000000000291,
   "samples": 58,
   "batch": 2,
   "mbps": 11.156543833929723
  },
  "ts->cjs script-engine.ts": {
   "impl": "native",
   "name": "ts->cjs script-engine.ts",
   "ms": 13.180999999999585,
   "min": 12.063850000000457,
   "samples": 57,
   "batch": 2,
   "mbps": 10.984447310523068
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "native",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 13.235100000001694,
   "min": 12.331449999999677,
   "samples": 57,
   "batch": 2,
   "mbps": 10.731917401453847
  },
  "ts->cjs memory-volume.ts": {
   "impl": "native",
   "name": "ts->cjs memory-volume.ts",
   "ms": 13.435574999999517,
   "min": 12.499900000000707,
   "samples": 56,
   "batch": 2,
   "mbps": 10.571784236998052
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "native",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 3.227114285714249,
   "min": 3.017042857142639,
   "samples": 66,
   "batch": 7,
   "mbps": 8.180373442881393
  },
  "ts->cjs syntax-transforms.ts": {
   "impl": "native",
   "name": "ts->cjs syntax-transforms.ts",
   "ms": 3.5417285714283935,
   "min": 3.3114999999997963,
   "samples": 61,
   "batch": 7,
   "mbps": 7.453705010870773
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "native",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.7958607142856116,
   "min": 1.7140428571430155,
   "samples": 60,
   "batch": 14,
   "mbps": 5.6841824751763745
  },
  "ts->cjs module-transformer.ts": {
   "impl": "native",
   "name": "ts->cjs module-transformer.ts",
   "ms": 2.1344416666667407,
   "min": 1.9923249999998613,
   "samples": 57,
   "batch": 12,
   "mbps": 4.782515333830305
  },
  "tsx->js small component x20": {
   "impl": "native",
   "name": "tsx->js small component x20",
   "ms": 1.730384615384537,
   "min": 1.561815384615329,
   "samples": 66,
   "batch": 13,
   "mbps": 2.5815070015560178
  },
  "build bundle zod (plugin fs)": {
   "impl": "native",
   "name": "build bundle zod (plugin fs)",
   "ms": 32.433099999998376,
   "min": 25.589499999998225,
   "samples": 91,
   "batch": 1
  }
 }
}
```
