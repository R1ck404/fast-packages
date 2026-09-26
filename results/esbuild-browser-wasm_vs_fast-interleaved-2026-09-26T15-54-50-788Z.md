| case                                             | wasm      | fast             |
|--------------------------------------------------|-----------|------------------|
| cold start: initialize()                         | 129.80 ms | 137.80 ms  x0.94 |
| cold start: initialize() + first transform       | 458.20 ms | 220.90 ms  x2.07 |
| transform latency: empty input                   | 1.60 ms   | 200.0 us  x8.00  |
| transform latency: tiny TS                       | 1.70 ms   | 300.0 us  x5.67  |
| esm->cjs zod-errors.js (1.6KB esm)               | 3.90 ms   | 800.0 us  x4.87  |
| esm->cjs zod-schemas.js (51KB esm)               | 33.90 ms  | 7.00 ms  x4.84   |
| esm->cjs rollup node-entry (948KB esm)           | 373.10 ms | 105.30 ms  x3.54 |
| esm->cjs three.module (1.2MB esm)                | 188.20 ms | 68.10 ms  x2.76  |
| esm->cjs batch 17 zod/v4/core files (sequential) | 169.10 ms | 33.10 ms  x5.11  |
| esm->cjs batch 17 zod/v4/core files (concurrent) | 164.10 ms | 29.60 ms  x5.54  |
| ts->esm script-engine.ts (141KB)                 | 60.80 ms  | 16.60 ms  x3.66  |
| ts->esm memory-volume.ts (138KB)                 | 61.00 ms  | 16.50 ms  x3.70  |
| ts->esm syntax-transforms.ts (25KB)              | 12.80 ms  | 3.00 ms  x4.27   |
| ts->esm module-transformer.ts (9KB)              | 5.10 ms   | 1.20 ms  x4.25   |
| vite ts+sourcemap script-engine.ts               | 73.10 ms  | 21.00 ms  x3.48  |
| vite ts+sourcemap memory-volume.ts               | 75.20 ms  | 21.40 ms  x3.51  |
| vite tsx+sourcemap component x20                 | 7.20 ms   | 1.20 ms  x6.00   |
| build bundle zod (plugin fs)                     | 356.50 ms | 366.50 ms  x0.97 |

```json
{
 "wasm": {
  "cold start: initialize()": {
   "impl": "wasm",
   "name": "cold start: initialize()",
   "ms": 129.80000000074506,
   "min": 129.80000000074506,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "wasm",
   "name": "cold start: initialize() + first transform",
   "ms": 458.20000000298023,
   "min": 458.20000000298023,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "wasm",
   "name": "transform latency: empty input",
   "ms": 1.6000000014901161,
   "min": 1.6000000014901161,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "wasm",
   "name": "transform latency: tiny TS",
   "ms": 1.699999999254942,
   "min": 1.699999999254942,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 3.900000002235174,
   "min": 3.900000002235174,
   "samples": 1,
   "batch": 1,
   "mbps": 0.41256410232765317
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 33.899999998509884,
   "min": 33.899999998509884,
   "samples": 1,
   "batch": 1,
   "mbps": 1.5155162242554068
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 373.0999999977648,
   "min": 373.0999999977648,
   "samples": 1,
   "batch": 1,
   "mbps": 2.5410158134700604
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 188.19999999925494,
   "min": 188.19999999925494,
   "samples": 1,
   "batch": 1,
   "mbps": 3.5216365568683523
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 169.10000000149012,
   "min": 169.10000000149012,
   "samples": 1,
   "batch": 1,
   "mbps": 1.3017622708341823
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 164.09999999776483,
   "min": 164.09999999776483,
   "samples": 1,
   "batch": 1,
   "mbps": 1.3414259597988927
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 60.80000000074506,
   "min": 60.80000000074506,
   "samples": 1,
   "batch": 1,
   "mbps": 2.3813486841813445
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 61,
   "min": 61,
   "samples": 1,
   "batch": 1,
   "mbps": 2.3284918032786885
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 12.800000000745058,
   "min": 12.800000000745058,
   "samples": 1,
   "batch": 1,
   "mbps": 2.062421874879951
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 5.100000001490116,
   "min": 5.100000001490116,
   "samples": 1,
   "batch": 1,
   "mbps": 2.0015686268661628
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 73.09999999776483,
   "min": 73.09999999776483,
   "samples": 1,
   "batch": 1,
   "mbps": 1.9806566348074843
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 75.20000000298023,
   "min": 75.20000000298023,
   "samples": 1,
   "batch": 1,
   "mbps": 1.8888031914145071
  },
  "vite tsx+sourcemap component x20": {
   "impl": "wasm",
   "name": "vite tsx+sourcemap component x20",
   "ms": 7.199999999254942,
   "min": 7.199999999254942,
   "samples": 1,
   "batch": 1,
   "mbps": 0.6166666667304795
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 356.5,
   "min": 356.5,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "cold start: initialize()": {
   "impl": "fast",
   "name": "cold start: initialize()",
   "ms": 137.80000000074506,
   "min": 137.80000000074506,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "fast",
   "name": "cold start: initialize() + first transform",
   "ms": 220.89999999850988,
   "min": 220.89999999850988,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "fast",
   "name": "transform latency: empty input",
   "ms": 0.20000000298023224,
   "min": 0.20000000298023224,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "fast",
   "name": "transform latency: tiny TS",
   "ms": 0.30000000074505806,
   "min": 0.30000000074505806,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.8000000007450581,
   "min": 0.8000000007450581,
   "samples": 1,
   "batch": 1,
   "mbps": 2.0112499981268774
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 7,
   "min": 7,
   "samples": 1,
   "batch": 1,
   "mbps": 7.339428571428571
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 105.30000000074506,
   "min": 105.30000000074506,
   "samples": 1,
   "batch": 1,
   "mbps": 9.003352326621956
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 68.10000000149012,
   "min": 68.10000000149012,
   "samples": 1,
   "batch": 1,
   "mbps": 9.732334801549158
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 33.099999997764826,
   "min": 33.099999997764826,
   "samples": 1,
   "batch": 1,
   "mbps": 6.6503927496938
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 29.600000001490116,
   "min": 29.600000001490116,
   "samples": 1,
   "batch": 1,
   "mbps": 7.436756756382377
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 16.600000001490116,
   "min": 16.600000001490116,
   "samples": 1,
   "batch": 1,
   "mbps": 8.72204819198814
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 16.5,
   "min": 16.5,
   "samples": 1,
   "batch": 1,
   "mbps": 8.608363636363636
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 3,
   "min": 3,
   "samples": 1,
   "batch": 1,
   "mbps": 8.799666666666667
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.2000000029802322,
   "min": 1.2000000029802322,
   "samples": 1,
   "batch": 1,
   "mbps": 8.50666664554013
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 21,
   "min": 21,
   "samples": 1,
   "batch": 1,
   "mbps": 6.894571428571428
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 21.400000002235174,
   "min": 21.400000002235174,
   "samples": 1,
   "batch": 1,
   "mbps": 6.637289718932921
  },
  "vite tsx+sourcemap component x20": {
   "impl": "fast",
   "name": "vite tsx+sourcemap component x20",
   "ms": 1.2000000029802322,
   "min": 1.2000000029802322,
   "samples": 1,
   "batch": 1,
   "mbps": 3.6999999908109507
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 366.5,
   "min": 366.5,
   "samples": 1,
   "batch": 1
  }
 }
}
```
