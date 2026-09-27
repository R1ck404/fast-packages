| case                                             | wasm      | prev             | fast             |
|--------------------------------------------------|-----------|------------------|------------------|
| cold start: initialize()                         | 38.70 ms  | 45.30 ms  x0.85  | 45.40 ms  x0.85  |
| cold start: initialize() + first transform       | 152.80 ms | 77.30 ms  x1.98  | 77.60 ms  x1.97  |
| transform latency: empty input                   | 600.0 us  | 100.0 us  x6.00  | 100.0 us  x6.00  |
| transform latency: tiny TS                       | 600.0 us  | 100.0 us  x6.00  | 100.0 us  x6.00  |
| esm->cjs zod-errors.js (1.6KB esm)               | 1.50 ms   | 300.0 us  x5.00  | 200.0 us  x7.50  |
| esm->cjs zod-schemas.js (51KB esm)               | 11.50 ms  | 2.50 ms  x4.60   | 2.10 ms  x5.48   |
| esm->cjs rollup node-entry (948KB esm)           | 129.90 ms | 39.50 ms  x3.29  | 34.40 ms  x3.78  |
| esm->cjs three.module (1.2MB esm)                | 66.00 ms  | 26.10 ms  x2.53  | 21.40 ms  x3.08  |
| esm->cjs batch 17 zod/v4/core files (sequential) | 58.40 ms  | 12.80 ms  x4.56  | 9.90 ms  x5.90   |
| esm->cjs batch 17 zod/v4/core files (concurrent) | 56.90 ms  | 11.00 ms  x5.17  | 9.20 ms  x6.18   |
| ts->esm script-engine.ts (141KB)                 | 19.10 ms  | 5.90 ms  x3.24   | 5.00 ms  x3.82   |
| ts->esm memory-volume.ts (138KB)                 | 19.80 ms  | 5.80 ms  x3.41   | 5.10 ms  x3.88   |
| ts->esm syntax-transforms.ts (25KB)              | 4.10 ms   | 1.10 ms  x3.73   | 1.00 ms  x4.10   |
| ts->esm module-transformer.ts (9KB)              | 2.00 ms   | 400.0 us  x5.00  | 500.0 us  x4.00  |
| vite ts+sourcemap script-engine.ts               | 24.60 ms  | 7.50 ms  x3.28   | 7.70 ms  x3.19   |
| vite ts+sourcemap memory-volume.ts               | 25.60 ms  | 7.50 ms  x3.41   | 7.00 ms  x3.66   |
| vite tsx+sourcemap component x20                 | 2.50 ms   | 500.0 us  x5.00  | 400.0 us  x6.25  |
| build bundle zod (plugin fs)                     | 126.20 ms | 130.60 ms  x0.97 | 136.60 ms  x0.92 |

