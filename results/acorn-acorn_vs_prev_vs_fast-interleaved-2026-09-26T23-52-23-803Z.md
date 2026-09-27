| case                                                        | acorn     | prev             | fast             |
|-------------------------------------------------------------|-----------|------------------|------------------|
| parse zod-errors.js (1.6KB esm)                             | 41.3 us   | 15.1 us  x2.72   | 14.3 us  x2.88   |
| parse zod-schemas.js (51KB esm)                             | 2.30 ms   | 768.7 us  x3.00  | 738.3 us  x3.12  |
| parse react-dom-client.prod (536KB cjs)                     | 17.07 ms  | 5.95 ms  x2.87   | 5.88 ms  x2.90   |
| parse babel-parser (513KB cjs)                              | 18.91 ms  | 7.41 ms  x2.55   | 6.81 ms  x2.78   |
| parse rollup node-entry (948KB esm)                         | 37.30 ms  | 12.17 ms  x3.07  | 11.95 ms  x3.12  |
| parse react-dom-client.dev (1MB cjs)                        | 26.61 ms  | 9.85 ms  x2.70   | 9.81 ms  x2.71   |
| parse three.module (1.2MB esm)                              | 17.99 ms  | 6.43 ms  x2.80   | 6.08 ms  x2.96   |
| parse typescript.js (9MB cjs)                               | 342.62 ms | 141.13 ms  x2.43 | 138.48 ms  x2.47 |
| parse+locations zod-errors.js (1.6KB esm)                   | 51.8 us   | 24.2 us  x2.14   | 22.1 us  x2.34   |
| parse+locations zod-schemas.js (51KB esm)                   | 2.86 ms   | 1.13 ms  x2.53   | 1.06 ms  x2.71   |
| parse+locations react-dom-client.prod (536KB cjs)           | 20.19 ms  | 10.04 ms  x2.01  | 9.94 ms  x2.03   |
| parse+locations babel-parser (513KB cjs)                    | 26.04 ms  | 11.34 ms  x2.30  | 12.40 ms  x2.10  |
| parse+locations rollup node-entry (948KB esm)               | 49.97 ms  | 28.06 ms  x1.78  | 24.57 ms  x2.03  |
| parse+locations react-dom-client.dev (1MB cjs)              | 39.02 ms  | 21.08 ms  x1.85  | 20.27 ms  x1.92  |
| parse+locations three.module (1.2MB esm)                    | 22.05 ms  | 9.78 ms  x2.25   | 9.62 ms  x2.29   |
| tokenize zod-schemas.js (51KB esm)                          | 964.4 us  | 926.7 us  x1.04  | 607.8 us  x1.59  |
| tokenize react-dom-client.dev (1MB cjs)                     | 12.76 ms  | 12.62 ms  x1.01  | 8.34 ms  x1.53   |
| tokenize+locations+ranges zod-schemas.js (51KB esm)         | 1.27 ms   | 1.27 ms  x1.00   | 801.8 us  x1.58  |
| parseExpressionAt x8 template expressions (locations)       | 28.6 us   | 17.1 us  x1.67   | 9.2 us  x3.12    |
| parse+onComment+locations zod-schemas.js (51KB esm)         | 2.87 ms   | 1.09 ms  x2.63   | 1.08 ms  x2.65   |
| parse script+allowAwaitOutsideFunction react-dom.prod       | 16.89 ms  | 6.22 ms  x2.71   | 6.15 ms  x2.75   |
| parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts] | 986.7 us  | 408.1 us  x2.42  | 382.8 us  x2.58  |
| topLevelParser zod-errors.js (1.6KB esm)                    | 23.4 us   | 25.1 us  x0.93   | 10.4 us  x2.24   |
| topLevelParser zod-schemas.js (51KB esm)                    | 1.08 ms   | 1.13 ms  x0.95   | 437.9 us  x2.47  |
| topLevelParser rollup node-entry (948KB esm)                | 16.96 ms  | 17.39 ms  x0.98  | 6.54 ms  x2.59   |
| topLevelParser three.module (1.2MB esm)                     | 8.07 ms   | 8.33 ms  x0.97   | 3.65 ms  x2.21   |
| jsx parse+locations largest .jsx (70KB)                     | 2.91 ms   | 3.34 ms  x0.87   | 1.21 ms  x2.40   |
| jsx parse+locations x40 median .jsx files (95KB)            | 4.55 ms   | 4.97 ms  x0.92   | 1.79 ms  x2.55   |
| jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx            | 4.47 ms   | 5.03 ms  x0.89   | 1.79 ms  x2.49   |
| jsx unrecognised subclass x40 median .jsx                   | 4.38 ms   | 4.89 ms  x0.90   | 4.53 ms  x0.97   |
| parseAst fallback flow (acorn fails -> jsx) x40 median .jsx | 7.89 ms   | 10.00 ms  x0.79  | 3.28 ms  x2.40   |

