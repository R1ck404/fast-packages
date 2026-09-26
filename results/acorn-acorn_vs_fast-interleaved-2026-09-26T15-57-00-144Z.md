| case                                                  | acorn     | fast             |
|-------------------------------------------------------|-----------|------------------|
| parse zod-errors.js (1.6KB esm)                       | 119.2 us  | 42.4 us  x2.81   |
| parse zod-schemas.js (51KB esm)                       | 6.73 ms   | 2.12 ms  x3.17   |
| parse react-dom-client.prod (536KB cjs)               | 46.58 ms  | 15.17 ms  x3.07  |
| parse babel-parser (513KB cjs)                        | 55.01 ms  | 17.63 ms  x3.12  |
| parse rollup node-entry (948KB esm)                   | 103.20 ms | 33.17 ms  x3.11  |
| parse react-dom-client.dev (1MB cjs)                  | 74.71 ms  | 26.63 ms  x2.80  |
| parse three.module (1.2MB esm)                        | 47.41 ms  | 16.04 ms  x2.96  |
| parse typescript.js (9MB cjs)                         | 1.14 s    | 325.49 ms  x3.49 |
| parse+locations zod-errors.js (1.6KB esm)             | 154.4 us  | 62.7 us  x2.46   |
| parse+locations zod-schemas.js (51KB esm)             | 7.80 ms   | 2.94 ms  x2.66   |
| parse+locations react-dom-client.prod (536KB cjs)     | 54.26 ms  | 20.94 ms  x2.59  |
| parse+locations babel-parser (513KB cjs)              | 71.03 ms  | 29.74 ms  x2.39  |
| parse+locations rollup node-entry (948KB esm)         | 125.29 ms | 60.85 ms  x2.06  |
| parse+locations react-dom-client.dev (1MB cjs)        | 92.52 ms  | 45.02 ms  x2.06  |
| parse+locations three.module (1.2MB esm)              | 57.31 ms  | 21.72 ms  x2.64  |
| tokenize zod-schemas.js (51KB esm)                    | 2.74 ms   | 2.66 ms  x1.03   |
| tokenize react-dom-client.dev (1MB cjs)               | 34.26 ms  | 33.61 ms  x1.02  |
| parseExpressionAt x8 template expressions (locations) | 81.0 us   | 43.7 us  x1.86   |
| parse+onComment+locations zod-schemas.js (51KB esm)   | 8.09 ms   | 2.69 ms  x3.01   |
| parse script+allowAwaitOutsideFunction react-dom.prod | 46.14 ms  | 16.19 ms  x2.85  |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.11920245398772976,
   "min": 0.11586625766871114,
   "samples": 51,
   "batch": 163,
   "mbps": 13.498044261451398
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 6.728133333333214,
   "min": 6.215900000000147,
   "samples": 49,
   "batch": 3,
   "mbps": 7.635996115812346
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 46.57815000000005,
   "min": 42.59349999999995,
   "samples": 22,
   "batch": 1,
   "mbps": 11.507885134982809
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 55.00570000000016,
   "min": 52.61410000000069,
   "samples": 18,
   "batch": 1,
   "mbps": 9.330196688706778
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 103.20134999999982,
   "min": 94.17129999999997,
   "samples": 10,
   "batch": 1,
   "mbps": 9.186439906067136
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 74.70505000000003,
   "min": 68.92070000000058,
   "samples": 14,
   "batch": 1,
   "mbps": 14.265407760251813
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 47.41139999999996,
   "min": 44.232999999998356,
   "samples": 22,
   "batch": 1,
   "mbps": 13.979169566813058
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 1136.2303500000007,
   "min": 881.8796000000002,
   "samples": 4,
   "batch": 1,
   "mbps": 8.020004042314126
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.15435151515151974,
   "min": 0.14545353535353883,
   "samples": 65,
   "batch": 99,
   "mbps": 10.42425789225664
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 7.7995000000009895,
   "min": 7.580599999999322,
   "samples": 63,
   "batch": 2,
   "mbps": 6.587088915955315
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 54.258600000001024,
   "min": 49.728800000000774,
   "samples": 19,
   "batch": 1,
   "mbps": 9.878913204542505
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 71.03090000000157,
   "min": 64.61809999999969,
   "samples": 15,
   "batch": 1,
   "mbps": 7.2252216992884595
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 125.2877499999995,
   "min": 114.3077000000012,
   "samples": 10,
   "batch": 1,
   "mbps": 7.567004755053897
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 92.52449999999953,
   "min": 80.87840000000142,
   "samples": 11,
   "batch": 1,
   "mbps": 11.518008743630123
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 57.30649999999878,
   "min": 55.18990000000122,
   "samples": 17,
   "batch": 1,
   "mbps": 11.565389615488892
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.7426444444447244,
   "min": 2.7124888888890077,
   "samples": 41,
   "batch": 9,
   "mbps": 18.73228595272822
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 34.259500000000116,
   "min": 33.98440000000119,
   "samples": 30,
   "batch": 1,
   "mbps": 31.10664195332671
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "acorn",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.08104553571428412,
   "min": 0.07703095238095903,
   "samples": 72,
   "batch": 168,
   "mbps": 2.899604499234394
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 8.086450000000696,
   "min": 7.564949999999953,
   "samples": 61,
   "batch": 2,
   "mbps": 6.35334417451361
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 46.136149999994814,
   "min": 44.36829999999463,
   "samples": 22,
   "batch": 1,
   "mbps": 11.618134586437323
  }
 },
 "fast": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.04243855421686739,
   "min": 0.041864578313252916,
   "samples": 57,
   "batch": 415,
   "mbps": 37.913638428344385
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.1239166666666733,
   "min": 2.0518499999999826,
   "samples": 76,
   "batch": 6,
   "mbps": 24.189272962686783
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 15.166899999999941,
   "min": 14.96180000000004,
   "samples": 62,
   "batch": 1,
   "mbps": 35.34117057539788
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 17.625550000000203,
   "min": 17.019399999999223,
   "samples": 54,
   "batch": 1,
   "mbps": 29.117616187863305
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 33.172549999999774,
   "min": 31.228399999999965,
   "samples": 30,
   "batch": 1,
   "mbps": 28.57944294303593
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 26.63299999999981,
   "min": 26.108299999999872,
   "samples": 37,
   "batch": 1,
   "mbps": 40.01419291855997
  },
  "parse three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse three.module (1.2MB esm)",
   "ms": 16.035899999998946,
   "min": 15.39600000000064,
   "samples": 61,
   "batch": 1,
   "mbps": 41.33051465773942
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 325.4862999999996,
   "min": 298.8734999999997,
   "samples": 10,
   "batch": 1,
   "mbps": 27.99679126279666
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.06272064220183476,
   "min": 0.05993990825687984,
   "samples": 70,
   "batch": 218,
   "mbps": 25.653436309249585
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 2.9358400000000984,
   "min": 2.6986799999998765,
   "samples": 67,
   "batch": 5,
   "mbps": 17.499591258378615
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 20.944399999998495,
   "min": 18.64310000000114,
   "samples": 44,
   "batch": 1,
   "mbps": 25.59233016940273
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 29.744800000000396,
   "min": 22.239999999997963,
   "samples": 37,
   "batch": 1,
   "mbps": 17.25390656518091
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 60.85359999999855,
   "min": 40.86540000000241,
   "samples": 15,
   "batch": 1,
   "mbps": 15.579242641356018
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 45.019100000001345,
   "min": 31.177800000001298,
   "samples": 23,
   "batch": 1,
   "mbps": 23.672130273594277
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 21.719250000000102,
   "min": 20.06170000000202,
   "samples": 42,
   "batch": 1,
   "mbps": 30.515418350081006
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 2.6643111111111972,
   "min": 2.6558111111108804,
   "samples": 42,
   "batch": 9,
   "mbps": 19.283033346121783
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 33.60920000000078,
   "min": 33.27490000000034,
   "samples": 30,
   "batch": 1,
   "mbps": 31.708520286111398
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "fast",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.0436570512820545,
   "min": 0.042067307692307696,
   "samples": 72,
   "batch": 312,
   "mbps": 5.38286469422176
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 2.690599999999904,
   "min": 2.480633333333268,
   "samples": 62,
   "batch": 6,
   "mbps": 19.0946257340377
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "fast",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 16.194649999999456,
   "min": 15.537099999997736,
   "samples": 60,
   "batch": 1,
   "mbps": 33.098338031388025
  }
 }
}
```
