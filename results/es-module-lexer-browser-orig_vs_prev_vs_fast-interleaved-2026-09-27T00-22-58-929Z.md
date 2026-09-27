| case                                  | orig     | prev            | fast            |
|---------------------------------------|----------|-----------------|-----------------|
| tiny module (70B)                     | 0.5 us   | 0.3 us  x1.42   | 0.2 us  x2.25   |
| zod-errors.js (1.6KB esm)             | 4.9 us   | 2.4 us  x2.01   | 1.3 us  x3.68   |
| zod-schemas.js (51KB esm) [utf16]     | 180.5 us | 108.1 us  x1.67 | 41.0 us  x4.40  |
| react-dom-client.prod (536KB cjs)     | 2.34 ms  | 643.8 us  x3.63 | 315.0 us  x7.42 |
| rollup node-entry (948KB esm) [utf16] | 4.19 ms  | 2.09 ms  x2.01  | 851.7 us  x4.92 |
| react-dom-client.dev (1MB cjs)        | 4.23 ms  | 1.35 ms  x3.13  | 782.5 us  x5.41 |
| three.module (1.2MB esm)              | 2.38 ms  | 775.0 us  x3.06 | 433.8 us  x5.48 |
| batch: 88 zod/v4 modules              | 2.11 ms  | 1.25 ms  x1.68  | 600.0 us  x3.51 |
| batch: 34 @vue files                  | 7.40 ms  | 2.66 ms  x2.78  | 1.64 ms  x4.52  |
| batch: 644 lodash-es modules          | 2.39 ms  | 1.07 ms  x2.24  | 571.2 us  x4.19 |
| batch: 753 three/src modules          | 16.20 ms | 6.61 ms  x2.45  | 3.84 ms  x4.22  |
| batch: 210 zod files                  | 5.69 ms  | 3.35 ms  x1.70  | 1.59 ms  x3.57  |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.00045899999141693116,
   "min": 0.00045899999141693116,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004855305531400576,
   "min": 0.004855305531400576,
   "samples": 1,
   "batch": 1,
   "mbps": 331.39006177760825
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.180512819534693,
   "min": 0.180512819534693,
   "samples": 1,
   "batch": 1,
   "mbps": 284.6224447240745
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.3375000059604645,
   "min": 2.3375000059604645,
   "samples": 1,
   "batch": 1,
   "mbps": 229.31165716928174
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 4.188333352406819,
   "min": 4.188333352406819,
   "samples": 1,
   "batch": 1,
   "mbps": 226.35948961779596
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 4.2299999594688416,
   "min": 4.2299999594688416,
   "samples": 1,
   "batch": 1,
   "mbps": 251.93806387974976
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.375,
   "min": 2.375,
   "samples": 1,
   "batch": 1,
   "mbps": 279.06189473684213
  },
  "batch: 88 zod/v4 modules": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules",
   "ms": 2.1050000190734863,
   "min": 2.1050000190734863,
   "samples": 1,
   "batch": 1,
   "mbps": 286.22660073190536
  },
  "batch: 34 @vue files": {
   "impl": "orig",
   "name": "batch: 34 @vue files",
   "ms": 7.399999976158142,
   "min": 7.399999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 216.23824393993533
  },
  "batch: 644 lodash-es modules": {
   "impl": "orig",
   "name": "batch: 644 lodash-es modules",
   "ms": 2.392500013113022,
   "min": 2.392500013113022,
   "samples": 1,
   "batch": 1,
   "mbps": 263.99163909645637
  },
  "batch: 753 three/src modules": {
   "impl": "orig",
   "name": "batch: 753 three/src modules",
   "ms": 16.195000052452087,
   "min": 16.195000052452087,
   "samples": 1,
   "batch": 1,
   "mbps": 286.2990419872193
  },
  "batch: 210 zod files": {
   "impl": "orig",
   "name": "batch: 210 zod files",
   "ms": 5.689999997615814,
   "min": 5.689999997615814,
   "samples": 1,
   "batch": 1,
   "mbps": 290.41792630798074
  }
 },
 "prev": {
  "tiny module (70B)": {
   "impl": "prev",
   "name": "tiny module (70B)",
   "ms": 0.00032400000095367433,
   "min": 0.00032400000095367433,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.002411575562700965,
   "min": 0.002411575562700965,
   "samples": 1,
   "batch": 1,
   "mbps": 667.1986666666667
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "prev",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.10807692393278465,
   "min": 0.10807692393278465,
   "samples": 1,
   "batch": 1,
   "mbps": 475.38362612867365
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.643750011920929,
   "min": 0.643750011920929,
   "samples": 1,
   "batch": 1,
   "mbps": 832.6461981733341
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "prev",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 2.088333328564962,
   "min": 2.088333328564962,
   "samples": 1,
   "batch": 1,
   "mbps": 453.9835604939005
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 1.3524999618530273,
   "min": 1.3524999618530273,
   "samples": 1,
   "batch": 1,
   "mbps": 787.9467874734081
  },
  "three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "three.module (1.2MB esm)",
   "ms": 0.7750000059604645,
   "min": 0.7750000059604645,
   "samples": 1,
   "batch": 1,
   "mbps": 855.1896708421579
  },
  "batch: 88 zod/v4 modules": {
   "impl": "prev",
   "name": "batch: 88 zod/v4 modules",
   "ms": 1.2524999976158142,
   "min": 1.2524999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 481.0435138897382
  },
  "batch: 34 @vue files": {
   "impl": "prev",
   "name": "batch: 34 @vue files",
   "ms": 2.6600000262260437,
   "min": 2.6600000262260437,
   "samples": 1,
   "batch": 1,
   "mbps": 601.5650316629058
  },
  "batch: 644 lodash-es modules": {
   "impl": "prev",
   "name": "batch: 644 lodash-es modules",
   "ms": 1.0674999952316284,
   "min": 1.0674999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 591.6627661089161
  },
  "batch: 753 three/src modules": {
   "impl": "prev",
   "name": "batch: 753 three/src modules",
   "ms": 6.609999895095825,
   "min": 6.609999895095825,
   "samples": 1,
   "batch": 1,
   "mbps": 701.4543227814655
  },
  "batch: 210 zod files": {
   "impl": "prev",
   "name": "batch: 210 zod files",
   "ms": 3.349999964237213,
   "min": 3.349999964237213,
   "samples": 1,
   "batch": 1,
   "mbps": 493.2770201913316
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.00020399999618530274,
   "min": 0.00020399999618530274,
   "samples": 1,
   "batch": 1
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.001318327962777239,
   "min": 0.001318327962777239,
   "samples": 1,
   "batch": 1,
   "mbps": 1220.4853764995019
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.041025641636970714,
   "min": 0.041025641636970714,
   "samples": 1,
   "batch": 1,
   "mbps": 1252.3387313386986
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.3149999976158142,
   "min": 0.3149999976158142,
   "samples": 1,
   "batch": 1,
   "mbps": 1701.6381081175282
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.8516666889190674,
   "min": 0.8516666889190674,
   "samples": 1,
   "batch": 1,
   "mbps": 1113.1925345152176
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.7825000286102295,
   "min": 0.7825000286102295,
   "samples": 1,
   "batch": 1,
   "mbps": 1361.914327201685
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.4337500035762787,
   "min": 0.4337500035762787,
   "samples": 1,
   "batch": 1,
   "mbps": 1528.0045983525758
  },
  "batch: 88 zod/v4 modules": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules",
   "ms": 0.5999999940395355,
   "min": 0.5999999940395355,
   "samples": 1,
   "batch": 1,
   "mbps": 1004.1783433089489
  },
  "batch: 34 @vue files": {
   "impl": "fast",
   "name": "batch: 34 @vue files",
   "ms": 1.637499988079071,
   "min": 1.637499988079071,
   "samples": 1,
   "batch": 1,
   "mbps": 977.198785739919
  },
  "batch: 644 lodash-es modules": {
   "impl": "fast",
   "name": "batch: 644 lodash-es modules",
   "ms": 0.5712499916553497,
   "min": 0.5712499916553497,
   "samples": 1,
   "batch": 1,
   "mbps": 1105.6455303741361
  },
  "batch: 753 three/src modules": {
   "impl": "fast",
   "name": "batch: 753 three/src modules",
   "ms": 3.840000033378601,
   "min": 3.840000033378601,
   "samples": 1,
   "batch": 1,
   "mbps": 1207.4512915877513
  },
  "batch: 210 zod files": {
   "impl": "fast",
   "name": "batch: 210 zod files",
   "ms": 1.5924999713897705,
   "min": 1.5924999713897705,
   "samples": 1,
   "batch": 1,
   "mbps": 1037.662812990751
  }
 }
}
```
