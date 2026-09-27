| case                              | orig     | fast            |
|-----------------------------------|----------|-----------------|
| tiny module (70B)                 | 0.5 us   | 0.5 us  x1.00   |
| zod-errors.js (1.6KB esm)         | 4.8 us   | 2.4 us  x2.00   |
| zod-schemas.js (51KB esm)         | 200.0 us | 100.0 us  x2.00 |
| react-dom-client.prod (536KB cjs) | 2.30 ms  | 600.0 us  x3.83 |
| rollup node-entry (948KB esm)     | 4.20 ms  | 2.10 ms  x2.00  |
| react-dom-client.dev (1MB cjs)    | 4.30 ms  | 1.40 ms  x3.07  |
| three.module (1.2MB esm)          | 2.40 ms  | 800.0 us  x3.00 |
| batch: 88 zod/v4 modules          | 2.20 ms  | 1.30 ms  x1.69  |
| batch: 34 @vue files              | 7.40 ms  | 2.70 ms  x2.74  |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.0005000001192092896,
   "min": 0.0005000001192092896,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004800000190734863,
   "min": 0.004800000190734863,
   "samples": 1,
   "batch": 1,
   "mbps": 335.2083200133514
  },
  "zod-schemas.js (51KB esm)": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm)",
   "ms": 0.20000001788139343,
   "min": 0.20000001788139343,
   "samples": 1,
   "batch": 1,
   "mbps": 256.8899770322463
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.3000000715255737,
   "min": 2.3000000715255737,
   "samples": 1,
   "batch": 1,
   "mbps": 233.05042753518893
  },
  "rollup node-entry (948KB esm)": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm)",
   "ms": 4.199999928474426,
   "min": 4.199999928474426,
   "samples": 1,
   "batch": 1,
   "mbps": 225.73071812988553
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 4.299999952316284,
   "min": 4.299999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 247.83674693436674
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.399999976158142,
   "min": 2.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 276.15500274335346
  },
  "batch: 88 zod/v4 modules": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules",
   "ms": 2.200000047683716,
   "min": 2.200000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 273.8668122459149
  },
  "batch: 34 @vue files": {
   "impl": "orig",
   "name": "batch: 34 @vue files",
   "ms": 7.399999976158142,
   "min": 7.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 216.23824393993533
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.0005000001192092896,
   "min": 0.0005000001192092896,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.00240000057220459,
   "min": 0.00240000057220459,
   "samples": 1,
   "batch": 1,
   "mbps": 670.4165068269157
  },
  "zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm)",
   "ms": 0.10000002384185791,
   "min": 0.10000002384185791,
   "samples": 1,
   "batch": 1,
   "mbps": 513.7798775053317
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.6000000238418579,
   "min": 0.6000000238418579,
   "samples": 1,
   "batch": 1,
   "mbps": 893.3599645010645
  },
  "rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm)",
   "ms": 2.100000023841858,
   "min": 2.100000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 451.46142344586707
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 1.399999976158142,
   "min": 1.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 761.2128701062351
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.7999999523162842,
   "min": 0.7999999523162842,
   "samples": 1,
   "batch": 1,
   "mbps": 828.4650493803649
  },
  "batch: 88 zod/v4 modules": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules",
   "ms": 1.2999999523162842,
   "min": 1.2999999523162842,
   "samples": 1,
   "batch": 1,
   "mbps": 463.4669400767891
  },
  "batch: 34 @vue files": {
   "impl": "fast",
   "name": "batch: 34 @vue files",
   "ms": 2.700000047683716,
   "min": 2.700000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 592.6529524963353
  }
 }
}
```
