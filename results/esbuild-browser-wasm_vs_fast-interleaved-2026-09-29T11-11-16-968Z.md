| case                                               | wasm      | fast             |
|----------------------------------------------------|-----------|------------------|
| cold start: initialize()                           | 37.00 ms  | 35.00 ms  x1.06  |
| cold start: initialize() + first transform         | 152.40 ms | 55.90 ms  x2.73  |
| transform latency: empty input                     | 600.0 us  | 100.0 us  x6.00  |
| transform latency: tiny TS                         | 600.0 us  | 100.0 us  x6.00  |
| esm->cjs zod-errors.js (1.6KB esm)                 | 1.40 ms   | 300.0 us  x4.67  |
| esm->cjs zod-schemas.js (51KB esm)                 | 11.40 ms  | 2.10 ms  x5.43   |
| esm->cjs rollup node-entry (948KB esm)             | 127.40 ms | 36.50 ms  x3.49  |
| esm->cjs three.module (1.2MB esm)                  | 65.10 ms  | 20.50 ms  x3.18  |
| esm->cjs batch 17 zod/v4/core files (sequential)   | 56.50 ms  | 10.00 ms  x5.65  |
| esm->cjs batch 17 zod/v4/core files (concurrent)   | 55.60 ms  | 9.70 ms  x5.73   |
| ts->esm script-engine.ts (157KB)                   | 19.70 ms  | 5.80 ms  x3.40   |
| ts->esm memory-volume.ts (143KB)                   | 19.40 ms  | 5.70 ms  x3.40   |
| ts->esm syntax-transforms.ts (31KB)                | 4.50 ms   | 1.00 ms  x4.50   |
| ts->esm module-transformer.ts (9KB)                | 1.90 ms   | 400.0 us  x4.75  |
| vite ts+sourcemap script-engine.ts                 | 27.00 ms  | 7.60 ms  x3.55   |
| vite ts+sourcemap memory-volume.ts                 | 25.80 ms  | 7.50 ms  x3.44   |
| vite tsx+sourcemap component x20                   | 2.50 ms   | 500.0 us  x5.00  |
| build bundle zod (plugin fs)                       | 121.10 ms | 37.50 ms  x3.23  |
| build bundle zod minified + source map (plugin fs) | 159.00 ms | 51.20 ms  x3.11  |
| build bundle lodash-es, 640 files (plugin fs)      | 400.80 ms | 126.30 ms  x3.17 |
| build bundle three, 1.2MB (plugin fs)              | 227.30 ms | 86.80 ms  x2.62  |
| build bundle react-dom client, 1MB cjs (plugin fs) | 94.70 ms  | 39.00 ms  x2.43  |

