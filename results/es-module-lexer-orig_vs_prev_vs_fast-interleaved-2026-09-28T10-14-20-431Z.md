| case                                                | orig     | prev             | fast             |
|-----------------------------------------------------|----------|------------------|------------------|
| tiny module (70B)                                   | 0.5 us   | 0.2 us  x3.16    | 0.2 us  x3.17    |
| zod-errors.js (1.6KB esm)                           | 4.6 us   | 0.7 us  x6.72    | 0.7 us  x6.62    |
| zod-schemas.js (51KB esm) [utf16]                   | 153.6 us | 24.4 us  x6.30   | 25.5 us  x6.03   |
| react-dom-client.prod (536KB cjs)                   | 2.11 ms  | 113.5 us  x18.63 | 117.0 us  x18.06 |
| babel-parser (513KB cjs)                            | 1.98 ms  | 157.6 us  x12.57 | 163.2 us  x12.14 |
| rollup node-entry (948KB esm) [utf16]               | 3.54 ms  | 540.9 us  x6.54  | 582.6 us  x6.08  |
| react-dom-client.dev (1MB cjs)                      | 3.65 ms  | 323.2 us  x11.29 | 326.9 us  x11.17 |
| three.module (1.2MB esm)                            | 2.15 ms  | 182.3 us  x11.81 | 188.1 us  x11.44 |
| typescript.js (9MB cjs)                             | 34.56 ms | 4.60 ms  x7.52   | 4.70 ms  x7.36   |
| batch: 88 zod/v4 modules (570KB, 50 non-ASCII)      | 1.96 ms  | 302.7 us  x6.47  | 311.9 us  x6.28  |
| batch: 34 @vue files (1562KB)                       | 6.83 ms  | 1.02 ms  x6.71   | 1.05 ms  x6.50   |
| batch: 644 lodash-es modules (616KB, 2 non-ASCII)   | 2.51 ms  | 302.8 us  x8.28  | 317.0 us  x7.91  |
| batch: 753 three/src modules (4527KB, 23 non-ASCII) | 15.64 ms | 2.11 ms  x7.40   | 2.16 ms  x7.23   |
| batch: 210 zod files (1577KB, 102 non-ASCII)        | 5.35 ms  | 996.1 us  x5.37  | 1.04 ms  x5.14   |

