| case                                             | wasm      | fast             |
|--------------------------------------------------|-----------|------------------|
| cold start: initialize()                         | 120.00 ms | 144.70 ms  x0.83 |
| cold start: initialize() + first transform       | 416.00 ms | 202.00 ms  x2.06 |
| transform latency: empty input                   | 1.70 ms   | 200.0 us  x8.50  |
| transform latency: tiny TS                       | 1.80 ms   | 300.0 us  x6.00  |
| esm->cjs zod-errors.js (1.6KB esm)               | 3.90 ms   | 800.0 us  x4.88  |
| esm->cjs zod-schemas.js (51KB esm)               | 37.10 ms  | 7.10 ms  x5.23   |
| esm->cjs rollup node-entry (948KB esm)           | 388.20 ms | 108.10 ms  x3.59 |
| esm->cjs three.module (1.2MB esm)                | 183.20 ms | 69.30 ms  x2.64  |
| esm->cjs batch 17 zod/v4/core files (sequential) | 167.30 ms | 34.40 ms  x4.86  |
| esm->cjs batch 17 zod/v4/core files (concurrent) | 163.60 ms | 30.00 ms  x5.45  |
| ts->esm script-engine.ts (141KB)                 | 57.40 ms  | 16.80 ms  x3.42  |
| ts->esm memory-volume.ts (138KB)                 | 59.20 ms  | 17.10 ms  x3.46  |
| ts->esm syntax-transforms.ts (25KB)              | 11.50 ms  | 2.90 ms  x3.97   |
| ts->esm module-transformer.ts (9KB)              | 5.20 ms   | 1.20 ms  x4.33   |
| build bundle zod (plugin fs)                     | 350.90 ms | 358.50 ms  x0.98 |

```json
{
 "wasm": {
  "cold start: initialize()": {
   "impl": "wasm",
   "name": "cold start: initialize()",
   "ms": 120,
   "min": 120,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "wasm",
   "name": "cold start: initialize() + first transform",
   "ms": 416,
   "min": 416,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "wasm",
   "name": "transform latency: empty input",
   "ms": 1.7000000029802322,
   "min": 1.7000000029802322,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "wasm",
   "name": "transform latency: tiny TS",
   "ms": 1.800000000745058,
   "min": 1.800000000745058,
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
   "ms": 37.100000001490116,
   "min": 37.100000001490116,
   "samples": 1,
   "batch": 1,
   "mbps": 1.384797843610148
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 388.19999999925494,
   "min": 388.19999999925494,
   "samples": 1,
   "batch": 1,
   "mbps": 2.442176713039206
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 183.19999999925494,
   "min": 183.19999999925494,
   "samples": 1,
   "batch": 1,
   "mbps": 3.61775109171777
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 167.30000000074506,
   "min": 167.30000000074506,
   "samples": 1,
   "batch": 1,
   "mbps": 1.3157680812852341
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 163.59999999776483,
   "min": 163.59999999776483,
   "samples": 1,
   "batch": 1,
   "mbps": 1.345525672390021
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 57.399999998509884,
   "min": 57.399999998509884,
   "samples": 1,
   "batch": 1,
   "mbps": 2.522404181250151
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 59.20000000298023,
   "min": 59.20000000298023,
   "samples": 1,
   "batch": 1,
   "mbps": 2.399290540419756
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 11.5,
   "min": 11.5,
   "samples": 1,
   "batch": 1,
   "mbps": 2.2955652173913044
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 5.199999999254942,
   "min": 5.199999999254942,
   "samples": 1,
   "batch": 1,
   "mbps": 1.9630769233581935
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 350.8999999985099,
   "min": 350.8999999985099,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "cold start: initialize()": {
   "impl": "fast",
   "name": "cold start: initialize()",
   "ms": 144.69999999925494,
   "min": 144.69999999925494,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "fast",
   "name": "cold start: initialize() + first transform",
   "ms": 202,
   "min": 202,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "fast",
   "name": "transform latency: empty input",
   "ms": 0.19999999925494194,
   "min": 0.19999999925494194,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "fast",
   "name": "transform latency: tiny TS",
   "ms": 0.29999999701976776,
   "min": 0.29999999701976776,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.7999999970197678,
   "min": 0.7999999970197678,
   "samples": 1,
   "batch": 1,
   "mbps": 2.01125000749249
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 7.099999997764826,
   "min": 7.099999997764826,
   "samples": 1,
   "batch": 1,
   "mbps": 7.236056340306176
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 108.10000000149012,
   "min": 108.10000000149012,
   "samples": 1,
   "batch": 1,
   "mbps": 8.77014801097994
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 69.30000000074506,
   "min": 69.30000000074506,
   "samples": 1,
   "batch": 1,
   "mbps": 9.563809523706702
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 34.400000002235174,
   "min": 34.400000002235174,
   "samples": 1,
   "batch": 1,
   "mbps": 6.399069767026074
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 30,
   "min": 30,
   "samples": 1,
   "batch": 1,
   "mbps": 7.3376
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 16.800000000745058,
   "min": 16.800000000745058,
   "samples": 1,
   "batch": 1,
   "mbps": 8.618214285332078
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 17.100000001490116,
   "min": 17.100000001490116,
   "samples": 1,
   "batch": 1,
   "mbps": 8.30631578874986
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 2.900000002235174,
   "min": 2.900000002235174,
   "samples": 1,
   "batch": 1,
   "mbps": 9.103103441259648
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.199999999254942,
   "min": 1.199999999254942,
   "samples": 1,
   "batch": 1,
   "mbps": 8.5066666719483
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 358.5,
   "min": 358.5,
   "samples": 1,
   "batch": 1
  }
 }
}
```
