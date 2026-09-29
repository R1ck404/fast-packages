| case                                  | orig     | prev            | fast            |
|---------------------------------------|----------|-----------------|-----------------|
| tiny module (70B)                     | 0.5 us   | 0.2 us  x2.39   | 0.2 us  x2.31   |
| zod-errors.js (1.6KB esm)             | 4.8 us   | 1.3 us  x3.81   | 1.2 us  x3.93   |
| zod-schemas.js (51KB esm) [utf16]     | 175.9 us | 39.9 us  x4.41  | 40.1 us  x4.38  |
| react-dom-client.prod (536KB cjs)     | 2.24 ms  | 315.0 us  x7.10 | 315.0 us  x7.10 |
| rollup node-entry (948KB esm) [utf16] | 4.14 ms  | 831.7 us  x4.97 | 843.3 us  x4.91 |
| react-dom-client.dev (1MB cjs)        | 4.15 ms  | 770.0 us  x5.39 | 777.5 us  x5.33 |
| three.module (1.2MB esm)              | 2.34 ms  | 430.0 us  x5.44 | 432.5 us  x5.40 |
| batch: 88 zod/v4 modules              | 2.07 ms  | 576.2 us  x3.59 | 585.0 us  x3.54 |
| batch: 34 @vue files                  | 7.21 ms  | 1.61 ms  x4.47  | 1.63 ms  x4.43  |
| batch: 644 lodash-es modules          | 2.35 ms  | 560.0 us  x4.20 | 563.7 us  x4.18 |
| batch: 753 three/src modules          | 16.04 ms | 3.78 ms  x4.25  | 3.79 ms  x4.23  |
| batch: 210 zod files                  | 5.60 ms  | 1.54 ms  x3.63  | 1.56 ms  x3.60  |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.00045800001621246336,
   "min": 0.00045800001621246336,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004843247569258957,
   "min": 0.004843247569258957,
   "samples": 1,
   "batch": 1,
   "mbps": 332.2151050490664
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.1758974362642337,
   "min": 0.1758974362642337,
   "samples": 1,
   "batch": 1,
   "mbps": 292.09066994484107
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.236250013113022,
   "min": 2.236250013113022,
   "samples": 1,
   "batch": 1,
   "mbps": 239.69412939380018
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 4.136666655540466,
   "min": 4.136666655540466,
   "samples": 1,
   "batch": 1,
   "mbps": 229.18670488718226
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 4.147500038146973,
   "min": 4.147500038146973,
   "samples": 1,
   "batch": 1,
   "mbps": 256.9494852798445
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.337499976158142,
   "min": 2.337499976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 283.5388264214299
  },
  "batch: 88 zod/v4 modules": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules",
   "ms": 2.0687499940395355,
   "min": 2.0687499940395355,
   "samples": 1,
   "batch": 1,
   "mbps": 291.2420552197887
  },
  "batch: 34 @vue files": {
   "impl": "orig",
   "name": "batch: 34 @vue files",
   "ms": 7.214999973773956,
   "min": 7.214999973773956,
   "samples": 1,
   "batch": 1,
   "mbps": 221.78281438897932
  },
  "batch: 644 lodash-es modules": {
   "impl": "orig",
   "name": "batch: 644 lodash-es modules",
   "ms": 2.353749990463257,
   "min": 2.353749990463257,
   "samples": 1,
   "batch": 1,
   "mbps": 268.33775998261
  },
  "batch: 753 three/src modules": {
   "impl": "orig",
   "name": "batch: 753 three/src modules",
   "ms": 16.039999961853027,
   "min": 16.039999961853027,
   "samples": 1,
   "batch": 1,
   "mbps": 289.0656490665199
  },
  "batch: 210 zod files": {
   "impl": "orig",
   "name": "batch: 210 zod files",
   "ms": 5.602500021457672,
   "min": 5.602500021457672,
   "samples": 1,
   "batch": 1,
   "mbps": 294.9536802625579
  }
 },
 "prev": {
  "tiny module (70B)": {
   "impl": "prev",
   "name": "tiny module (70B)",
   "ms": 0.00019200000762939454,
   "min": 0.00019200000762939454,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0012700964975203733,
   "min": 0.0012700964975203733,
   "samples": 1,
   "batch": 1,
   "mbps": 1266.8328769831842
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "prev",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.039871796583518006,
   "min": 0.039871796583518006,
   "samples": 1,
   "batch": 1,
   "mbps": 1288.58000898907
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.3149999976158142,
   "min": 0.3149999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 1701.6381081175282
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "prev",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.8316666682561239,
   "min": 0.8316666682561239,
   "samples": 1,
   "batch": 1,
   "mbps": 1139.962723272238
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.7699999809265137,
   "min": 0.7699999809265137,
   "samples": 1,
   "batch": 1,
   "mbps": 1384.0234109066905
  },
  "three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "three.module (1.2MB esm)",
   "ms": 0.4300000071525574,
   "min": 0.4300000071525574,
   "samples": 1,
   "batch": 1,
   "mbps": 1541.3302069198774
  },
  "batch: 88 zod/v4 modules": {
   "impl": "prev",
   "name": "batch: 88 zod/v4 modules",
   "ms": 0.5762499868869781,
   "min": 0.5762499868869781,
   "samples": 1,
   "batch": 1,
   "mbps": 1045.5653166343095
  },
  "batch: 34 @vue files": {
   "impl": "prev",
   "name": "batch: 34 @vue files",
   "ms": 1.6124999523162842,
   "min": 1.6124999523162842,
   "samples": 1,
   "batch": 1,
   "mbps": 992.3491766318737
  },
  "batch: 644 lodash-es modules": {
   "impl": "prev",
   "name": "batch: 644 lodash-es modules",
   "ms": 0.5600000023841858,
   "min": 0.5600000023841858,
   "samples": 1,
   "batch": 1,
   "mbps": 1127.8571380553199
  },
  "batch: 753 three/src modules": {
   "impl": "prev",
   "name": "batch: 753 three/src modules",
   "ms": 3.7750000953674316,
   "min": 3.7750000953674316,
   "samples": 1,
   "batch": 1,
   "mbps": 1228.2418232756904
  },
  "batch: 210 zod files": {
   "impl": "prev",
   "name": "batch: 210 zod files",
   "ms": 1.5424999594688416,
   "min": 1.5424999594688416,
   "samples": 1,
   "batch": 1,
   "mbps": 1071.29856947875
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.00019800000190734864,
   "min": 0.00019800000190734864,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0012339228027503208,
   "min": 0.0012339228027503208,
   "samples": 1,
   "batch": 1,
   "mbps": 1303.9713638597655
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.040128206595396385,
   "min": 0.040128206595396385,
   "samples": 1,
   "batch": 1,
   "mbps": 1280.3462790658136
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.3150000274181366,
   "min": 0.3150000274181366,
   "samples": 1,
   "batch": 1,
   "mbps": 1701.6379471246296
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.8433333237965902,
   "min": 0.8433333237965902,
   "samples": 1,
   "batch": 1,
   "mbps": 1124.1925028313856
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.7774999737739563,
   "min": 0.7774999737739563,
   "samples": 1,
   "batch": 1,
   "mbps": 1370.6727150447878
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.4325000047683716,
   "min": 0.4325000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 1532.4207923534066
  },
  "batch: 88 zod/v4 modules": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules",
   "ms": 0.5850000083446503,
   "min": 0.5850000083446503,
   "samples": 1,
   "batch": 1,
   "mbps": 1029.9264810352543
  },
  "batch: 34 @vue files": {
   "impl": "fast",
   "name": "batch: 34 @vue files",
   "ms": 1.6300000548362732,
   "min": 1.6300000548362732,
   "samples": 1,
   "batch": 1,
   "mbps": 981.6950589984672
  },
  "batch: 644 lodash-es modules": {
   "impl": "fast",
   "name": "batch: 644 lodash-es modules",
   "ms": 0.5637499988079071,
   "min": 0.5637499988079071,
   "samples": 1,
   "batch": 1,
   "mbps": 1120.3547695531122
  },
  "batch: 753 three/src modules": {
   "impl": "fast",
   "name": "batch: 753 three/src modules",
   "ms": 3.7949999570846558,
   "min": 3.7949999570846558,
   "samples": 1,
   "batch": 1,
   "mbps": 1221.7689202721037
  },
  "batch: 210 zod files": {
   "impl": "fast",
   "name": "batch: 210 zod files",
   "ms": 1.5575000047683716,
   "min": 1.5575000047683716,
   "samples": 1,
   "batch": 1,
   "mbps": 1060.9810561417964
  }
 }
}
```
