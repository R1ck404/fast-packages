| case                                  | orig     | fast            |
|---------------------------------------|----------|-----------------|
| tiny module (70B)                     | 0.6 us   | 0.3 us  x1.75   |
| zod-errors.js (1.6KB esm)             | 4.8 us   | 2.1 us  x2.27   |
| zod-schemas.js (51KB esm) [utf16]     | 157.3 us | 93.9 us  x1.68  |
| react-dom-client.prod (536KB cjs)     | 2.15 ms  | 585.6 us  x3.67 |
| babel-parser (513KB cjs)              | 2.02 ms  | 626.9 us  x3.22 |
| rollup node-entry (948KB esm) [utf16] | 3.66 ms  | 1.75 ms  x2.09  |
| react-dom-client.dev (1MB cjs)        | 3.86 ms  | 1.23 ms  x3.13  |
| three.module (1.2MB esm)              | 2.18 ms  | 721.5 us  x3.02 |
| typescript.js (9MB cjs)               | 37.46 ms | 11.99 ms  x3.12 |
| batch: 88 zod/v4 modules (570KB)      | 2.02 ms  | 1.10 ms  x1.84  |
| batch: 34 @vue files (1562KB)         | 6.94 ms  | 2.49 ms  x2.79  |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.0005571853215835838,
   "min": 0.0005400420886492186,
   "samples": 117,
   "batch": 38015
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004819963811821525,
   "min": 0.004546200241254499,
   "samples": 100,
   "batch": 4974,
   "mbps": 333.8199336795308
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.15728684210526017,
   "min": 0.1515657894736813,
   "samples": 100,
   "batch": 152,
   "mbps": 326.6388930716654
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.1511416666667174,
   "min": 2.0788166666666257,
   "samples": 95,
   "batch": 12,
   "mbps": 249.1774522830841
  },
  "babel-parser (513KB cjs)": {
   "impl": "orig",
   "name": "babel-parser (513KB cjs)",
   "ms": 2.021296153846169,
   "min": 1.9659307692307686,
   "samples": 94,
   "batch": 13,
   "mbps": 253.90341688596425
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 3.661657142856971,
   "min": 3.600228571428618,
   "samples": 95,
   "batch": 7,
   "mbps": 258.9136456561554
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 3.8568285714284554,
   "min": 3.6437285714283854,
   "samples": 90,
   "batch": 7,
   "mbps": 276.31458859611615
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.1807500000001405,
   "min": 2.1344000000002175,
   "samples": 93,
   "batch": 12,
   "mbps": 303.9192938209136
  },
  "typescript.js (9MB cjs)": {
   "impl": "orig",
   "name": "typescript.js (9MB cjs)",
   "ms": 37.45534999999836,
   "min": 34.97450000000026,
   "samples": 64,
   "batch": 1,
   "mbps": 243.29159919745507
  },
  "batch: 88 zod/v4 modules (570KB)": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules (570KB)",
   "ms": 2.022861538461327,
   "min": 1.8966384615386442,
   "samples": 93,
   "batch": 13,
   "mbps": 288.5501498258672
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "orig",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 6.942124999999578,
   "min": 6.784700000000157,
   "samples": 88,
   "batch": 4,
   "mbps": 230.50045915337122
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.00031799416614578684,
   "min": 0.0003094755484120587,
   "samples": 117,
   "batch": 67194
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.002125869894099873,
   "min": 0.0020936459909228437,
   "samples": 101,
   "batch": 11237,
   "mbps": 756.8666382009592
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.09387815126050356,
   "min": 0.090553781512602,
   "samples": 107,
   "batch": 238,
   "mbps": 547.2625878351199
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.5856146341463123,
   "min": 0.5720951219512399,
   "samples": 99,
   "batch": 41,
   "mbps": 915.3049953770104
  },
  "babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "babel-parser (513KB cjs)",
   "ms": 0.6269153846153644,
   "min": 0.6087025641025741,
   "samples": 99,
   "batch": 39,
   "mbps": 818.6336028663192
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 1.7516291666665893,
   "min": 1.713199999999991,
   "samples": 114,
   "batch": 12,
   "mbps": 541.2407021082993
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 1.231621052631645,
   "min": 1.1934473684211155,
   "samples": 104,
   "batch": 19,
   "mbps": 865.280759632103
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.7215469696970324,
   "min": 0.6854030303030881,
   "samples": 102,
   "batch": 33,
   "mbps": 918.5431133863522
  },
  "typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "typescript.js (9MB cjs)",
   "ms": 11.99499999999989,
   "min": 11.61239999999998,
   "samples": 102,
   "batch": 2,
   "mbps": 759.697540641941
  },
  "batch: 88 zod/v4 modules (570KB)": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules (570KB)",
   "ms": 1.1008909090909251,
   "min": 1.0397590909091046,
   "samples": 101,
   "batch": 22,
   "mbps": 530.2042147681966
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "fast",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 2.492335000000094,
   "min": 2.4268799999998008,
   "samples": 98,
   "batch": 10,
   "mbps": 642.0336752482872
  }
 }
}
```