```json
{
 "wasm": {
  "cold start: initialize()": {
   "impl": "wasm",
   "name": "cold start: initialize()",
   "ms": 37,
   "min": 37,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "wasm",
   "name": "cold start: initialize() + first transform",
   "ms": 152.39999997615814,
   "min": 152.39999997615814,
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
   "ms": 1.4000000953674316,
   "min": 1.4000000953674316,
   "samples": 1,
   "batch": 1,
   "mbps": 1.1492856359968433
  },
  "esm->cjs zod-schemas.js (51KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs zod-schemas.js (51KB esm)",
   "ms": 11.399999976158142,
   "min": 11.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 4.506666676091869
  },
  "esm->cjs rollup node-entry (948KB esm)": {
   "impl": "wasm",
   "name": "esm->cjs rollup node-entry (948KB esm)",
   "ms": 127.39999997615814,
   "min": 127.39999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 7.4415463122246495
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "wasm",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 65.09999990463257,
   "min": 65.09999990463257,
   "samples": 1,
   "batch": 1,
   "mbps": 10.180829508001837
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 56.5,
   "min": 56.5,
   "samples": 1,
   "batch": 1,
   "mbps": 3.896070796460177
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "wasm",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 55.59999990463257,
   "min": 55.59999990463257,
   "samples": 1,
   "batch": 1,
   "mbps": 3.9591366974383577
  },
  "ts->esm script-engine.ts (157KB)": {
   "impl": "wasm",
   "name": "ts->esm script-engine.ts (157KB)",
   "ms": 19.699999928474426,
   "min": 19.699999928474426,
   "samples": 1,
   "batch": 1,
   "mbps": 8.167563481430948
  },
  "ts->esm memory-volume.ts (143KB)": {
   "impl": "wasm",
   "name": "ts->esm memory-volume.ts (143KB)",
   "ms": 19.399999976158142,
   "min": 19.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 7.576649493847495
  },
  "ts->esm syntax-transforms.ts (31KB)": {
   "impl": "wasm",
   "name": "ts->esm syntax-transforms.ts (31KB)",
   "ms": 4.5,
   "min": 4.5,
   "samples": 1,
   "batch": 1,
   "mbps": 7.067111111111111
  },
  "ts->esm module-transformer.ts (9KB)": {
   "impl": "wasm",
   "name": "ts->esm module-transformer.ts (9KB)",
   "ms": 1.9000000953674316,
   "min": 1.9000000953674316,
   "samples": 1,
   "batch": 1,
   "mbps": 5.372631309276817
  },
  "vite ts+sourcemap script-engine.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap script-engine.ts",
   "ms": 27,
   "min": 27,
   "samples": 1,
   "batch": 1,
   "mbps": 5.959296296296296
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "wasm",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 25.799999952316284,
   "min": 25.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 5.697170553165204
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
   "ms": 121.09999990463257,
   "min": 121.09999990463257,
   "samples": 1,
   "batch": 1
  },
  "build bundle zod minified + source map (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle zod minified + source map (plugin fs)",
   "ms": 159,
   "min": 159,
   "samples": 1,
   "batch": 1
  },
  "build bundle lodash-es, 640 files (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle lodash-es, 640 files (plugin fs)",
   "ms": 400.8000000715256,
   "min": 400.8000000715256,
   "samples": 1,
   "batch": 1
  },
  "build bundle three, 1.2MB (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle three, 1.2MB (plugin fs)",
   "ms": 227.29999995231628,
   "min": 227.29999995231628,
   "samples": 1,
   "batch": 1
  },
  "build bundle react-dom client, 1MB cjs (plugin fs)": {
   "impl": "wasm",
   "name": "build bundle react-dom client, 1MB cjs (plugin fs)",
   "ms": 94.70000004768372,
   "min": 94.70000004768372,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "cold start: initialize()": {
   "impl": "fast",
   "name": "cold start: initialize()",
   "ms": 35,
   "min": 35,
   "samples": 1,
   "batch": 1
  },
  "cold start: initialize() + first transform": {
   "impl": "fast",
   "name": "cold start: initialize() + first transform",
   "ms": 55.90000009536743,
   "min": 55.90000009536743,
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
   "ms": 36.5,
   "min": 36.5,
   "samples": 1,
   "batch": 1,
   "mbps": 25.97405479452055
  },
  "esm->cjs three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "esm->cjs three.module (1.2MB esm)",
   "ms": 20.5,
   "min": 20.5,
   "samples": 1,
   "batch": 1,
   "mbps": 32.33034146341463
  },
  "esm->cjs batch 17 zod/v4/core files (sequential)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (sequential)",
   "ms": 10,
   "min": 10,
   "samples": 1,
   "batch": 1,
   "mbps": 22.0128
  },
  "esm->cjs batch 17 zod/v4/core files (concurrent)": {
   "impl": "fast",
   "name": "esm->cjs batch 17 zod/v4/core files (concurrent)",
   "ms": 9.699999928474426,
   "min": 9.699999928474426,
   "samples": 1,
   "batch": 1,
   "mbps": 22.69360841476014
  },
  "ts->esm script-engine.ts (157KB)": {
   "impl": "fast",
   "name": "ts->esm script-engine.ts (157KB)",
   "ms": 5.799999952316284,
   "min": 5.799999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 27.74155195221039
  },
  "ts->esm memory-volume.ts (143KB)": {
   "impl": "fast",
   "name": "ts->esm memory-volume.ts (143KB)",
   "ms": 5.700000047683716,
   "min": 5.700000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 25.787192766731724
  },
  "ts->esm syntax-transforms.ts (31KB)": {
   "impl": "fast",
   "name": "ts->esm syntax-transforms.ts (31KB)",
   "ms": 1,
   "min": 1,
   "samples": 1,
   "batch": 1,
   "mbps": 31.801999999999996
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
   "ms": 7.600000023841858,
   "min": 7.600000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 21.171184144110477
  },
  "vite ts+sourcemap memory-volume.ts": {
   "impl": "fast",
   "name": "vite ts+sourcemap memory-volume.ts",
   "ms": 7.5,
   "min": 7.5,
   "samples": 1,
   "batch": 1,
   "mbps": 19.598266666666667
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
   "ms": 37.5,
   "min": 37.5,
   "samples": 1,
   "batch": 1
  },
  "build bundle zod minified + source map (plugin fs)": {
   "impl": "fast",
   "name": "build bundle zod minified + source map (plugin fs)",
   "ms": 51.200000047683716,
   "min": 51.200000047683716,
   "samples": 1,
   "batch": 1
  },
  "build bundle lodash-es, 640 files (plugin fs)": {
   "impl": "fast",
   "name": "build bundle lodash-es, 640 files (plugin fs)",
   "ms": 126.30000007152557,
   "min": 126.30000007152557,
   "samples": 1,
   "batch": 1
  },
  "build bundle three, 1.2MB (plugin fs)": {
   "impl": "fast",
   "name": "build bundle three, 1.2MB (plugin fs)",
   "ms": 86.80000007152557,
   "min": 86.80000007152557,
   "samples": 1,
   "batch": 1
  },
  "build bundle react-dom client, 1MB cjs (plugin fs)": {
   "impl": "fast",
   "name": "build bundle react-dom client, 1MB cjs (plugin fs)",
   "ms": 39,
   "min": 39,
   "samples": 1,
   "batch": 1
  }
 }
}
```