```json
{
 "wasm": {
  "cold start: initialize()": {
   "impl": "wasm",
   "name": "cold start: initialize()",
   "ms": 38.700000047683716,
   "min": 38.700000047683716,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "wasm",
   "name": "cold start: initialize() + first transform",
   "ms": 152.79999995231628,
   "min": 152.79999995231628,
   "samples": 1,
   "batch": 1
  },
  "transform latency: empty input": {
   "impl": "wasm",
   "name": "transform latency: empty input",
   "ms": 0.6000000238418579,
   "min": 0.6000000238418579,
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
   "ms": 129.89999997615814,
   "min": 129.89999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 7.298329485558166
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 66,
   "min": 66,
   "samples": 1,
   "batch": 1,
   "mbps": 10.042
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 58.40000009536743,
   "min": 58.40000009536743,
   "samples": 1,
   "batch": 1,
   "mbps": 3.7693150623378444
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 56.89999997615814,
   "min": 56.89999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 3.868681899687813
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 19.100000023841858,
   "min": 19.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 7.580418838705169
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 19.799999952316284,
   "min": 19.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 7.173636380912406
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 4.100000023841858,
   "min": 4.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 6.438780450362808
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 2,
   "min": 2,
   "samples": 1,
   "batch": 1,
   "mbps": 5.104
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 24.59999990463257,
   "min": 24.59999990463257,
   "samples": 1,
   "batch": 1,
   "mbps": 5.885609778914451
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 25.600000023841858,
   "min": 25.600000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 5.548359369832688
  },
  "vite tsx+sourcemap component x20": {
   "impl": "wasm",
   "name": "vite tsx+sourcemap component x20",
   "ms": 2.5,
   "min": 2.5,
   "samples": 1,
   "batch": 1,
   "mbps": 1.776
  },
  "build bundle zod (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod (plugin fs)",
   "ms": 126.20000004768372,
   "min": 126.20000004768372,
   "samples": 1,
   "batch": 1
  }
 },
 "prev": {
  "cold start: initialize()": {
   "impl": "prev",
   "name": "cold start: initialize()",
   "ms": 45.299999952316284,
   "min": 45.299999952316284,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "prev",
   "name": "cold start: initialize() + first transform",
   "ms": 77.29999995231628,
   "min": 77.29999995231628,
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
   "ms": 0.2999999523162842,
   "min": 0.2999999523162842,
   "samples": 1,
   "batch": 1,
   "mbps": 5.363334185812344
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 2.5,
   "min": 2.5,
   "samples": 1,
   "batch": 1,
   "mbps": 20.5504
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 39.5,
   "min": 39.5,
   "samples": 1,
   "batch": 1,
   "mbps": 24.0013417721519
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 26.100000023841858,
   "min": 26.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 25.393563195194265
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "prev",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 12.799999952316284,
   "min": 12.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 17.19750006406568
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "prev",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 11,
   "min": 11,
   "samples": 1,
   "batch": 1,
   "mbps": 20.011636363636363
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "prev",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 5.899999976158142,
   "min": 5.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 24.540000099165965
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "prev",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 5.799999952316284,
   "min": 5.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 24.489310546162297
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "prev",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 1.100000023841858,
   "min": 1.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 23.999090388924635
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "prev",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.40000009536743164,
   "min": 0.40000009536743164,
   "samples": 1,
   "batch": 1,
   "mbps": 25.51999391555931
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.5,
   "min": 7.5,
   "samples": 1,
   "batch": 1,
   "mbps": 19.3048
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "prev",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7.5,
   "min": 7.5,
   "samples": 1,
   "batch": 1,
   "mbps": 18.9384
  },
  "vite tsx+sourcemap component x20": {
   "impl": "prev",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.5,
   "min": 0.5,
   "samples": 1,
   "batch": 1,
   "mbps": 8.88
  },
  "build bundle zod (plugin fs)": {
   "impl": "prev",
   "name": "build bundle zod (plugin fs)",
   "ms": 130.60000002384186,
   "min": 130.60000002384186,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "cold start: initialize()": {
   "impl": "fast",
   "name": "cold start: initialize()",
   "ms": 45.39999997615814,
   "min": 45.39999997615814,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "fast",
   "name": "cold start: initialize() + first transform",
   "ms": 77.60000002384186,
   "min": 77.60000002384186,
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
   "ms": 0.20000004768371582,
   "min": 0.20000004768371582,
   "samples": 1,
   "batch": 1,
   "mbps": 8.044998081922989
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
   "ms": 34.39999997615814,
   "min": 34.39999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 27.559680251659127
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 21.40000009536743,
   "min": 21.40000009536743,
   "samples": 1,
   "batch": 1,
   "mbps": 30.970654067589173
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 9.899999976158142,
   "min": 9.899999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 22.23515156869973
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 9.200000047683716,
   "min": 9.200000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 23.926956397725412
  },
  "ts->esm script-engine.ts (141KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (141KB)",
   "ms": 5,
   "min": 5,
   "samples": 1,
   "batch": 1,
   "mbps": 28.9572
  },
  "ts->esm memory-volume.ts (138KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (138KB)",
   "ms": 5.100000023841858,
   "min": 5.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 27.850588105096126
  },
  "ts->esm syntax-transforms.ts (25KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (25KB)",
   "ms": 1,
   "min": 1,
   "samples": 1,
   "batch": 1,
   "mbps": 26.398999999999997
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "fast",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 0.5,
   "min": 0.5,
   "samples": 1,
   "batch": 1,
   "mbps": 20.416
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 7.700000047683716,
   "min": 7.700000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 18.803376506933134
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7,
   "min": 7,
   "samples": 1,
   "batch": 1,
   "mbps": 20.291142857142855
  },
  "vite tsx+sourcemap component x20": {
   "impl": "fast",
   "name": "vite tsx+sourcemap component x20",
   "ms": 0.40000009536743164,
   "min": 0.40000009536743164,
   "samples": 1,
   "batch": 1,
   "mbps": 11.099997353554404
  },
  "build bundle zod (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod (plugin fs)",
   "ms": 136.60000002384186,
   "min": 136.60000002384186,
   "samples": 1,
   "batch": 1
  }
 }
}
```
