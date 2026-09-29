| case                                                        | acorn     | prev             | fast             |
|-------------------------------------------------------------|-----------|------------------|------------------|
| parse zod-errors.js (1.6KB esm)                             | 41.3 us   | 14.3 us  x2.89   | 14.4 us  x2.88   |
| parse zod-schemas.js (51KB esm)                             | 2.28 ms   | 725.4 us  x3.15  | 720.8 us  x3.17  |
| parse react-dom-client.prod (536KB cjs)                     | 16.15 ms  | 5.63 ms  x2.87   | 5.74 ms  x2.81   |
| parse babel-parser (513KB cjs)                              | 19.32 ms  | 6.47 ms  x2.99   | 6.52 ms  x2.96   |
| parse rollup node-entry (948KB esm)                         | 32.18 ms  | 11.09 ms  x2.90  | 11.42 ms  x2.82  |
| parse react-dom-client.dev (1MB cjs)                        | 25.76 ms  | 9.97 ms  x2.58   | 10.09 ms  x2.55  |
| parse three.module (1.2MB esm)                              | 17.03 ms  | 5.94 ms  x2.87   | 6.01 ms  x2.83   |
| parse typescript.js (9MB cjs)                               | 318.11 ms | 125.35 ms  x2.54 | 127.82 ms  x2.49 |
| parse+locations zod-errors.js (1.6KB esm)                   | 51.7 us   | 21.5 us  x2.41   | 21.5 us  x2.41   |
| parse+locations zod-schemas.js (51KB esm)                   | 2.75 ms   | 979.6 us  x2.80  | 990.9 us  x2.77  |
| parse+locations react-dom-client.prod (536KB cjs)           | 20.08 ms  | 8.40 ms  x2.39   | 8.64 ms  x2.32   |
| parse+locations babel-parser (513KB cjs)                    | 24.83 ms  | 10.92 ms  x2.27  | 11.03 ms  x2.25  |
| parse+locations rollup node-entry (948KB esm)               | 45.64 ms  | 21.37 ms  x2.14  | 20.41 ms  x2.24  |
| parse+locations react-dom-client.dev (1MB cjs)              | 34.38 ms  | 15.99 ms  x2.15  | 15.83 ms  x2.17  |
| parse+locations three.module (1.2MB esm)                    | 20.24 ms  | 8.07 ms  x2.51   | 8.74 ms  x2.31   |
| tokenize zod-schemas.js (51KB esm)                          | 961.4 us  | 602.0 us  x1.60  | 370.8 us  x2.59  |
| tokenize react-dom-client.dev (1MB cjs)                     | 12.62 ms  | 8.31 ms  x1.52   | 5.79 ms  x2.18   |
| tokenize+locations+ranges zod-schemas.js (51KB esm)         | 1.22 ms   | 798.1 us  x1.53  | 485.7 us  x2.52  |
| parseExpressionAt x8 template expressions (locations)       | 28.3 us   | 8.5 us  x3.33    | 8.9 us  x3.19    |
| parse+onComment+locations zod-schemas.js (51KB esm)         | 2.72 ms   | 945.1 us  x2.88  | 1.02 ms  x2.68   |
| parse script+allowAwaitOutsideFunction react-dom.prod       | 16.40 ms  | 5.85 ms  x2.80   | 6.16 ms  x2.66   |
| parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts] | 1.00 ms   | 355.4 us  x2.82  | 396.0 us  x2.53  |
| topLevelParser zod-errors.js (1.6KB esm)                    | 23.4 us   | 10.3 us  x2.27   | 10.6 us  x2.20   |
| topLevelParser zod-schemas.js (51KB esm)                    | 1.07 ms   | 428.1 us  x2.50  | 438.7 us  x2.44  |
| topLevelParser rollup node-entry (948KB esm)                | 16.35 ms  | 6.41 ms  x2.55   | 6.36 ms  x2.57   |
| topLevelParser three.module (1.2MB esm)                     | 7.99 ms   | 3.58 ms  x2.23   | 3.68 ms  x2.17   |
| jsx parse+locations largest .jsx (70KB)                     | 2.71 ms   | 1.12 ms  x2.43   | 1.14 ms  x2.38   |
| jsx parse+locations x40 median .jsx files (95KB)            | 4.33 ms   | 1.66 ms  x2.61   | 1.72 ms  x2.51   |
| jsx via @r1ck404/fast-acorn-jsx x40 median .jsx             | 4.36 ms   | 1.68 ms  x2.59   | 1.72 ms  x2.53   |
| jsx unrecognised subclass x40 median .jsx                   | 4.30 ms   | 4.57 ms  x0.94   | 1.73 ms  x2.48   |
| parseAst fallback flow (acorn fails -> jsx) x40 median .jsx | 7.69 ms   | 3.15 ms  x2.44   | 3.13 ms  x2.46   |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.041300900900900946,
   "min": 0.04095063063063072,
   "samples": 65,
   "batch": 555,
   "mbps": 38.95798795916583
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.28338888888887,
   "min": 2.2118111111111225,
   "samples": 72,
   "batch": 9,
   "mbps": 22.499890513612993
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 16.147274999999922,
   "min": 15.686449999999695,
   "samples": 46,
   "batch": 2,
   "mbps": 33.19544629047332
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 19.319925000000012,
   "min": 18.181749999999738,
   "samples": 40,
   "batch": 2,
   "mbps": 26.563974756630763
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 32.178499999999985,
   "min": 31.043899999998757,
   "samples": 45,
   "batch": 1,
   "mbps": 29.46231179203507
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 25.760600000001432,
   "min": 25.057699999999386,
   "samples": 57,
   "batch": 1,
   "mbps": 41.36930040449139
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 17.030674999999974,
   "min": 16.414950000000317,
   "samples": 44,
   "batch": 2,
   "mbps": 38.916367084686954
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 318.10979999999927,
   "min": 310.1466999999993,
   "samples": 10,
   "batch": 1,
   "mbps": 28.645995816538882
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.05170608272505788,
   "min": 0.05051435523115097,
   "samples": 71,
   "batch": 411,
   "mbps": 31.118195678363467
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 2.7464124999999058,
   "min": 2.664099999999962,
   "samples": 68,
   "batch": 8,
   "mbps": 18.70658540914803
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 20.083299999998417,
   "min": 19.086599999998725,
   "samples": 71,
   "batch": 1,
   "mbps": 26.68963765915175
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 24.832800000001953,
   "min": 21.926500000001397,
   "samples": 62,
   "batch": 1,
   "mbps": 20.666779420764456
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 45.64459999999963,
   "min": 36.32790000000023,
   "samples": 33,
   "batch": 1,
   "mbps": 20.77032113327771
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 34.3804999999993,
   "min": 27.605999999999767,
   "samples": 44,
   "batch": 1,
   "mbps": 30.99716409010985
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 20.236400000001595,
   "min": 19.392699999996694,
   "samples": 69,
   "batch": 1,
   "mbps": 32.75147753552746
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.9614419999999518,
   "min": 0.9103199999999196,
   "samples": 62,
   "batch": 25,
   "mbps": 53.43640073972488
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 12.618624999999156,
   "min": 12.111450000000332,
   "samples": 60,
   "batch": 2,
   "mbps": 84.45436804723742
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 1.2230475000000296,
   "min": 1.1843000000000756,
   "samples": 62,
   "batch": 20,
   "mbps": 42.006545126005946
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "acorn",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.028275032010248106,
   "min": 0.02783815620998873,
   "samples": 68,
   "batch": 781,
   "mbps": 8.311219591717022
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 2.72026249999999,
   "min": 2.6509624999998778,
   "samples": 69,
   "batch": 8,
   "mbps": 18.88641261642955
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 16.40152499999931,
   "min": 16.00760000000082,
   "samples": 46,
   "batch": 2,
   "mbps": 32.68086351726578
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "acorn",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 1.0012636363637946,
   "min": 0.9832954545454413,
   "samples": 68,
   "batch": 22,
   "mbps": 32.13938750124334
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.023431210191081422,
   "min": 0.022695116772822283,
   "samples": 68,
   "batch": 942,
   "mbps": 68.6690950607592
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 1.0718142857144164,
   "min": 1.0272666666666435,
   "samples": 66,
   "batch": 21,
   "mbps": 47.93367720953205
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 16.34937499999978,
   "min": 15.926150000002963,
   "samples": 46,
   "batch": 2,
   "mbps": 57.987109598991566
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 7.98786666666759,
   "min": 7.731733333331552,
   "samples": 63,
   "batch": 3,
   "mbps": 82.97234138442346
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "acorn",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 2.7084875000000466,
   "min": 2.631475000000137,
   "samples": 69,
   "batch": 8,
   "mbps": 26.672820162544138
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "acorn",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 4.332050000000163,
   "min": 4.165760000000591,
   "samples": 68,
   "batch": 5,
   "mbps": 22.540136886692515
  },
  "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx": {
   "impl": "acorn",
   "name": "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx",
   "ms": 4.3603600000002185,
   "min": 4.244839999999385,
   "samples": 69,
   "batch": 5,
   "mbps": 22.393793173039636
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "acorn",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 4.302319999999599,
   "min": 4.223179999999411,
   "samples": 70,
   "batch": 5,
   "mbps": 22.695894308189324
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "acorn",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 7.689466666665491,
   "min": 7.551700000001195,
   "samples": 65,
   "batch": 3,
   "mbps": 12.698539994106431
  }
 },
 "prev": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.014300570703868046,
   "min": 0.014176157260621462,
   "samples": 65,
   "batch": 1577,
   "mbps": 112.51299219581458
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 0.7254214285714268,
   "min": 0.6933464285714308,
   "samples": 73,
   "batch": 28,
   "mbps": 70.82228064474855
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 5.630750000000035,
   "min": 5.503699999999981,
   "samples": 65,
   "batch": 4,
   "mbps": 95.1944234782217
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 6.472066666666858,
   "min": 6.285899999999856,
   "samples": 75,
   "batch": 3,
   "mbps": 79.29677279797048
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 11.085374999999658,
   "min": 10.634100000000217,
   "samples": 66,
   "batch": 2,
   "mbps": 85.5228623298742
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 9.967200000000048,
   "min": 9.515699999999924,
   "samples": 72,
   "batch": 2,
   "mbps": 106.92049923749849
  },
  "parse three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "parse three.module (1.2MB esm)",
   "ms": 5.93854999999985,
   "min": 5.715674999999919,
   "samples": 63,
   "batch": 4,
   "mbps": 111.60502142779244
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "prev",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 125.35225000000082,
   "min": 113.89270000000033,
   "samples": 12,
   "batch": 1,
   "mbps": 72.69571946255404
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.02145875386199772,
   "min": 0.021171575695159726,
   "samples": 72,
   "batch": 971,
   "mbps": 74.98105483419758
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 0.9795818181818586,
   "min": 0.9308772727272299,
   "samples": 69,
   "batch": 22,
   "mbps": 52.446869721771506
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 8.403133333333244,
   "min": 8.227866666666765,
   "samples": 60,
   "batch": 3,
   "mbps": 63.78763477115747
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 10.924150000000736,
   "min": 10.245100000000093,
   "samples": 69,
   "batch": 2,
   "mbps": 46.979765016039266
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 21.37090000000171,
   "min": 14.22650000000067,
   "samples": 71,
   "batch": 1,
   "mbps": 44.36186590176006
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 15.98845000000074,
   "min": 11.531650000000809,
   "samples": 45,
   "batch": 2,
   "mbps": 66.65424103024063
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 8.068450000000059,
   "min": 7.717500000000048,
   "samples": 62,
   "batch": 3,
   "mbps": 82.14365832346923
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.6019653846153978,
   "min": 0.5833435897436104,
   "samples": 64,
   "batch": 39,
   "mbps": 85.34710020381767
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 8.305933333333087,
   "min": 7.939266666666906,
   "samples": 61,
   "batch": 3,
   "mbps": 128.30562890785282
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 0.798113333333337,
   "min": 0.7865533333333588,
   "samples": 63,
   "batch": 30,
   "mbps": 64.37181018568762
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "prev",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.008493872741554269,
   "min": 0.008438020424195758,
   "samples": 70,
   "batch": 2546,
   "mbps": 27.66700269128332
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 0.9450956521737364,
   "min": 0.8965521739130212,
   "samples": 69,
   "batch": 23,
   "mbps": 54.36063522441808
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "prev",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 5.854075000001103,
   "min": 5.690824999999677,
   "samples": 64,
   "batch": 4,
   "mbps": 91.5628856821785
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "prev",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 0.3553633333332982,
   "min": 0.35116833333340763,
   "samples": 70,
   "batch": 60,
   "mbps": 90.55520640847352
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.010329154795821081,
   "min": 0.010185944919278407,
   "samples": 69,
   "batch": 2106,
   "mbps": 155.7726679293219
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 0.4280981481482471,
   "min": 0.412411111111093,
   "samples": 65,
   "batch": 54,
   "mbps": 120.00986274345874
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 6.412749999999505,
   "min": 6.217374999998356,
   "samples": 59,
   "batch": 4,
   "mbps": 147.83875872286822
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 3.580992857142909,
   "min": 3.436528571429205,
   "samples": 60,
   "batch": 7,
   "mbps": 185.08051438248103
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "prev",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 1.1166424999999436,
   "min": 1.0510400000002846,
   "samples": 68,
   "batch": 20,
   "mbps": 64.69662403141888
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "prev",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 1.6580083333337825,
   "min": 1.6136166666662273,
   "samples": 75,
   "batch": 12,
   "mbps": 58.89294886936045
  },
  "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx": {
   "impl": "prev",
   "name": "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx",
   "ms": 1.6838961538462454,
   "min": 1.6348615384614766,
   "samples": 68,
   "batch": 13,
   "mbps": 57.98754262664339
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "prev",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 4.5746900000005555,
   "min": 4.486220000000321,
   "samples": 66,
   "batch": 5,
   "mbps": 21.344615700733414
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "prev",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 3.1454285714285755,
   "min": 3.0896285714282254,
   "samples": 68,
   "batch": 7,
   "mbps": 31.043464438186895
  }
 },
 "fast": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.014362547408343928,
   "min": 0.014223640960809105,
   "samples": 66,
   "batch": 1582,
   "mbps": 112.02748051959436
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 0.7208464285714301,
   "min": 0.6921642857142842,
   "samples": 73,
   "batch": 28,
   "mbps": 71.27176880353933
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 5.74350000000004,
   "min": 5.600500000000011,
   "samples": 65,
   "batch": 4,
   "mbps": 93.32567249934644
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 6.5224000000000615,
   "min": 6.261499999999842,
   "samples": 57,
   "batch": 4,
   "mbps": 78.68483993621905
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 11.417833333332965,
   "min": 10.736666666666375,
   "samples": 45,
   "batch": 3,
   "mbps": 83.03265359744529
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 10.090766666666848,
   "min": 9.616933333333387,
   "samples": 50,
   "batch": 3,
   "mbps": 105.61120232027109
  },
  "parse three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse three.module (1.2MB esm)",
   "ms": 6.007629999999881,
   "min": 5.747320000000036,
   "samples": 50,
   "batch": 5,
   "mbps": 110.32170756188599
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 127.82135000000017,
   "min": 113.5650999999998,
   "samples": 12,
   "batch": 1,
   "mbps": 71.29147047813208
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.021484477892757814,
   "min": 0.021014957666979143,
   "samples": 65,
   "batch": 1063,
   "mbps": 74.89127769506452
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 0.9909065217391838,
   "min": 0.9413565217391411,
   "samples": 66,
   "batch": 23,
   "mbps": 51.847473876574874
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 8.644000000000233,
   "min": 8.293133333332662,
   "samples": 58,
   "batch": 3,
   "mbps": 62.010180472002034
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 11.033274999998866,
   "min": 10.574399999999514,
   "samples": 68,
   "batch": 2,
   "mbps": 46.515109974151166
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 20.412725000001046,
   "min": 16.602500000000873,
   "samples": 38,
   "batch": 2,
   "mbps": 46.44421555671531
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 15.827100000000428,
   "min": 14.420600000001286,
   "samples": 46,
   "batch": 2,
   "mbps": 67.33375033960557
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 8.742533333332782,
   "min": 8.245899999999287,
   "samples": 57,
   "batch": 3,
   "mbps": 75.81006268206491
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.37084999999999013,
   "min": 0.35107656249999764,
   "samples": 64,
   "batch": 64,
   "mbps": 138.5357961439972
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 5.785949999999957,
   "min": 5.547475000000304,
   "samples": 64,
   "batch": 4,
   "mbps": 184.1872121259271
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 0.4857130000000325,
   "min": 0.48010999999998605,
   "samples": 62,
   "batch": 50,
   "mbps": 105.77439763810432
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "fast",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.00887126939912446,
   "min": 0.008803621169917036,
   "samples": 67,
   "batch": 2513,
   "mbps": 26.49000829838321
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 1.0151840909091498,
   "min": 0.9574454545452847,
   "samples": 68,
   "batch": 22,
   "mbps": 50.60757005558482
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "fast",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 6.164124999999331,
   "min": 5.96757499999876,
   "samples": 60,
   "batch": 4,
   "mbps": 86.95735404458188
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "fast",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 0.3959816666666787,
   "min": 0.392336666666597,
   "samples": 63,
   "batch": 60,
   "mbps": 81.26638859542913
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.010644358154407289,
   "min": 0.010344175422567766,
   "samples": 65,
   "batch": 2189,
   "mbps": 151.15988927277826
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 0.4386815789473889,
   "min": 0.42015789473672366,
   "samples": 60,
   "batch": 57,
   "mbps": 117.1145597753981
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 6.361750000000029,
   "min": 6.155399999999645,
   "samples": 59,
   "batch": 4,
   "mbps": 149.0239320941558
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 3.675992857143034,
   "min": 3.573214285714909,
   "samples": 58,
   "batch": 7,
   "mbps": 180.29741236088898
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "fast",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 1.1373475000000326,
   "min": 1.0685349999999745,
   "samples": 66,
   "batch": 20,
   "mbps": 63.518845383665
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "fast",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 1.7247999999996795,
   "min": 1.6835384615383542,
   "samples": 67,
   "batch": 13,
   "mbps": 56.612360853442794
  },
  "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx": {
   "impl": "fast",
   "name": "jsx via @r1ck404/fast-acorn-jsx x40 median .jsx",
   "ms": 1.7243333333335613,
   "min": 1.6906583333329763,
   "samples": 69,
   "batch": 12,
   "mbps": 56.6276821960103
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "fast",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 1.7333321428572424,
   "min": 1.707978571428352,
   "samples": 62,
   "batch": 14,
   "mbps": 56.33369253687351
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "fast",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 3.1269187500001863,
   "min": 3.067187499999818,
   "samples": 60,
   "batch": 8,
   "mbps": 31.227226482937613
  }
 }
}
```