```json
{
 "acorn": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.04125063520871136,
   "min": 0.04064482758620693,
   "samples": 66,
   "batch": 551,
   "mbps": 39.0054599610192
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 2.3042055555555283,
   "min": 2.220211111111136,
   "samples": 72,
   "batch": 9,
   "mbps": 22.29662187738871
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 17.067025000000058,
   "min": 16.25310000000036,
   "samples": 44,
   "batch": 2,
   "mbps": 31.406528085591848
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 18.914450000000215,
   "min": 18.19459999999981,
   "samples": 76,
   "batch": 1,
   "mbps": 27.13343501925745
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 37.29809999999998,
   "min": 31.639100000000326,
   "samples": 41,
   "batch": 1,
   "mbps": 25.418265273566227
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 26.606049999999414,
   "min": 25.75799999999981,
   "samples": 54,
   "batch": 1,
   "mbps": 40.05472439539216
  },
  "parse three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse three.module (1.2MB esm)",
   "ms": 17.988149999999223,
   "min": 17.108699999998862,
   "samples": 80,
   "batch": 1,
   "mbps": 36.844922907582415
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "acorn",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 342.62175000000116,
   "min": 325.6394999999993,
   "samples": 10,
   "batch": 1,
   "mbps": 26.596595224909013
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.05180718562874036,
   "min": 0.050988023952103216,
   "samples": 83,
   "batch": 334,
   "mbps": 31.057467810167964
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 2.858350000000428,
   "min": 2.761033333332913,
   "samples": 85,
   "batch": 6,
   "mbps": 17.974005982469713
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 20.18999999999869,
   "min": 18.793399999998655,
   "samples": 71,
   "batch": 1,
   "mbps": 26.548588410105733
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "acorn",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 26.035100000000966,
   "min": 21.76889999999912,
   "samples": 59,
   "batch": 1,
   "mbps": 19.7123882758269
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 49.972249999998894,
   "min": 37.32540000000154,
   "samples": 30,
   "batch": 1,
   "mbps": 18.971589232024193
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 39.02484999999979,
   "min": 29.865399999998772,
   "samples": 38,
   "batch": 1,
   "mbps": 27.308189525392304
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 22.050750000000335,
   "min": 19.06290000000081,
   "samples": 66,
   "batch": 1,
   "mbps": 30.056664739294128
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.9644065217391629,
   "min": 0.922526086956603,
   "samples": 66,
   "batch": 23,
   "mbps": 53.27214078493691
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "acorn",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 12.759799999999814,
   "min": 12.243499999996857,
   "samples": 59,
   "batch": 2,
   "mbps": 83.51996112791858
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 1.2694361111110388,
   "min": 1.2241055555556766,
   "samples": 66,
   "batch": 18,
   "mbps": 40.47151294210039
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "acorn",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.028644833068361242,
   "min": 0.028202861685215883,
   "samples": 82,
   "batch": 629,
   "mbps": 8.203922831010034
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 2.873358333333575,
   "min": 2.758049999999154,
   "samples": 86,
   "batch": 6,
   "mbps": 17.880122852757896
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "acorn",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 16.89025000000038,
   "min": 16.57259999999951,
   "samples": 86,
   "batch": 1,
   "mbps": 31.735231864536527
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "acorn",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 0.9866687500002627,
   "min": 0.9639750000001186,
   "samples": 93,
   "batch": 16,
   "mbps": 32.61479599915517
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.023395677419358697,
   "min": 0.022677161290325345,
   "samples": 82,
   "batch": 775,
   "mbps": 68.77338797074697
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 1.0835764705882278,
   "min": 1.0449470588235485,
   "samples": 81,
   "batch": 17,
   "mbps": 47.413358811778316
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "acorn",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 16.956500000000233,
   "min": 15.949599999999919,
   "samples": 86,
   "batch": 1,
   "mbps": 55.910889629344915
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "acorn",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 8.066925000000992,
   "min": 7.858100000001286,
   "samples": 90,
   "batch": 2,
   "mbps": 82.1591870508178
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "acorn",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 2.9067499999994957,
   "min": 2.7717499999998836,
   "samples": 84,
   "batch": 6,
   "mbps": 24.853530575389193
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "acorn",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 4.55357499999991,
   "min": 4.335574999999153,
   "samples": 80,
   "batch": 4,
   "mbps": 21.443591024634916
  },
  "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx": {
   "impl": "acorn",
   "name": "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx",
   "ms": 4.468349999999191,
   "min": 4.305199999998877,
   "samples": 81,
   "batch": 4,
   "mbps": 21.85258540625011
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "acorn",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 4.3840000000000146,
   "min": 4.2591999999986,
   "samples": 81,
   "batch": 4,
   "mbps": 22.273038321167807
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "acorn",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 7.8875499999994645,
   "min": 7.569449999999051,
   "samples": 91,
   "batch": 2,
   "mbps": 12.37963626221154
  }
 },
 "prev": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.015140431266846343,
   "min": 0.014975741239892138,
   "samples": 67,
   "batch": 1484,
   "mbps": 106.27174164604524
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 0.7686634615384597,
   "min": 0.7270230769230728,
   "samples": 74,
   "batch": 26,
   "mbps": 66.83809309365674
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 5.945600000000164,
   "min": 5.542566666666668,
   "samples": 82,
   "batch": 3,
   "mbps": 90.15339074273163
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 7.407333333333251,
   "min": 6.445766666666714,
   "samples": 69,
   "batch": 3,
   "mbps": 69.28458284582922
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 12.165375000000495,
   "min": 10.818100000000413,
   "samples": 62,
   "batch": 2,
   "mbps": 77.93043782045036
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 9.849725000000035,
   "min": 9.527799999999843,
   "samples": 74,
   "batch": 2,
   "mbps": 108.19571104776999
  },
  "parse three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "parse three.module (1.2MB esm)",
   "ms": 6.426466666666784,
   "min": 5.94923333333342,
   "samples": 76,
   "batch": 3,
   "mbps": 103.13163272715768
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "prev",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 141.1262000000006,
   "min": 123.33840000000055,
   "samples": 11,
   "batch": 1,
   "mbps": 64.57037743523145
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.024221459227469242,
   "min": 0.023793133047208002,
   "samples": 88,
   "batch": 699,
   "mbps": 66.42869799418419
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 1.129373333333327,
   "min": 1.0468600000000152,
   "samples": 88,
   "batch": 15,
   "mbps": 45.49071461459478
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "prev",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 10.036149999999907,
   "min": 7.494649999998728,
   "samples": 77,
   "batch": 2,
   "mbps": 53.40852817066355
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "prev",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 11.340000000000146,
   "min": 10.80119999999988,
   "samples": 65,
   "batch": 2,
   "mbps": 45.25696649029924
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 28.06079999999929,
   "min": 14.510699999998906,
   "samples": 53,
   "batch": 1,
   "mbps": 33.78567253962909
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 21.084350000000995,
   "min": 12.349900000001071,
   "samples": 70,
   "batch": 1,
   "mbps": 50.5445033875813
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 9.780800000000454,
   "min": 7.418600000000879,
   "samples": 77,
   "batch": 2,
   "mbps": 67.76255521020461
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.9267399999999907,
   "min": 0.8835559999999532,
   "samples": 65,
   "batch": 25,
   "mbps": 55.437339491119964
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "prev",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 12.62329999999929,
   "min": 12.199900000001435,
   "samples": 59,
   "batch": 2,
   "mbps": 84.42309063399111
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 1.2700277777779168,
   "min": 1.2077722222222493,
   "samples": 65,
   "batch": 18,
   "mbps": 40.45265851577607
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "prev",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.017147208619005642,
   "min": 0.01693408423113996,
   "samples": 85,
   "batch": 1021,
   "mbps": 13.704854546385492
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 1.0933031250001477,
   "min": 1.0054187499999898,
   "samples": 84,
   "batch": 16,
   "mbps": 46.991542258687915
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "prev",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 6.221733333334366,
   "min": 5.857600000000578,
   "samples": 79,
   "batch": 3,
   "mbps": 86.15219767266
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "prev",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 0.4081287500000144,
   "min": 0.4028374999999869,
   "samples": 90,
   "batch": 40,
   "mbps": 78.84766755588491
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "prev",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.02511236413043543,
   "min": 0.024591576086955367,
   "samples": 80,
   "batch": 736,
   "mbps": 64.07202410903002
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "prev",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 1.134864705882672,
   "min": 1.1008764705881784,
   "samples": 77,
   "batch": 17,
   "mbps": 45.27059457721078
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "prev",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 17.385999999998603,
   "min": 16.93000000000029,
   "samples": 83,
   "batch": 1,
   "mbps": 54.52967905211528
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "prev",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 8.326199999998304,
   "min": 8.009666666667423,
   "samples": 59,
   "batch": 3,
   "mbps": 79.60077826621207
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "prev",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 3.338420000000042,
   "min": 3.1808600000003935,
   "samples": 87,
   "batch": 5,
   "mbps": 21.639877546863215
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "prev",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 4.9673500000002,
   "min": 4.804866666665475,
   "samples": 96,
   "batch": 3,
   "mbps": 19.657362577631144
  },
  "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx": {
   "impl": "prev",
   "name": "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx",
   "ms": 5.033100000000559,
   "min": 4.806875000000218,
   "samples": 72,
   "batch": 4,
   "mbps": 19.400568238260547
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "prev",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 4.888899999998102,
   "min": 4.753099999999297,
   "samples": 97,
   "batch": 3,
   "mbps": 19.97279551638158
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "prev",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 9.996274999999514,
   "min": 9.17935000000216,
   "samples": 72,
   "batch": 2,
   "mbps": 9.768138631640761
  }
 },
 "fast": {
  "parse zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse zod-errors.js (1.6KB esm)",
   "ms": 0.014334138588684035,
   "min": 0.014180801017164615,
   "samples": 67,
   "batch": 1573,
   "mbps": 112.24950770813751
  },
  "parse zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse zod-schemas.js (51KB esm)",
   "ms": 0.7382851851851868,
   "min": 0.7029925925926027,
   "samples": 74,
   "batch": 27,
   "mbps": 69.58828516532289
  },
  "parse react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.prod (536KB cjs)",
   "ms": 5.875666666666575,
   "min": 5.690166666666907,
   "samples": 82,
   "batch": 3,
   "mbps": 91.22641402394197
  },
  "parse babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse babel-parser (513KB cjs)",
   "ms": 6.810466666666495,
   "min": 6.287866666666862,
   "samples": 73,
   "batch": 3,
   "mbps": 75.35665691044366
  },
  "parse rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse rollup node-entry (948KB esm)",
   "ms": 11.946049999999559,
   "min": 10.790299999999661,
   "samples": 63,
   "batch": 2,
   "mbps": 79.36121144646431
  },
  "parse react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse react-dom-client.dev (1MB cjs)",
   "ms": 9.812949999999546,
   "min": 9.47990000000027,
   "samples": 72,
   "batch": 2,
   "mbps": 108.60118516858329
  },
  "parse three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse three.module (1.2MB esm)",
   "ms": 6.083533333333738,
   "min": 5.83919999999974,
   "samples": 79,
   "batch": 3,
   "mbps": 108.94524015648076
  },
  "parse typescript.js (9MB cjs)": {
   "impl": "fast",
   "name": "parse typescript.js (9MB cjs)",
   "ms": 138.47849999999926,
   "min": 121.09190000000126,
   "samples": 11,
   "batch": 1,
   "mbps": 65.80495889253602
  },
  "parse+locations zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-errors.js (1.6KB esm)",
   "ms": 0.02211041968162076,
   "min": 0.021649927641097567,
   "samples": 97,
   "batch": 691,
   "mbps": 72.77111982354084
  },
  "parse+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+locations zod-schemas.js (51KB esm)",
   "ms": 1.0563187499999458,
   "min": 0.9802812499999618,
   "samples": 89,
   "batch": 16,
   "mbps": 48.63683428889494
  },
  "parse+locations react-dom-client.prod (536KB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.prod (536KB cjs)",
   "ms": 9.9403999999995,
   "min": 7.53269999999975,
   "samples": 79,
   "batch": 2,
   "mbps": 53.92298096656342
  },
  "parse+locations babel-parser (513KB cjs)": {
   "impl": "fast",
   "name": "parse+locations babel-parser (513KB cjs)",
   "ms": 12.400450000000092,
   "min": 11.67619999999988,
   "samples": 60,
   "batch": 2,
   "mbps": 41.38672386889154
  },
  "parse+locations rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "parse+locations rollup node-entry (948KB esm)",
   "ms": 24.57405000000108,
   "min": 14.576999999997497,
   "samples": 60,
   "batch": 1,
   "mbps": 38.57943643802948
  },
  "parse+locations react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "parse+locations react-dom-client.dev (1MB cjs)",
   "ms": 20.274900000000343,
   "min": 12.311000000001513,
   "samples": 79,
   "batch": 1,
   "mbps": 52.56242940778904
  },
  "parse+locations three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "parse+locations three.module (1.2MB esm)",
   "ms": 9.62487499999861,
   "min": 7.506649999999354,
   "samples": 80,
   "batch": 2,
   "mbps": 68.86032286134581
  },
  "tokenize zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize zod-schemas.js (51KB esm)",
   "ms": 0.6077567567567835,
   "min": 0.5698378378378087,
   "samples": 67,
   "batch": 37,
   "mbps": 84.53381954017505
  },
  "tokenize react-dom-client.dev (1MB cjs)": {
   "impl": "fast",
   "name": "tokenize react-dom-client.dev (1MB cjs)",
   "ms": 8.336183333333489,
   "min": 7.782733333332241,
   "samples": 60,
   "batch": 3,
   "mbps": 127.8400387067599
  },
  "tokenize+locations+ranges zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "tokenize+locations+ranges zod-schemas.js (51KB esm)",
   "ms": 0.8018148148148612,
   "min": 0.7537296296295944,
   "samples": 69,
   "batch": 27,
   "mbps": 64.07464548015705
  },
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "fast",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.009172984516820146,
   "min": 0.00909620928990862,
   "samples": 87,
   "batch": 1873,
   "mbps": 25.618706710895413
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 1.0837624999999207,
   "min": 1.004131249999773,
   "samples": 85,
   "batch": 16,
   "mbps": 47.40522023967775
  },
  "parse script+allowAwaitOutsideFunction react-dom.prod": {
   "impl": "fast",
   "name": "parse script+allowAwaitOutsideFunction react-dom.prod",
   "ms": 6.1519333333332415,
   "min": 5.916233333334579,
   "samples": 80,
   "batch": 3,
   "mbps": 87.12968280974134
  },
  "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]": {
   "impl": "fast",
   "name": "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
   "ms": 0.3828224999999293,
   "min": 0.3781150000000707,
   "samples": 97,
   "batch": 40,
   "mbps": 84.05984496733068
  },
  "topLevelParser zod-errors.js (1.6KB esm)": {
   "impl": "fast",
   "name": "topLevelParser zod-errors.js (1.6KB esm)",
   "ms": 0.010449101449272163,
   "min": 0.010257797101449282,
   "samples": 83,
   "batch": 1725,
   "mbps": 153.98453233623027
  },
  "topLevelParser zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "topLevelParser zod-schemas.js (51KB esm)",
   "ms": 0.43790340909088793,
   "min": 0.4190159090910377,
   "samples": 76,
   "batch": 44,
   "mbps": 117.32267649310943
  },
  "topLevelParser rollup node-entry (948KB esm)": {
   "impl": "fast",
   "name": "topLevelParser rollup node-entry (948KB esm)",
   "ms": 6.540700000000167,
   "min": 6.280733333333046,
   "samples": 73,
   "batch": 3,
   "mbps": 144.94671824116315
  },
  "topLevelParser three.module (1.2MB esm)": {
   "impl": "fast",
   "name": "topLevelParser three.module (1.2MB esm)",
   "ms": 3.646133333333031,
   "min": 3.503350000000258,
   "samples": 67,
   "batch": 6,
   "mbps": 181.7739340305863
  },
  "jsx parse+locations largest .jsx (70KB)": {
   "impl": "fast",
   "name": "jsx parse+locations largest .jsx (70KB)",
   "ms": 1.208853846153663,
   "min": 1.1118538461534906,
   "samples": 94,
   "batch": 13,
   "mbps": 59.76156690063329
  },
  "jsx parse+locations x40 median .jsx files (95KB)": {
   "impl": "fast",
   "name": "jsx parse+locations x40 median .jsx files (95KB)",
   "ms": 1.7862500000001091,
   "min": 1.726362500000505,
   "samples": 100,
   "batch": 8,
   "mbps": 54.664800559828706
  },
  "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx": {
   "impl": "fast",
   "name": "jsx via fast-acorn/acorn-jsx.mjs x40 median .jsx",
   "ms": 1.7910375000001295,
   "min": 1.7266124999996464,
   "samples": 101,
   "batch": 8,
   "mbps": 54.518679815466136
  },
  "jsx unrecognised subclass x40 median .jsx": {
   "impl": "fast",
   "name": "jsx unrecognised subclass x40 median .jsx",
   "ms": 4.526574999999866,
   "min": 4.3543250000002445,
   "samples": 79,
   "batch": 4,
   "mbps": 21.571497213677645
  },
  "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx": {
   "impl": "fast",
   "name": "parseAst fallback flow (acorn fails -> jsx) x40 median .jsx",
   "ms": 3.283049999999639,
   "min": 3.165200000000186,
   "samples": 88,
   "batch": 5,
   "mbps": 29.742160491010104
  }
 }
}
```
