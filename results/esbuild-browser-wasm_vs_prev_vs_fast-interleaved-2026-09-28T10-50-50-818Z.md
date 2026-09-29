| case                                             | wasm      | prev             | fast             |
|--------------------------------------------------|-----------|------------------|------------------|
| cold start: initialize()                         | 37.20 ms  | 49.10 ms  x0.76  | 62.10 ms  x0.60  |
| cold start: initialize() + first transform       | 150.10 ms | 84.30 ms  x1.78  | 63.10 ms  x2.38  |
| transform latency: empty input                   | 700.0 us  | 100.0 us  x7.00  | 100.0 us  x7.00  |
| transform latency: tiny TS                       | 600.0 us  | 100.0 us  x6.00  | 100.0 us  x6.00  |
| esm->cjs zod-errors.js (1.6KB esm)               | 1.50 ms   | 200.0 us  x7.50  | 300.0 us  x5.00  |
| esm->cjs zod-schemas.js (51KB esm)               | 11.50 ms  | 2.10 ms  x5.48   | 2.10 ms  x5.48   |
| esm->cjs rollup node-entry (948KB esm)           | 133.50 ms | 32.40 ms  x4.12  | 37.10 ms  x3.60  |
| esm->cjs three.module (1.2MB esm)                | 67.10 ms  | 21.00 ms  x3.20  | 21.00 ms  x3.20  |
| esm->cjs batch 17 zod/v4/core files (sequential) | 58.90 ms  | 9.90 ms  x5.95   | 10.60 ms  x5.56  |
| esm->cjs batch 17 zod/v4/core files (concurrent) | 57.50 ms  | 9.40 ms  x6.12   | 9.30 ms  x6.18   |
| ts->esm script-engine.ts (157KB)                 | 20.70 ms  | 5.80 ms  x3.57   | 5.90 ms  x3.51   |
| ts->esm memory-volume.ts (143KB)                 | 20.10 ms  | 5.40 ms  x3.72   | 5.60 ms  x3.59   |
| ts->esm syntax-transforms.ts (31KB)              | 4.80 ms   | 1.00 ms  x4.80   | 1.10 ms  x4.36   |
| ts->esm module-transformer.ts (9KB)              | 1.90 ms   | 400.0 us  x4.75  | 400.0 us  x4.75  |
| vite ts+sourcemap script-engine.ts               | 27.30 ms  | 7.30 ms  x3.74   | 7.10 ms  x3.85   |
| vite ts+sourcemap memory-volume.ts               | 26.50 ms  | 6.90 ms  x3.84   | 7.10 ms  x3.73   |
| vite tsx+sourcemap component x20                 | 2.60 ms   | 400.0 us  x6.50  | 500.0 us  x5.20  |
| build bundle zod (plugin fs)                     | 122.90 ms | 143.80 ms  x0.85 | 142.40 ms  x0.86 |

