| case                                                  | acorn                 | meriyah                      |
|-------------------------------------------------------|-----------------------|------------------------------|
| parse zod-errors.js (1.6KB esm)                       | 124.4 µs (12.9 MB/s)  | 55.9 µs (28.8 MB/s)  x2.22   |
| parse zod-schemas.js (51KB esm)                       | 7.45 ms (6.9 MB/s)    | 2.66 ms (19.3 MB/s)  x2.80   |
| parse react-dom-client.prod (536KB cjs)               | 49.87 ms (10.7 MB/s)  | 21.83 ms (24.6 MB/s)  x2.28  |
| parse babel-parser (513KB cjs)                        | 61.77 ms (8.3 MB/s)   | 40.68 ms (12.6 MB/s)  x1.52  |
| parse rollup node-entry (948KB esm)                   | 106.16 ms (8.9 MB/s)  | 69.14 ms (13.7 MB/s)  x1.54  |
| parse react-dom-client.dev (1MB cjs)                  | 89.16 ms (12.0 MB/s)  | 38.08 ms (28.0 MB/s)  x2.34  |
| parse three.module (1.2MB esm)                        | 52.35 ms (12.7 MB/s)  | 25.25 ms (26.2 MB/s)  x2.07  |
| parse typescript.js (9MB cjs)                         | 918.77 ms (9.9 MB/s)  | 519.45 ms (17.5 MB/s)  x1.77 |
| parse+locations zod-errors.js (1.6KB esm)             | 162.7 µs (9.9 MB/s)   | 81.9 µs (19.6 MB/s)  x1.99   |
| parse+locations zod-schemas.js (51KB esm)             | 16.74 ms (3.1 MB/s)   | 3.01 ms (17.1 MB/s)  x5.57   |
| parse+locations react-dom-client.prod (536KB cjs)     | 105.96 ms (5.1 MB/s)  | 39.50 ms (13.6 MB/s)  x2.68  |
| parse+locations babel-parser (513KB cjs)              | 71.75 ms (7.2 MB/s)   | 55.37 ms (9.3 MB/s)  x1.30   |
| parse+locations rollup node-entry (948KB esm)         | 131.81 ms (7.2 MB/s)  | 152.53 ms (6.2 MB/s)  x0.86  |
| parse+locations react-dom-client.dev (1MB cjs)        | 103.58 ms (10.3 MB/s) | 119.69 ms (8.9 MB/s)  x0.87  |
| parse+locations three.module (1.2MB esm)              | 59.97 ms (11.1 MB/s)  | 55.82 ms (11.9 MB/s)  x1.07  |
| tokenize zod-schemas.js (51KB esm)                    | 2.75 ms (18.7 MB/s)   | -                            |
| tokenize react-dom-client.dev (1MB cjs)               | 34.11 ms (31.2 MB/s)  | -                            |
| parse script+allowAwaitOutsideFunction react-dom.prod | 45.93 ms (11.7 MB/s)  | 18.92 ms (28.3 MB/s)  x2.43  |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.12437256637168197,
   "min": 0.1170548672566355,
   "samples": 49,
   "batch": 113,
   "mbps": 12.936936552322754
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 7.450574999999958,
   "min": 6.6008999999999105,
   "samples": 52,
   "batch": 2,
   "mbps": 6.895575173728242
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 49.86789999999996,
   "min": 45.0300000000002,
   "samples": 16,
   "batch": 1,
   "mbps": 10.74871811325523
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 61.76980000000003,
   "min": 53.16859999999997,
   "samples": 13,
   "batch": 1,
   "mbps": 8.30849379470226
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 106.16325000000006,
   "min": 95.15559999999914,
   "samples": 10,
   "batch": 1,
   "mbps": 8.930142963784544
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 89.16139999999996,
   "min": 74.77999999999975,
   "samples": 10,
   "batch": 1,
   "mbps": 11.952459248060265
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 52.35460000000057,
   "min": 48.692699999999604,
   "samples": 15,
   "batch": 1,
   "mbps": 12.659288773097165
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 918.7676999999994,
   "min": 881.1530999999995,
   "samples": 4,
   "batch": 1,
   "mbps": 9.918254636073957
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.16267078651685807,
   "min": 0.15004382022469942,
   "samples": 52,
   "batch": 89,
   "mbps": 9.891142930161308
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 16.740749999999025,
   "min": 7.791999999999462,
   "samples": 23,
   "batch": 2,
   "mbps": 3.0689186565717184
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 105.95550000000003,
   "min": 61.8695000000007,
   "samples": 10,
   "batch": 1,
   "mbps": 5.058878491442161
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 71.7502999999997,
   "min": 62.96220000000176,
   "samples": 11,
   "batch": 1,
   "mbps": 7.15277845528175
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 131.8145000000004,
   "min": 122.85389999999825,
   "samples": 10,
   "batch": 1,
   "mbps": 7.19232709603266
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 103.58160000000134,
   "min": 89.69980000000214,
   "samples": 10,
   "batch": 1,
   "mbps": 10.288487530603758
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 59.96910000000207,
   "min": 53.981400000000576,
   "samples": 13,
   "batch": 1,
   "mbps": 11.051891724237601
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.748755555555464,
   "min": 2.7343999999999746,
   "samples": 33,
   "batch": 9,
   "mbps": 18.69063980467991
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 34.11209999999846,
   "min": 33.590799999998126,
   "samples": 23,
   "batch": 1,
   "mbps": 31.24105522673913
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 45.93379999999888,
   "min": 43.747199999997974,
   "samples": 17,
   "batch": 1,
   "mbps": 11.669315406084694
  }
 },
 "meriyah": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "meriyah",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.05594763636363641,
   "min": 0.05337127272727313,
   "samples": 50,
   "batch": 275,
   "mbps": 28.759034421796983
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "meriyah",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.6567142857142505,
   "min": 2.2700142857142964,
   "samples": 41,
   "batch": 7,
   "mbps": 19.33817282357395
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "meriyah",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 21.825800000000072,
   "min": 17.679200000000037,
   "samples": 33,
   "batch": 1,
   "mbps": 24.558824876980374
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "meriyah",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 40.68070000000034,
   "min": 24.995699999999943,
   "samples": 21,
   "batch": 1,
   "mbps": 12.615662955652082
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "meriyah",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 69.14030000000002,
   "min": 47.4409999999998,
   "samples": 11,
   "batch": 1,
   "mbps": 13.712017448579187
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "meriyah",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 38.07979999999998,
   "min": 29.474999999999454,
   "samples": 22,
   "batch": 1,
   "mbps": 27.985913791564048
  },
  "parse three.module (1.2MB esm)": {
   "impl": "meriyah",
   "name": "parse three.module (1.2MB esm)",
   "ms": 25.24929999999995,
   "min": 22.04069999999956,
   "samples": 28,
   "batch": 1,
   "mbps": 26.249123738083885
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "meriyah",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 519.4549500000003,
   "min": 469.5650999999998,
   "samples": 6,
   "batch": 1,
   "mbps": 17.54256456695618
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.08191990950225816,
   "min": 0.06593031674207739,
   "samples": 40,
   "batch": 221,
   "mbps": 19.64113497898392
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 3.0070000000002133,
   "min": 2.7033833333331736,
   "samples": 43,
   "batch": 6,
   "mbps": 17.085467243098222
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 39.49620000000141,
   "min": 21.100900000001275,
   "samples": 23,
   "batch": 1,
   "mbps": 13.571330912846829
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 55.36510000000271,
   "min": 29.968700000001263,
   "samples": 15,
   "batch": 1,
   "mbps": 9.26963014606629
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 152.52860000000146,
   "min": 127.65650000000096,
   "samples": 10,
   "batch": 1,
   "mbps": 6.215575308499462
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 119.69415000000117,
   "min": 64.1890999999996,
   "samples": 10,
   "batch": 1,
   "mbps": 8.90350948647022
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "meriyah",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 55.82340000000113,
   "min": 27.09140000000116,
   "samples": 14,
   "batch": 1,
   "mbps": 11.872655553047407
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "meriyah",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 18.919350000000122,
   "min": 17.167300000000978,
   "samples": 38,
   "batch": 1,
   "mbps": 28.33162872931663
  }
 }
}
```
