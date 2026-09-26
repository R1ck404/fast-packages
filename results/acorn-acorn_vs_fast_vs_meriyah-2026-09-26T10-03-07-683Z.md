| case                                                  | acorn                | fast                         | meriyah                      |
|-------------------------------------------------------|----------------------|------------------------------|------------------------------|
| parse zod-errors.js (1.6KB esm)                       | 120.7 µs (13.3 MB/s) | 65.5 µs (24.6 MB/s)  x1.84   | 56.3 µs (28.6 MB/s)  x2.14   |
| parse zod-schemas.js (51KB esm)                       | 6.74 ms (7.6 MB/s)   | 3.37 ms (15.3 MB/s)  x2.00   | 2.35 ms (21.9 MB/s)  x2.87   |
| parse react-dom-client.prod (536KB cjs)               | 48.88 ms (11.0 MB/s) | 23.43 ms (22.9 MB/s)  x2.09  | 17.90 ms (30.0 MB/s)  x2.73  |
| parse babel-parser (513KB cjs)                        | 54.96 ms (9.3 MB/s)  | 26.10 ms (19.7 MB/s)  x2.11  | 29.39 ms (17.5 MB/s)  x1.87  |
| parse rollup node-entry (948KB esm)                   | 106.40 ms (8.9 MB/s) | 56.75 ms (16.7 MB/s)  x1.87  | 62.76 ms (15.1 MB/s)  x1.70  |
| parse react-dom-client.dev (1MB cjs)                  | 79.44 ms (13.4 MB/s) | 41.58 ms (25.6 MB/s)  x1.91  | 41.32 ms (25.8 MB/s)  x1.92  |
| parse three.module (1.2MB esm)                        | 49.89 ms (13.3 MB/s) | 21.11 ms (31.4 MB/s)  x2.36  | 44.15 ms (15.0 MB/s)  x1.13  |
| parse typescript.js (9MB cjs)                         | 1.11 s (8.2 MB/s)    | 412.61 ms (22.1 MB/s)  x2.70 | 464.09 ms (19.6 MB/s)  x2.40 |
| parse+locations zod-errors.js (1.6KB esm)             | 159.5 µs (10.1 MB/s) | 91.3 µs (17.6 MB/s)  x1.75   | 70.4 µs (22.9 MB/s)  x2.27   |
| parse+locations zod-schemas.js (51KB esm)             | 7.96 ms (6.5 MB/s)   | 4.18 ms (12.3 MB/s)  x1.91   | 2.80 ms (18.3 MB/s)  x2.84   |
| parse+locations react-dom-client.prod (536KB cjs)     | 56.81 ms (9.4 MB/s)  | 38.01 ms (14.1 MB/s)  x1.49  | 33.42 ms (16.0 MB/s)  x1.70  |
| parse+locations babel-parser (513KB cjs)              | 71.63 ms (7.2 MB/s)  | 37.81 ms (13.6 MB/s)  x1.89  | 47.08 ms (10.9 MB/s)  x1.52  |
| parse+locations rollup node-entry (948KB esm)         | 122.69 ms (7.7 MB/s) | 72.45 ms (13.1 MB/s)  x1.69  | 84.53 ms (11.2 MB/s)  x1.45  |
| parse+locations react-dom-client.dev (1MB cjs)        | 90.67 ms (11.8 MB/s) | 59.73 ms (17.8 MB/s)  x1.52  | 56.48 ms (18.9 MB/s)  x1.61  |
| parse+locations three.module (1.2MB esm)              | 55.78 ms (11.9 MB/s) | 33.25 ms (19.9 MB/s)  x1.68  | 39.49 ms (16.8 MB/s)  x1.41  |
| tokenize zod-schemas.js (51KB esm)                    | 2.87 ms (17.9 MB/s)  | 2.61 ms (19.7 MB/s)  x1.10   | -                            |
| tokenize react-dom-client.dev (1MB cjs)               | 35.72 ms (29.8 MB/s) | 34.50 ms (30.9 MB/s)  x1.04  | -                            |
| parse script+allowAwaitOutsideFunction react-dom.prod | 53.38 ms (10.0 MB/s) | 21.48 ms (24.9 MB/s)  x2.48  | 20.15 ms (26.6 MB/s)  x2.65  |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.12069629629629659,
   "min": 0.11517716049382687,
   "samples": 41,
   "batch": 162,
   "mbps": 13.330980729102704
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 6.737099999999979,
   "min": 6.258166666666663,
   "samples": 38,
   "batch": 3,
   "mbps": 7.625833073577675
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 48.87609999999995,
   "min": 43.579699999999775,
   "samples": 17,
   "batch": 1,
   "mbps": 10.966832460036716
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 54.96479999999974,
   "min": 53.59299999999985,
   "samples": 15,
   "batch": 1,
   "mbps": 9.337139405583253
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 106.40454999999974,
   "min": 94.32880000000023,
   "samples": 10,
   "batch": 1,
   "mbps": 8.909891541292193
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 79.4355999999998,
   "min": 72.72010000000046,
   "samples": 11,
   "batch": 1,
   "mbps": 13.415873991006585
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 49.89384999999993,
   "min": 48.20980000000054,
   "samples": 16,
   "batch": 1,
   "mbps": 13.283641170204364
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 1113.2060000000001,
   "min": 881.4228000000003,
   "samples": 3,
   "batch": 1,
   "mbps": 8.18588113969921
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.15953235294116394,
   "min": 0.1470362745098029,
   "samples": 49,
   "batch": 102,
   "mbps": 10.085728507956029
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 7.960849999999482,
   "min": 7.504049999999552,
   "samples": 50,
   "batch": 2,
   "mbps": 6.453582217979656
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 56.81145000000106,
   "min": 51.6105000000025,
   "samples": 14,
   "batch": 1,
   "mbps": 9.434999458735696
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 71.63335000000006,
   "min": 64.49759999999878,
   "samples": 12,
   "batch": 1,
   "mbps": 7.164456220461552
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 122.6877000000004,
   "min": 112.30650000000242,
   "samples": 10,
   "batch": 1,
   "mbps": 7.727367943159721
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 90.67400000000089,
   "min": 79.69780000000173,
   "samples": 10,
   "batch": 1,
   "mbps": 11.753071442750839
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 55.7767500000009,
   "min": 52.49120000000039,
   "samples": 14,
   "batch": 1,
   "mbps": 11.882585485887745
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.8744500000002517,
   "min": 2.854137499999979,
   "samples": 35,
   "batch": 8,
   "mbps": 17.873332289653845
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 35.71889999999985,
   "min": 34.971300000001065,
   "samples": 21,
   "batch": 1,
   "mbps": 29.83568922895175
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 53.377150000000256,
   "min": 44.89610000000175,
   "samples": 12,
   "batch": 1,
   "mbps": 10.042049828437777
  }
 },
 "fast": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.06546355932203377,
   "min": 0.0630325423728814,
   "samples": 42,
   "batch": 295,
   "mbps": 24.578559685165818
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 3.3687300000000278,
   "min": 2.900420000000031,
   "samples": 44,
   "batch": 5,
   "mbps": 15.250851210990366
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 23.429750000000013,
   "min": 20.577499999999873,
   "samples": 34,
   "batch": 1,
   "mbps": 22.87758085340218
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 26.101900000000114,
   "min": 23.29780000000028,
   "samples": 30,
   "batch": 1,
   "mbps": 19.661940318520784
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 56.7497000000003,
   "min": 44.400800000000345,
   "samples": 15,
   "batch": 1,
   "mbps": 16.705868048641577
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 41.577400000000125,
   "min": 34.79179999999997,
   "samples": 19,
   "batch": 1,
   "mbps": 25.63166527969514
  },
  "parse three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse three.module (1.2MB esm)",
   "ms": 21.10570000000007,
   "min": 20.14390000000003,
   "samples": 36,
   "batch": 1,
   "mbps": 31.40251211757951
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 412.60779999999977,
   "min": 385.91129999999976,
   "samples": 8,
   "batch": 1,
   "mbps": 22.08531200815885
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.09132362204723818,
   "min": 0.0856803149606316,
   "samples": 66,
   "batch": 127,
   "mbps": 17.618661677344846
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 4.176750000000084,
   "min": 3.756199999999808,
   "samples": 47,
   "batch": 4,
   "mbps": 12.300472855688984
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 38.00770000000193,
   "min": 25.96549999999843,
   "samples": 21,
   "batch": 1,
   "mbps": 14.102826532517694
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 37.80799999999908,
   "min": 29.765299999999115,
   "samples": 22,
   "batch": 1,
   "mbps": 13.574217096911033
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 72.44599999999991,
   "min": 53.297600000001694,
   "samples": 11,
   "batch": 1,
   "mbps": 13.08634017060985
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 59.729599999998754,
   "min": 44.08900000000358,
   "samples": 13,
   "batch": 1,
   "mbps": 17.842041466877767
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 33.251649999998335,
   "min": 24.73880000000281,
   "samples": 26,
   "batch": 1,
   "mbps": 19.932003374269645
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.6127666666666807,
   "min": 2.5894555555557113,
   "samples": 34,
   "batch": 9,
   "mbps": 19.66344743120309
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 34.49689999999828,
   "min": 34.15559999999823,
   "samples": 24,
   "batch": 1,
   "mbps": 30.892572955832357
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "fast",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 21.484400000001187,
   "min": 20.44000000000233,
   "samples": 37,
   "batch": 1,
   "mbps": 24.949079331979036
  }
 },
 "meriyah": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "meriyah",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.05629062500000001,
   "min": 0.053571875000000026,
   "samples": 41,
   "batch": 352,
   "mbps": 28.583800588463884
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "meriyah",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.3497071428571745,
   "min": 2.1638285714285694,
   "samples": 48,
   "batch": 7,
   "mbps": 21.864852458816763
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "meriyah",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 17.896499999999833,
   "min": 17.009900000000016,
   "samples": 40,
   "batch": 1,
   "mbps": 29.950884251110836
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "meriyah",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 29.388850000000275,
   "min": 22.99539999999979,
   "samples": 26,
   "batch": 1,
   "mbps": 17.462881330844695
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "meriyah",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 62.763199999999415,
   "min": 47.07369999999992,
   "samples": 13,
   "batch": 1,
   "mbps": 15.105236826675647
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "meriyah",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 41.319800000000214,
   "min": 30.98199999999997,
   "samples": 21,
   "batch": 1,
   "mbps": 25.791460752472048
  },
  "parse three.module (1.2MB esm)": {
   "impl": "meriyah",
   "name": "parse three.module (1.2MB esm)",
   "ms": 44.15450000000055,
   "min": 27.024900000000343,
   "samples": 19,
   "batch": 1,
   "mbps": 15.01029340157836
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "meriyah",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 464.08669999999984,
   "min": 446.6683000000012,
   "samples": 7,
   "batch": 1,
   "mbps": 19.63549483318527
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.07036545454544797,
   "min": 0.06676409090908816,
   "samples": 51,
   "batch": 220,
   "mbps": 22.8663342032527
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 2.8028214285714057,
   "min": 2.664714285714321,
   "samples": 40,
   "batch": 7,
   "mbps": 18.33010104613988
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 33.42290000000139,
   "min": 20.131600000000617,
   "samples": 25,
   "batch": 1,
   "mbps": 16.03738753968021
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 47.08175000000119,
   "min": 28.175100000000384,
   "samples": 18,
   "batch": 1,
   "mbps": 10.90048691902886
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "meriyah",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 84.52650000000176,
   "min": 77.52370000000155,
   "samples": 10,
   "batch": 1,
   "mbps": 11.216044672380617
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "meriyah",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 56.47834999999941,
   "min": 37.22440000000279,
   "samples": 14,
   "batch": 1,
   "mbps": 18.869141892424462
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "meriyah",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 39.48524999999972,
   "min": 26.511900000001333,
   "samples": 20,
   "batch": 1,
   "mbps": 16.785305905369846
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "meriyah",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 20.147249999999985,
   "min": 17.14244999999937,
   "samples": 21,
   "batch": 2,
   "mbps": 26.60492126717048
  }
 }
}
```