```json
{
 "orig": {
  "tiny module (70B)": {
   "impl": "orig",
   "name": "tiny module (70B)",
   "ms": 0.0005407449799696427,
   "min": 0.0005346015078752861,
   "samples": 115,
   "batch": 40189
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "orig",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.004585668123930888,
   "min": 0.004393613381486464,
   "samples": 103,
   "batch": 5261,
   "mbps": 350.8758062109271
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "orig",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.1536398734177205,
   "min": 0.14993797468354433,
   "samples": 103,
   "batch": 158,
   "mbps": 334.3923608965587
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 2.1139083333332565,
   "min": 2.049100000000029,
   "samples": 99,
   "batch": 12,
   "mbps": 253.56634038846823
  },
  "babel-parser (513KB cjs)": {
   "impl": "orig",
   "name": "babel-parser (513KB cjs)",
   "ms": 1.9815423076922973,
   "min": 1.9309692307692434,
   "samples": 96,
   "batch": 13,
   "mbps": 258.997245735161
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "orig",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 3.540085714285721,
   "min": 3.5118571428574796,
   "samples": 100,
   "batch": 7,
   "mbps": 267.8050975359752
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "orig",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 3.6504642857138867,
   "min": 3.535671428571472,
   "samples": 98,
   "batch": 7,
   "mbps": 291.9349202156601
  },
  "three.module (1.2MB esm)": {
   "impl": "orig",
   "name": "three.module (1.2MB esm)",
   "ms": 2.1519333333335453,
   "min": 2.1141000000000836,
   "samples": 97,
   "batch": 12,
   "mbps": 307.98909507726455
  },
  "typescript.js (9MB cjs)": {
   "impl": "orig",
   "name": "typescript.js (9MB cjs)",
   "ms": 34.556250000001455,
   "min": 34.082000000002154,
   "samples": 72,
   "batch": 1,
   "mbps": 263.70257189364054
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 1.9596153846154127,
   "min": 1.8621384615384717,
   "samples": 98,
   "batch": 13,
   "mbps": 297.86304219822927
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "orig",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 6.825287499999831,
   "min": 6.665774999999485,
   "samples": 92,
   "batch": 4,
   "mbps": 234.44624127555647
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 2.506780000000072,
   "min": 2.422620000000097,
   "samples": 100,
   "batch": 10,
   "mbps": 251.9550977748274
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 15.635924999998679,
   "min": 15.13720000000103,
   "samples": 80,
   "batch": 2,
   "mbps": 296.5307137249885
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "orig",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 5.352170000000479,
   "min": 5.072440000000642,
   "samples": 94,
   "batch": 5,
   "mbps": 301.71948947807255
  }
 },
 "prev": {
  "tiny module (70B)": {
   "impl": "prev",
   "name": "tiny module (70B)",
   "ms": 0.0001710866339972121,
   "min": 0.00016879647529559848,
   "samples": 131,
   "batch": 111215
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0006822696694939989,
   "min": 0.0006700467973091386,
   "samples": 107,
   "batch": 34190,
   "mbps": 2358.3050396968474
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "prev",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.024387250996016113,
   "min": 0.024041434262948226,
   "samples": 101,
   "batch": 1004,
   "mbps": 2106.674508266338
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.11348551401869517,
   "min": 0.11248084112148972,
   "samples": 102,
   "batch": 214,
   "mbps": 4723.210751917631
  },
  "babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "babel-parser (513KB cjs)",
   "ms": 0.15760454545454503,
   "min": 0.1564350649350672,
   "samples": 101,
   "batch": 154,
   "mbps": 3256.3400917140225
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "prev",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.5409467391304252,
   "min": 0.5258086956521014,
   "samples": 100,
   "batch": 46,
   "mbps": 1752.5810424959773
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.3232113333333352,
   "min": 0.23103333333332557,
   "samples": 104,
   "batch": 75,
   "mbps": 3297.2173005484356
  },
  "three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "three.module (1.2MB esm)",
   "ms": 0.18227574626866072,
   "min": 0.1807880597015043,
   "samples": 102,
   "batch": 134,
   "mbps": 3636.0953860703116
  },
  "typescript.js (9MB cjs)": {
   "impl": "prev",
   "name": "typescript.js (9MB cjs)",
   "ms": 4.595033333333049,
   "min": 4.566416666666555,
   "samples": 91,
   "batch": 6,
   "mbps": 1983.1351241559141
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 0.3027456790123436,
   "min": 0.29000617283950475,
   "samples": 102,
   "batch": 81,
   "mbps": 1928.01100218577
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "prev",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 1.0165499999999157,
   "min": 1.004820000000036,
   "samples": 98,
   "batch": 25,
   "mbps": 1574.111455413047
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 0.3027548780487339,
   "min": 0.2873378048780734,
   "samples": 101,
   "batch": 82,
   "mbps": 2086.1629185652073
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 2.1120833333334303,
   "min": 2.091291666666924,
   "samples": 99,
   "batch": 12,
   "mbps": 2195.2410337343636
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "prev",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 0.9960679999997956,
   "min": 0.9858079999999609,
   "samples": 101,
   "batch": 25,
   "mbps": 1621.2286711352351
  }
 },
 "fast": {
  "tiny module (70B)": {
   "impl": "fast",
   "name": "tiny module (70B)",
   "ms": 0.00017065891837765189,
   "min": 0.0001681470006761208,
   "samples": 125,
   "batch": 116843
  },
  "zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "zod-errors.js (1.6KB esm)",
   "ms": 0.0006922377438060101,
   "min": 0.0006793504363615025,
   "samples": 106,
   "batch": 34146,
   "mbps": 2324.345955413404
  },
  "zod-schemas.js (51KB esm) [utf16]": {
   "impl": "fast",
   "name": "zod-schemas.js (51KB esm) [utf16]",
   "ms": 0.02548381893860529,
   "min": 0.025281997918834835,
   "samples": 102,
   "batch": 961,
   "mbps": 2016.0243691800365
  },
  "react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.prod (536KB cjs)",
   "ms": 0.11704386792453164,
   "min": 0.11576839622640828,
   "samples": 100,
   "batch": 212,
   "mbps": 4579.616254186133
  },
  "babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "babel-parser (513KB cjs)",
   "ms": 0.16317483443708625,
   "min": 0.1618655629139033,
   "samples": 101,
   "batch": 151,
   "mbps": 3145.1786163624083
  },
  "rollup node-entry (948KB esm) [utf16]": {
   "impl": "fast",
   "name": "rollup node-entry (948KB esm) [utf16]",
   "ms": 0.582557142857132,
   "min": 0.5673880952381296,
   "samples": 101,
   "batch": 42,
   "mbps": 1627.3991515240991
  },
  "react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "react-dom-client.dev (1MB cjs)",
   "ms": 0.32685499999994744,
   "min": 0.23092833333333448,
   "samples": 131,
   "batch": 60,
   "mbps": 3260.4610607155205
  },
  "three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "three.module (1.2MB esm)",
   "ms": 0.18813219696968383,
   "min": 0.1857742424242381,
   "samples": 100,
   "batch": 132,
   "mbps": 3522.9057581611137
  },
  "typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "typescript.js (9MB cjs)",
   "ms": 4.695983333333061,
   "min": 4.657333333333251,
   "samples": 89,
   "batch": 6,
   "mbps": 1940.5034799244452
  },
  "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 88 zod/v4 modules (570KB, 50 non-ASCII)",
   "ms": 0.31186883116883013,
   "min": 0.3055103896103547,
   "samples": 104,
   "batch": 77,
   "mbps": 1871.610567213162
  },
  "batch: 34 @vue files (1562KB)": {
   "impl": "fast",
   "name": "batch: 34 @vue files (1562KB)",
   "ms": 1.0505583333333561,
   "min": 1.0438999999999699,
   "samples": 99,
   "batch": 24,
   "mbps": 1523.1548303679458
  },
  "batch: 644 lodash-es modules (616KB, 2 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 644 lodash-es modules (616KB, 2 non-ASCII)",
   "ms": 0.31703846153845333,
   "min": 0.30261794871796904,
   "samples": 101,
   "batch": 78,
   "mbps": 1992.1746936795373
  },
  "batch: 753 three/src modules (4527KB, 23 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 753 three/src modules (4527KB, 23 non-ASCII)",
   "ms": 2.1621875000000728,
   "min": 2.1422333333333277,
   "samples": 96,
   "batch": 12,
   "mbps": 2144.370920653201
  },
  "batch: 210 zod files (1577KB, 102 non-ASCII)": {
   "impl": "fast",
   "name": "batch: 210 zod files (1577KB, 102 non-ASCII)",
   "ms": 1.042024999999891,
   "min": 1.0325374999999137,
   "samples": 100,
   "batch": 24,
   "mbps": 1549.726734003665
  }
 }
}
```