```json
{
 "wasm": {
  "cold start: initialize()": {
   "impl": "wasm",
   "name": "cold start: initialize()",
   "ms": 37.199999928474426,
   "min": 37.199999928474426,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "wasm",
   "name": "cold start: initialize() + first transform",
   "ms": 150.09999990463257,
   "min": 150.09999990463257,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "wasm",
   "name": "transform latency: empty input",
   "ms": 0.6999999284744263,
   "min": 0.6999999284744263,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "wasm",
   "name": "transform latency: tiny TS",
   "ms": 0.6000000238418579,
   "min": 0.6000000238418579,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 1.5,
   "min": 1.5,
   "samples": 1,
   "batch": 1,
   "mbps": 1.0726666666666667
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 11.5,
   "min": 11.5,
   "samples": 1,
   "batch": 1,
   "mbps": 4.467478260869565
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 133.5,
   "min": 133.5,
   "samples": 1,
   "batch": 1,
   "mbps": 7.101520599250936
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 67.10000002384186,
   "min": 67.10000002384186,
   "samples": 1,
   "batch": 1,
   "mbps": 9.877377045670716
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 58.89999997615814,
   "min": 58.89999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 3.7373174887793645
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 57.5,
   "min": 57.5,
   "samples": 1,
   "batch": 1,
   "mbps": 3.8283130434782606
  },
  "ts->esm script-engine.ts (157KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (157KB)",
   "ms": 20.700000047683716,
   "min": 20.700000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 7.772995151176556
  },
  "ts->esm memory-volume.ts (143KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (143KB)",
   "ms": 20.100000023841858,
   "min": 20.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 7.312786060977592
  },
  "ts->esm syntax-transforms.ts (31KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (31KB)",
   "ms": 4.800000071525574,
   "min": 4.800000071525574,
   "samples": 1,
   "batch": 1,
   "mbps": 6.625416567940265
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.899999976158142,
   "min": 1.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 5.372631646365011
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 27.299999952316284,
   "min": 27.299999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 5.8938095341039825
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 26.5,
   "min": 26.5,
   "samples": 1,
   "batch": 1,
   "mbps": 5.546679245283019
  },
  "vite tsx+sourcemap component x20": {
   "impl": "wasm",
   "name": "vite tsx+sourcemap component x20",
   "ms": 2.5999999046325684,
   "min": 2.5999999046325684,
   "samples": 1,
   "batch": 1,
   "mbps": 1.7076923703300906
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 122.89999997615814,
   "min": 122.89999997615814,
   "samples": 1,
   "batch": 1
  }
 },
 "prev": {
  "cold start: initialize()": {
   "impl": "prev",
   "name": "cold start: initialize()",
   "ms": 49.09999990463257,
   "min": 49.09999990463257,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "prev",
   "name": "cold start: initialize() + first transform",
   "ms": 84.29999995231628,
   "min": 84.29999995231628,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "prev",
   "name": "transform latency: empty input",
   "ms": 0.10000002384185791,
   "min": 0.10000002384185791,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "prev",
   "name": "transform latency: tiny TS",
   "ms": 0.10000002384185791,
   "min": 0.10000002384185791,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.20000004768371582,
   "min": 0.20000004768371582,
   "samples": 1,
   "batch": 1,
   "mbps": 8.044998081922989
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 2.0999999046325684,
   "min": 2.0999999046325684,
   "samples": 1,
   "batch": 1,
   "mbps": 24.46476301578172
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 32.40000009536743,
   "min": 32.40000009536743,
   "samples": 1,
   "batch": 1,
   "mbps": 29.260894975600728
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 21,
   "min": 21,
   "samples": 1,
   "batch": 1,
   "mbps": 31.56057142857143
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "prev",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 9.899999976158142,
   "min": 9.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 22.23515156869973
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "prev",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 9.399999976158142,
   "min": 9.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 23.41787239982187
  },
  "ts->esm script-engine.ts (157KB)": {
   "impl": "prev",
   "name": "ts->esm script-engine.ts (157KB)",
   "ms": 5.799999952316284,
   "min": 5.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 27.74155195221039
  },
  "ts->esm memory-volume.ts (143KB)": {
   "impl": "prev",
   "name": "ts->esm memory-volume.ts (143KB)",
   "ms": 5.399999976158142,
   "min": 5.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 27.219814934994623
  },
  "ts->esm syntax-transforms.ts (31KB)": {
   "impl": "prev",
   "name": "ts->esm syntax-transforms.ts (31KB)",
   "ms": 1,
   "min": 1,
   "samples": 1,
   "batch": 1,
   "mbps": 31.801999999999996
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "prev",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.3999999761581421,
   "min": 0.3999999761581421,
   "samples": 1,
   "batch": 1,
   "mbps": 25.520001521110625
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.299999952316284,
   "min": 7.299999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 22.04123302068601
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 6.899999976158142,
   "min": 6.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 21.302463841723235
  },
  "vite tsx+sourcemap component x20": {
   "impl": "prev",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.40000009536743164,
   "min": 0.40000009536743164,
   "samples": 1,
   "batch": 1,
   "mbps": 11.099997353554404
  },
  "build bundle zod (plugin fs)": {
   "impl": "prev",
   "name": "build bundle zod (plugin fs)",
   "ms": 143.79999995231628,
   "min": 143.79999995231628,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "cold start: initialize()": {
   "impl": "fast",
   "name": "cold start: initialize()",
   "ms": 62.10000002384186,
   "min": 62.10000002384186,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "fast",
   "name": "cold start: initialize() + first transform",
   "ms": 63.10000002384186,
   "min": 63.10000002384186,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "fast",
   "name": "transform latency: empty input",
   "ms": 0.10000002384185791,
   "min": 0.10000002384185791,
   "samples": 1,
   "batch": 1
  },
  "transform latency: tiny TS": {
   "impl": "fast",
   "name": "transform latency: tiny TS",
   "ms": 0.10000002384185791,
   "min": 0.10000002384185791,
   "samples": 1,
   "batch": 1
  },
  "esm->cjs zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-errors.js (1.6KB esm)",
   "ms": 0.2999999523162842,
   "min": 0.2999999523162842,
   "samples": 1,
   "batch": 1,
   "mbps": 5.363334185812344
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 2.100000023841858,
   "min": 2.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 24.464761627006965
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 37.10000002384186,
   "min": 37.10000002384186,
   "samples": 1,
   "batch": 1,
   "mbps": 25.553989201906884
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 21,
   "min": 21,
   "samples": 1,
   "batch": 1,
   "mbps": 31.56057142857143
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 10.599999904632568,
   "min": 10.599999904632568,
   "samples": 1,
   "batch": 1,
   "mbps": 20.766792639667514
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 9.299999952316284,
   "min": 9.299999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 23.66967754071593
  },
  "ts->esm script-engine.ts (157KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (157KB)",
   "ms": 5.899999976158142,
   "min": 5.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 27.271356042406744
  },
  "ts->esm memory-volume.ts (143KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (143KB)",
   "ms": 5.600000023841858,
   "min": 5.600000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 26.247678459679747
  },
  "ts->esm syntax-transforms.ts (31KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (31KB)",
   "ms": 1.100000023841858,
   "min": 1.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 28.910908464282027
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.3999999761581421,
   "min": 0.3999999761581421,
   "samples": 1,
   "batch": 1,
   "mbps": 25.520001521110625
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.100000023841858,
   "min": 7.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 22.662112599956778
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7.100000023841858,
   "min": 7.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 20.702394296678374
  },
  "vite tsx+sourcemap component x20": {
   "impl": "fast",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.5,
   "min": 0.5,
   "samples": 1,
   "batch": 1,
   "mbps": 8.88
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 142.39999997615814,
   "min": 142.39999997615814,
   "samples": 1,
   "batch": 1
  }
 }
}
```
