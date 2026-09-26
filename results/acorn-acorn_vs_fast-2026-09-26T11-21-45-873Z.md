| case                                                  | acorn                 | fast                         |
|-------------------------------------------------------|-----------------------|------------------------------|
| parse zod-errors.js (1.6KB esm)                       | 121.3 µs (13.3 MB/s)  | 55.1 µs (29.2 MB/s)  x2.20   |
| parse zod-schemas.js (51KB esm)                       | 6.90 ms (7.4 MB/s)    | 2.22 ms (23.2 MB/s)  x3.11   |
| parse react-dom-client.prod (536KB cjs)               | 47.06 ms (11.4 MB/s)  | 15.85 ms (33.8 MB/s)  x2.97  |
| parse babel-parser (513KB cjs)                        | 58.69 ms (8.7 MB/s)   | 17.49 ms (29.3 MB/s)  x3.36  |
| parse rollup node-entry (948KB esm)                   | 103.16 ms (9.2 MB/s)  | 33.91 ms (28.0 MB/s)  x3.04  |
| parse react-dom-client.dev (1MB cjs)                  | 75.06 ms (14.2 MB/s)  | 27.21 ms (39.2 MB/s)  x2.76  |
| parse three.module (1.2MB esm)                        | 46.65 ms (14.2 MB/s)  | 17.02 ms (38.9 MB/s)  x2.74  |
| parse typescript.js (9MB cjs)                         | 883.53 ms (10.3 MB/s) | 337.02 ms (27.0 MB/s)  x2.62 |
| parse+locations zod-errors.js (1.6KB esm)             | 153.6 µs (10.5 MB/s)  | 84.8 µs (19.0 MB/s)  x1.81   |
| parse+locations zod-schemas.js (51KB esm)             | 13.48 ms (3.8 MB/s)   | 3.33 ms (15.4 MB/s)  x4.05   |
| parse+locations react-dom-client.prod (536KB cjs)     | 80.72 ms (6.6 MB/s)   | 27.36 ms (19.6 MB/s)  x2.95  |
| parse+locations babel-parser (513KB cjs)              | 154.85 ms (3.3 MB/s)  | 35.87 ms (14.3 MB/s)  x4.32  |
| parse+locations rollup node-entry (948KB esm)         | 165.08 ms (5.7 MB/s)  | 67.02 ms (14.1 MB/s)  x2.46  |
| parse+locations react-dom-client.dev (1MB cjs)        | 99.78 ms (10.7 MB/s)  | 53.63 ms (19.9 MB/s)  x1.86  |
| parse+locations three.module (1.2MB esm)              | 56.48 ms (11.7 MB/s)  | 24.06 ms (27.5 MB/s)  x2.35  |
| tokenize zod-schemas.js (51KB esm)                    | 2.89 ms (17.8 MB/s)   | 2.88 ms (17.8 MB/s)  x1.00   |
| tokenize react-dom-client.dev (1MB cjs)               | 34.63 ms (30.8 MB/s)  | 35.29 ms (30.2 MB/s)  x0.98  |
| parse script+allowAwaitOutsideFunction react-dom.prod | 45.92 ms (11.7 MB/s)  | 17.48 ms (30.7 MB/s)  x2.63  |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.1213405063291144,
   "min": 0.11823164556962114,
   "samples": 77,
   "batch": 158,
   "mbps": 13.260205092896806
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 6.902049999999917,
   "min": 6.267749999999978,
   "samples": 106,
   "batch": 2,
   "mbps": 7.4435856013793895
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 47.05625000000009,
   "min": 43.873099999999795,
   "samples": 32,
   "batch": 1,
   "mbps": 11.39096294328594
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 58.69385000000011,
   "min": 53.25759999999991,
   "samples": 26,
   "batch": 1,
   "mbps": 8.743914396482749
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 103.15909999999894,
   "min": 93.92519999999968,
   "samples": 15,
   "batch": 1,
   "mbps": 9.190202318554638
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 75.06144999999924,
   "min": 71.3148000000001,
   "samples": 20,
   "batch": 1,
   "mbps": 14.1976740390708
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 46.65009999999984,
   "min": 44.504399999999805,
   "samples": 32,
   "batch": 1,
   "mbps": 14.20730073461798
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 883.5326999999997,
   "min": 846.9578000000001,
   "samples": 7,
   "batch": 1,
   "mbps": 10.313791442014544
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.15363013698630337,
   "min": 0.1432328767123555,
   "samples": 127,
   "batch": 73,
   "mbps": 10.473205528310162
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 13.480375000000095,
   "min": 8.26090000000113,
   "samples": 56,
   "batch": 2,
   "mbps": 3.8111699414889895
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 80.72330000000147,
   "min": 55.79630000000179,
   "samples": 17,
   "batch": 1,
   "mbps": 6.640164611704307
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 154.84630000000107,
   "min": 101.77080000000205,
   "samples": 11,
   "batch": 1,
   "mbps": 3.3143446113985053
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 165.07890000000225,
   "min": 115.12750000000233,
   "samples": 10,
   "batch": 1,
   "mbps": 5.743029545265852
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 99.778999999995,
   "min": 82.54839999999967,
   "samples": 15,
   "batch": 1,
   "mbps": 10.680584090841293
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 56.47624999999971,
   "min": 51.08660000000236,
   "samples": 26,
   "batch": 1,
   "mbps": 11.735410902813191
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.8886437500000284,
   "min": 2.83797499999946,
   "samples": 64,
   "batch": 8,
   "mbps": 17.78550920306441
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 34.62564999999813,
   "min": 34.34870000000228,
   "samples": 44,
   "batch": 1,
   "mbps": 30.77770381206006
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 45.9207000000024,
   "min": 43.58649999999761,
   "samples": 33,
   "batch": 1,
   "mbps": 11.672644362999085
  }
 },
 "fast": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.05510058823529425,
   "min": 0.053199411764705926,
   "samples": 80,
   "batch": 340,
   "mbps": 29.201140160775413
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.2168833333332714,
   "min": 2.088833333333317,
   "samples": 111,
   "batch": 6,
   "mbps": 23.174877643539247
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 15.847900000000664,
   "min": 15.163799999999355,
   "samples": 87,
   "batch": 1,
   "mbps": 33.82252538191038
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 17.489700000000084,
   "min": 16.70719999999983,
   "samples": 81,
   "batch": 1,
   "mbps": 29.343785199288583
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 33.914999999999964,
   "min": 31.48439999999937,
   "samples": 43,
   "batch": 1,
   "mbps": 27.953796255344272
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 27.213200000000143,
   "min": 26.10699999999997,
   "samples": 52,
   "batch": 1,
   "mbps": 39.161068893037
  },
  "parse three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse three.module (1.2MB esm)",
   "ms": 17.023849999999584,
   "min": 16.135700000000725,
   "samples": 86,
   "batch": 1,
   "mbps": 38.93196897294186
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 337.01505,
   "min": 301.34220000000096,
   "samples": 10,
   "batch": 1,
   "mbps": 27.039065466067466
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.08480243902439302,
   "min": 0.0740878048780404,
   "samples": 88,
   "batch": 164,
   "mbps": 18.973510886133578
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 3.3305999999996856,
   "min": 2.914839999999822,
   "samples": 85,
   "batch": 5,
   "mbps": 15.425448868073275
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 27.359450000001743,
   "min": 20.29569999999876,
   "samples": 52,
   "batch": 1,
   "mbps": 19.591621907602892
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 35.86869999999908,
   "min": 23.97739999999976,
   "samples": 43,
   "batch": 1,
   "mbps": 14.308129371848244
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 67.02339999999822,
   "min": 46.2487000000001,
   "samples": 19,
   "batch": 1,
   "mbps": 14.145104545576995
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 53.63180000000102,
   "min": 34.553100000000995,
   "samples": 28,
   "batch": 1,
   "mbps": 19.870636450762042
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 24.061299999997573,
   "min": 20.52639999999883,
   "samples": 55,
   "batch": 1,
   "mbps": 27.545145108538062
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.8830062500001077,
   "min": 2.772599999999784,
   "samples": 60,
   "batch": 8,
   "mbps": 17.82028741699678
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 35.28659999999945,
   "min": 34.11609999999928,
   "samples": 41,
   "batch": 1,
   "mbps": 30.20120952429581
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "fast",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 17.47990000000209,
   "min": 15.931299999996554,
   "samples": 78,
   "batch": 1,
   "mbps": 30.664706319826543
  }
 }
}
```
