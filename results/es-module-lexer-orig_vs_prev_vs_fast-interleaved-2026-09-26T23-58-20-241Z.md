| case                                                | orig     | prev            | fast             |
|-----------------------------------------------------|----------|-----------------|------------------|
| tiny module (70B)                                   | 0.5 us   | 0.3 us  x1.74   | 0.2 us  x3.00    |
| zod-errors.js (1.6KB esm)                           | 4.7 us   | 2.1 us  x2.26   | 0.7 us  x6.46    |
| zod-schemas.js (51KB esm) [utf16]                   | 153.7 us | 92.6 us  x1.66  | 26.0 us  x5.90   |
| react-dom-client.prod (536KB cjs)                   | 2.13 ms  | 579.6 us  x3.68 | 115.8 us  x18.40 |
| babel-parser (513KB cjs)                            | 2.00 ms  | 616.5 us  x3.24 | 163.6 us  x12.22 |
| rollup node-entry (948KB esm) [utf16]               | 3.60 ms  | 1.72 ms  x2.09  | 570.2 us  x6.31  |
| react-dom-client.dev (1MB cjs)                      | 3.79 ms  | 1.21 ms  x3.14  | 348.7 us  x10.88 |
| three.module (1.2MB esm)                            | 2.15 ms  | 714.9 us  x3.01 | 192.5 us  x11.16 |
| typescript.js (9MB cjs)                             | 35.16 ms | 11.63 ms  x3.02 | 4.73 ms  x7.44   |
| batch: 88 zod/v4 modules (570KB, 50 non-ASCII)      | 1.98 ms  | 1.10 ms  x1.80  | 328.7 us  x6.03  |
| batch: 34 @vue files (1562KB)                       | 6.92 ms  | 2.43 ms  x2.85  | 1.06 ms  x6.50   |
| batch: 644 lodash-es modules (616KB, 2 non-ASCII)   | 2.51 ms  | 940.4 us  x2.67 | 329.3 us  x7.64  |
| batch: 753 three/src modules (4527KB, 23 non-ASCII) | 15.52 ms | 6.00 ms  x2.58  | 2.21 ms  x7.03   |
| batch: 210 zod files (1577KB, 102 non-ASCII)        | 5.36 ms  | 2.91 ms  x1.84  | 1.05 ms  x5.09   |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.0005451374523340739,
   "min": 0.000541452533459617,
   "samples": 114,
   "batch": 40123
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004739129586260745,
   "min": 0.004571233411397302,
   "samples": 101,
   "batch": 5124,
   "mbps": 339.5138222564471
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.15368675496689163,
   "min": 0.15049602649006127,
   "samples": 107,
   "batch": 151,
   "mbps": 334.29035580241
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.1304500000000344,
   "min": 2.0641166666666018,
   "samples": 98,
   "batch": 12,
   "mbps": 251.59754981341564
  },
  "babel-parser (513KB cjs)": {
   "impl": "orig",
   "name": "babel-parser (513KB cjs)",
   "ms": 1.9995384615384375,
   "min": 1.9559846153847151,
   "samples": 96,
   "batch": 13,
   "mbps": 256.6662306686189
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 3.6010428571428617,
   "min": 3.5668714285714356,
   "samples": 99,
   "batch": 7,
   "mbps": 263.27179031471013
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 3.7947142857140403,
   "min": 3.6162857142854983,
   "samples": 95,
   "batch": 7,
   "mbps": 280.8374807062637
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.1485583333333125,
   "min": 2.1134583333332557,
   "samples": 97,
   "batch": 12,
   "mbps": 308.4728907368149
  },
  "typescript.js (9MB cjs)": {
   "impl": "orig",
   "name": "typescript.js (9MB cjs)",
   "ms": 35.162100000001374,
   "min": 34.531699999999546,
   "samples": 71,
   "batch": 1,
   "mbps": 259.15892395504375
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 1.9823538461538333,
   "min": 1.8835999999999051,
   "samples": 97,
   "batch": 13,
   "mbps": 294.4464234437712
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "orig",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 6.921262500000012,
   "min": 6.799449999999524,
   "samples": 90,
   "batch": 4,
   "mbps": 231.19524797679574
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 2.514800000000105,
   "min": 2.451469999999972,
   "samples": 99,
   "batch": 10,
   "mbps": 251.15158263081503
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 15.51560000000245,
   "min": 15.072350000002189,
   "samples": 81,
   "batch": 2,
   "mbps": 298.83033849798056
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 5.355019999999786,
   "min": 5.103680000000168,
   "samples": 94,
   "batch": 5,
   "mbps": 301.5589110778418
  }
 },
 "prev": {
  "tiny module (70B)": {
   "impl": "prev",
   "name": "tiny module (70B)",
   "ms": 0.0003141701492537295,
   "min": 0.0002980597014925377,
   "samples": 119,
   "batch": 67000
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0021014080834419408,
   "min": 0.0020848500651890725,
   "samples": 102,
   "batch": 11505,
   "mbps": 765.6770775167976
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "prev",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.0925725868725879,
   "min": 0.09183127413127161,
   "samples": 102,
   "batch": 259,
   "mbps": 554.9807101179019
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.5796441860465229,
   "min": 0.5661325581395219,
   "samples": 100,
   "batch": 43,
   "mbps": 924.7328152394834
  },
  "babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "babel-parser (513KB cjs)",
   "ms": 0.616549999999997,
   "min": 0.6037657894736951,
   "samples": 106,
   "batch": 38,
   "mbps": 832.3963993187939
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "prev",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 1.72458000000006,
   "min": 1.7014933333333222,
   "samples": 94,
   "batch": 15,
   "mbps": 549.729789282009
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 1.208530952380984,
   "min": 1.1848142857143968,
   "samples": 98,
   "batch": 21,
   "mbps": 881.8127478658432
  },
  "three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "three.module (1.2MB esm)",
   "ms": 0.7148808823529929,
   "min": 0.6858970588235773,
   "samples": 102,
   "batch": 34,
   "mbps": 927.1083006423684
  },
  "typescript.js (9MB cjs)": {
   "impl": "prev",
   "name": "typescript.js (9MB cjs)",
   "ms": 11.629899999999907,
   "min": 11.560300000001007,
   "samples": 72,
   "batch": 3,
   "mbps": 783.5468920627068
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 1.0996652173913468,
   "min": 1.0800826086956279,
   "samples": 98,
   "batch": 23,
   "mbps": 530.7951827235753
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "prev",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 2.4301727272726237,
   "min": 2.4035090909092105,
   "samples": 94,
   "batch": 11,
   "mbps": 658.4564883154864
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 0.9403925925926834,
   "min": 0.8888074074074447,
   "samples": 99,
   "batch": 27,
   "mbps": 671.6301308357564
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 6.00251999999964,
   "min": 5.888860000000568,
   "samples": 84,
   "batch": 5,
   "mbps": 772.4309123501926
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 2.9117000000001605,
   "min": 2.8736666666672033,
   "samples": 95,
   "batch": 9,
   "mbps": 554.6086478689119
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.00018179119735151452,
   "min": 0.00017666819848631164,
   "samples": 128,
   "batch": 106627
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0007331103163347274,
   "min": 0.0007196583831781541,
   "samples": 105,
   "batch": 32434,
   "mbps": 2194.7583660319874
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.026044395604395296,
   "min": 0.02578076923076938,
   "samples": 105,
   "batch": 910,
   "mbps": 1972.6316855411956
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.11579672897196615,
   "min": 0.11443271028037658,
   "samples": 99,
   "batch": 214,
   "mbps": 4628.939044813322
  },
  "babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "babel-parser (513KB cjs)",
   "ms": 0.16362222222222259,
   "min": 0.16080392156863382,
   "samples": 99,
   "batch": 153,
   "mbps": 3136.5788401466716
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.5702395348837028,
   "min": 0.5431581395349112,
   "samples": 100,
   "batch": 43,
   "mbps": 1662.5522118408542
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.3487323943662259,
   "min": 0.31678873239434324,
   "samples": 101,
   "batch": 71,
   "mbps": 3055.919143780039
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.19253720930234783,
   "min": 0.1896775193798571,
   "samples": 101,
   "batch": 129,
   "mbps": 3442.3060477584168
  },
  "typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "typescript.js (9MB cjs)",
   "ms": 4.725333333333159,
   "min": 4.679000000000087,
   "samples": 88,
   "batch": 6,
   "mbps": 1928.4506207675652
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 0.32869383561642096,
   "min": 0.3125698630137278,
   "samples": 102,
   "batch": 73,
   "mbps": 1775.807565436556
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "fast",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 1.0640791666666398,
   "min": 1.0557916666666642,
   "samples": 98,
   "batch": 24,
   "mbps": 1503.8007040516632
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 0.32932105263152106,
   "min": 0.31538684210528645,
   "samples": 99,
   "batch": 76,
   "mbps": 1917.873136117708
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 2.2074666666667326,
   "min": 2.1912333333336087,
   "samples": 94,
   "batch": 12,
   "mbps": 2100.3859627928823
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 1.0513999999999821,
   "min": 1.042637500000031,
   "samples": 99,
   "batch": 24,
   "mbps": 1535.9083127259155
  }
 }
}
```
