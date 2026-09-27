| case                                | pako      | prev             | fast             |
|-------------------------------------|-----------|------------------|------------------|
| deflate L6 tiny 75B                 | 76.9 us   | 4.3 us  x17.85   | 4.0 us  x19.40   |
| deflate L6 text 1KB                 | 71.6 us   | 11.9 us  x6.03   | 11.7 us  x6.10   |
| deflate L6 text 16KB                | 263.0 us  | 91.3 us  x2.88   | 91.9 us  x2.86   |
| deflate L6 js 51KB                  | 1.21 ms   | 613.2 us  x1.98  | 599.8 us  x2.02  |
| deflate L6 js 1MB                   | 33.08 ms  | 16.66 ms  x1.99  | 16.56 ms  x2.00  |
| deflate L6 json 1MB                 | 17.05 ms  | 7.64 ms  x2.23   | 7.53 ms  x2.27   |
| deflate L6 wasm 2MB                 | 108.90 ms | 57.48 ms  x1.89  | 56.58 ms  x1.92  |
| deflate L6 random 1MB               | 31.46 ms  | 15.83 ms  x1.99  | 15.90 ms  x1.98  |
| deflate L6 js 9MB                   | 342.97 ms | 177.36 ms  x1.93 | 176.07 ms  x1.95 |
| deflateRaw L1 text 64KB             | 635.3 us  | 135.4 us  x4.69  | 132.4 us  x4.80  |
| deflateRaw L1 js 1MB                | 9.92 ms   | 3.75 ms  x2.64   | 3.28 ms  x3.02   |
| deflateRaw L1 json 1MB              | 6.67 ms   | 2.09 ms  x3.20   | 1.81 ms  x3.68   |
| deflateRaw L1 js 9MB                | 90.86 ms  | 34.76 ms  x2.61  | 30.50 ms  x2.98  |
| deflate L9 js 1MB                   | 143.13 ms | 70.51 ms  x2.03  | 71.48 ms  x2.00  |
| deflate L9 wasm 2MB                 | 295.27 ms | 174.64 ms  x1.69 | 173.73 ms  x1.70 |
| deflate L3 js 1MB                   | 14.25 ms  | 5.86 ms  x2.43   | 5.65 ms  x2.52   |
| deflate L0 js 1MB                   | 1.01 ms   | 337.1 us  x2.98  | 365.0 us  x2.75  |
| gzip L6 js 1MB                      | 34.15 ms  | 16.92 ms  x2.02  | 16.60 ms  x2.06  |
| inflate tiny 75B                    | 7.6 us    | 0.8 us  x9.77    | 0.7 us  x10.39   |
| inflate text 1KB                    | 13.5 us   | 6.9 us  x1.95    | 3.3 us  x4.09    |
| inflate text 16KB                   | 52.1 us   | 20.7 us  x2.52   | 15.2 us  x3.42   |
| inflate js 51KB                     | 116.7 us  | 47.7 us  x2.45   | 39.9 us  x2.93   |
| inflate js 1MB                      | 3.23 ms   | 1.03 ms  x3.12   | 794.9 us  x4.06  |
| inflate json 1MB                    | 2.49 ms   | 676.6 us  x3.68  | 597.5 us  x4.17  |
| inflate wasm 2MB                    | 7.94 ms   | 2.74 ms  x2.90   | 2.03 ms  x3.92   |
| inflate random 1MB                  | 855.5 us  | 293.5 us  x2.91  | 285.9 us  x2.99  |
| inflate js 9MB                      | 28.81 ms  | 9.31 ms  x3.10   | 6.79 ms  x4.24   |
| inflateRaw(L1) text 64KB            | 149.1 us  | 66.7 us  x2.24   | 57.4 us  x2.60   |
| inflateRaw(L1) js 1MB               | 3.09 ms   | 1.10 ms  x2.82   | 788.6 us  x3.92  |
| inflateRaw(L1) js 9MB               | 27.69 ms  | 9.65 ms  x2.87   | 7.16 ms  x3.87   |
| inflate(L9) js 1MB                  | 3.21 ms   | 1.04 ms  x3.08   | 791.1 us  x4.05  |
| inflate to:string js 51KB           | 123.3 us  | 40.9 us  x3.01   | 33.6 us  x3.67   |
| ungzip babel-parser-7.29.9.tgz      | 9.16 ms   | 2.83 ms  x3.23   | 1.76 ms  x5.21   |
| ungzip esbuild-wasm-0.28.2.tgz      | 71.47 ms  | 23.61 ms  x3.03  | 14.36 ms  x4.98  |
| ungzip lodash-es-4.18.1.tgz         | 4.20 ms   | 1.21 ms  x3.47   | 719.6 us  x5.83  |
| ungzip react-dom-19.3.0.tgz         | 33.40 ms  | 9.90 ms  x3.37   | 5.73 ms  x5.83   |
| ungzip rollup-4.63.5.tgz            | 12.72 ms  | 3.89 ms  x3.27   | 2.33 ms  x5.46   |
| ungzip three-0.186.1.tgz            | 97.48 ms  | 31.36 ms  x3.11  | 18.37 ms  x5.31  |
| ungzip typescript-5.9.3.tgz         | 100.74 ms | 30.53 ms  x3.30  | 17.50 ms  x5.76  |
| ungzip vue-3.5.43.tgz               | 12.76 ms  | 4.07 ms  x3.14   | 2.49 ms  x5.12   |
| ungzip zod-4.6.5.tgz                | 26.59 ms  | 7.82 ms  x3.40   | 4.49 ms  x5.92   |
| Inflate stream 16KB pushes (ts tgz) | 101.08 ms | 36.02 ms  x2.81  | 27.39 ms  x3.69  |
| Deflate stream 64KB pushes js 1MB   | 33.05 ms  | 16.74 ms  x1.97  | 16.59 ms  x1.99  |
| deflateRaw L1 group 128KB           | 1.43 ms   | 617.0 us  x2.32  | 552.8 us  x2.59  |
| inflateRaw(L1) group 128KB          | 410.3 us  | 115.4 us  x3.56  | 93.8 us  x4.37   |
| inflateRaw(L6) group 128KB          | 370.4 us  | 100.4 us  x3.69  | 78.2 us  x4.74   |
| Deflate L1 raw 256KB pushes js 1MB  | 9.78 ms   | 3.76 ms  x2.60   | 3.28 ms  x2.98   |
| deflateRaw L1 300B                  | 40.4 us   | 6.1 us  x6.67    | 5.7 us  x7.14    |
| inflateRaw 300B                     | 11.8 us   | 5.8 us  x2.05    | 2.1 us  x5.55    |
| ungzip 300B                         | 9.7 us    | 5.8 us  x1.66    | 2.3 us  x4.29    |
| gzip 300B                           | 41.9 us   | 6.6 us  x6.33    | 6.3 us  x6.69    |

```json
{
 "pako": {
  "deflate L6 tiny 75B": {
   "impl": "pako",
   "name": "deflate L6 tiny 75B",
   "ms": 0.07694225352112556,
   "min": 0.03676056338028135,
   "samples": 86,
   "batch": 213,
   "mbps": 0.9617602372366475
  },
  "deflate L6 text 1KB": {
   "impl": "pako",
   "name": "deflate L6 text 1KB",
   "ms": 0.07157142857143012,
   "min": 0.06063722943722949,
   "samples": 83,
   "batch": 231,
   "mbps": 14.307385229540609
  },
  "deflate L6 text 16KB": {
   "impl": "pako",
   "name": "deflate L6 text 16KB",
   "ms": 0.2630249999999933,
   "min": 0.23234999999999673,
   "samples": 71,
   "batch": 80,
   "mbps": 62.29065678167633
  },
  "deflate L6 js 51KB": {
   "impl": "pako",
   "name": "deflate L6 js 51KB",
   "ms": 1.2144611111111014,
   "min": 1.1930499999999584,
   "samples": 68,
   "batch": 18,
   "mbps": 42.30518336893855
  },
  "deflate L6 js 1MB": {
   "impl": "pako",
   "name": "deflate L6 js 1MB",
   "ms": 33.08010000000013,
   "min": 32.8091000000004,
   "samples": 46,
   "batch": 1,
   "mbps": 32.21568254025822
  },
  "deflate L6 json 1MB": {
   "impl": "pako",
   "name": "deflate L6 json 1MB",
   "ms": 17.05252500000006,
   "min": 16.61830000000009,
   "samples": 44,
   "batch": 2,
   "mbps": 61.49623003044982
  },
  "deflate L6 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L6 wasm 2MB",
   "ms": 108.89720000000034,
   "min": 108.08209999999963,
   "samples": 14,
   "batch": 1,
   "mbps": 19.258089280532406
  },
  "deflate L6 random 1MB": {
   "impl": "pako",
   "name": "deflate L6 random 1MB",
   "ms": 31.459100000000035,
   "min": 30.935100000000602,
   "samples": 48,
   "batch": 1,
   "mbps": 33.3314049035096
  },
  "deflate L6 js 9MB": {
   "impl": "pako",
   "name": "deflate L6 js 9MB",
   "ms": 342.9747499999994,
   "min": 336.5136999999995,
   "samples": 10,
   "batch": 1,
   "mbps": 26.56922120360177
  },
  "deflateRaw L1 text 64KB": {
   "impl": "pako",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.635319999999982,
   "min": 0.6163800000000005,
   "samples": 65,
   "batch": 35,
   "mbps": 103.15431593527963
  },
  "deflateRaw L1 js 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 1MB",
   "ms": 9.917100000000573,
   "min": 9.779966666667557,
   "samples": 50,
   "batch": 3,
   "mbps": 107.46064877836649
  },
  "deflateRaw L1 json 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 json 1MB",
   "ms": 6.667787500000031,
   "min": 6.569274999999834,
   "samples": 56,
   "batch": 4,
   "mbps": 157.2734583998058
  },
  "deflateRaw L1 js 9MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 9MB",
   "ms": 90.85529999999926,
   "min": 89.81410000000324,
   "samples": 17,
   "batch": 1,
   "mbps": 100.29763811247196
  },
  "deflate L9 js 1MB": {
   "impl": "pako",
   "name": "deflate L9 js 1MB",
   "ms": 143.125,
   "min": 141.5586000000003,
   "samples": 11,
   "batch": 1,
   "mbps": 7.445924890829694
  },
  "deflate L9 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L9 wasm 2MB",
   "ms": 295.2739500000007,
   "min": 294.5546999999933,
   "samples": 10,
   "batch": 1,
   "mbps": 7.102394234235682
  },
  "deflate L3 js 1MB": {
   "impl": "pako",
   "name": "deflate L3 js 1MB",
   "ms": 14.250800000001618,
   "min": 14.06199999999808,
   "samples": 52,
   "batch": 2,
   "mbps": 74.78162629465567
  },
  "deflate L0 js 1MB": {
   "impl": "pako",
   "name": "deflate L0 js 1MB",
   "ms": 1.005320833333523,
   "min": 0.9010750000000675,
   "samples": 63,
   "batch": 24,
   "mbps": 1060.0576101325519
  },
  "gzip L6 js 1MB": {
   "impl": "pako",
   "name": "gzip L6 js 1MB",
   "ms": 34.148849999997765,
   "min": 33.850500000000466,
   "samples": 44,
   "batch": 1,
   "mbps": 31.20743451097386
  },
  "inflate tiny 75B": {
   "impl": "pako",
   "name": "inflate tiny 75B",
   "ms": 0.007559862068965335,
   "min": 0.005976229885057145,
   "samples": 85,
   "batch": 2175,
   "mbps": 9.788538378733655
  },
  "inflate text 1KB": {
   "impl": "pako",
   "name": "inflate text 1KB",
   "ms": 0.013486577868850554,
   "min": 0.012163251366120696,
   "samples": 74,
   "batch": 1464,
   "mbps": 75.92734123940326
  },
  "inflate text 16KB": {
   "impl": "pako",
   "name": "inflate text 16KB",
   "ms": 0.05214424083769414,
   "min": 0.046303664921471,
   "samples": 75,
   "batch": 382,
   "mbps": 314.2053606839799
  },
  "inflate js 51KB": {
   "impl": "pako",
   "name": "inflate js 51KB",
   "ms": 0.11673542857145158,
   "min": 0.11459657142857656,
   "samples": 71,
   "batch": 175,
   "mbps": 440.123453768386
  },
  "inflate js 1MB": {
   "impl": "pako",
   "name": "inflate js 1MB",
   "ms": 3.225071428571287,
   "min": 3.20031428571383,
   "samples": 65,
   "batch": 7,
   "mbps": 330.44167349561815
  },
  "inflate json 1MB": {
   "impl": "pako",
   "name": "inflate json 1MB",
   "ms": 2.4897222222223516,
   "min": 2.437944444444535,
   "samples": 65,
   "batch": 9,
   "mbps": 421.1979917438139
  },
  "inflate wasm 2MB": {
   "impl": "pako",
   "name": "inflate wasm 2MB",
   "ms": 7.941599999998289,
   "min": 7.857600000000578,
   "samples": 63,
   "batch": 3,
   "mbps": 264.07172358220663
  },
  "inflate random 1MB": {
   "impl": "pako",
   "name": "inflate random 1MB",
   "ms": 0.8555068965517798,
   "min": 0.7936000000000007,
   "samples": 60,
   "batch": 29,
   "mbps": 1225.6780210965076
  },
  "inflate js 9MB": {
   "impl": "pako",
   "name": "inflate js 9MB",
   "ms": 28.80850000000646,
   "min": 28.468300000000454,
   "samples": 51,
   "batch": 1,
   "mbps": 316.31539302629284
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.14911555555558556,
   "min": 0.14526814814814348,
   "samples": 71,
   "batch": 135,
   "mbps": 439.49807755348667
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 3.091264285714195,
   "min": 3.0613428571429853,
   "samples": 68,
   "batch": 7,
   "mbps": 344.74503035051396
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 27.689299999998184,
   "min": 27.253800000005867,
   "samples": 54,
   "batch": 1,
   "mbps": 329.10084400835694
  },
  "inflate(L9) js 1MB": {
   "impl": "pako",
   "name": "inflate(L9) js 1MB",
   "ms": 3.206642857143119,
   "min": 3.1776857142862616,
   "samples": 66,
   "batch": 7,
   "mbps": 332.3407212705496
  },
  "inflate to:string js 51KB": {
   "impl": "pako",
   "name": "inflate to:string js 51KB",
   "ms": 0.12327952127661582,
   "min": 0.12180797872338674,
   "samples": 64,
   "batch": 188,
   "mbps": 416.76021668446884
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "pako",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 9.157550000001114,
   "min": 9.097299999998844,
   "samples": 54,
   "batch": 3,
   "mbps": 219.22370066226839
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "pako",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 71.47259999999369,
   "min": 70.23710000001302,
   "samples": 21,
   "batch": 1,
   "mbps": 203.50310468628933
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "pako",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 4.197449999999662,
   "min": 4.164583333331393,
   "samples": 59,
   "batch": 6,
   "mbps": 270.0611085302007
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "pako",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 33.39989999998943,
   "min": 33.14959999998973,
   "samples": 45,
   "batch": 1,
   "mbps": 242.49557633413764
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "pako",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 12.718499999995402,
   "min": 12.610099999998056,
   "samples": 59,
   "batch": 2,
   "mbps": 229.82332822275083
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "pako",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 97.48355000000447,
   "min": 96.44540000001143,
   "samples": 16,
   "batch": 1,
   "mbps": 219.67193439302343
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "pako",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 100.74119999998948,
   "min": 100.07450000000244,
   "samples": 15,
   "batch": 1,
   "mbps": 235.56090259002752
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "pako",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 12.762874999996711,
   "min": 12.669349999996484,
   "samples": 58,
   "batch": 2,
   "mbps": 202.5875831268947
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "pako",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 26.591849999997066,
   "min": 26.318899999998393,
   "samples": 56,
   "batch": 1,
   "mbps": 256.4635405209022
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "pako",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 101.08379999999306,
   "min": 98.30490000000282,
   "samples": 15,
   "batch": 1,
   "mbps": 234.76252376742494
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 33.0457000000024,
   "min": 32.51219999999739,
   "samples": 45,
   "batch": 1,
   "mbps": 32.24921850649019
  },
  "deflateRaw L1 group 128KB": {
   "impl": "pako",
   "name": "deflateRaw L1 group 128KB",
   "ms": 1.4339937499998996,
   "min": 1.4147250000005442,
   "samples": 65,
   "batch": 16,
   "mbps": 84.81417718871404
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.41032500000006555,
   "min": 0.4001370370371862,
   "samples": 66,
   "batch": 54,
   "mbps": 296.4065070370574
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "pako",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.3704051724137038,
   "min": 0.35348793103461,
   "samples": 68,
   "batch": 58,
   "mbps": 328.35124630538326
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 9.778800000000047,
   "min": 9.59006666666634,
   "samples": 51,
   "batch": 3,
   "mbps": 108.98044749867009
  },
  "deflateRaw L1 300B": {
   "impl": "pako",
   "name": "deflateRaw L1 300B",
   "ms": 0.040360897435893384,
   "min": 0.03593183760686094,
   "samples": 72,
   "batch": 468,
   "mbps": 7.432936804155568
  },
  "inflateRaw 300B": {
   "impl": "pako",
   "name": "inflateRaw 300B",
   "ms": 0.011834815055164056,
   "min": 0.011182478909807338,
   "samples": 72,
   "batch": 1541,
   "mbps": 25.34893858515319
  },
  "ungzip 300B": {
   "impl": "pako",
   "name": "ungzip 300B",
   "ms": 0.009709731373538604,
   "min": 0.008773340091233008,
   "samples": 74,
   "batch": 1973,
   "mbps": 30.896838280982053
  },
  "gzip 300B": {
   "impl": "pako",
   "name": "gzip 300B",
   "ms": 0.04193801843315929,
   "min": 0.037997465437798,
   "samples": 75,
   "batch": 434,
   "mbps": 7.153413804663643
  }
 },
 "prev": {
  "deflate L6 tiny 75B": {
   "impl": "prev",
   "name": "deflate L6 tiny 75B",
   "ms": 0.004310709770633888,
   "min": 0.004256944193606685,
   "samples": 63,
   "batch": 5537,
   "mbps": 17.166546563657505
  },
  "deflate L6 text 1KB": {
   "impl": "prev",
   "name": "deflate L6 text 1KB",
   "ms": 0.011877141482194473,
   "min": 0.011668768046198217,
   "samples": 60,
   "batch": 2078,
   "mbps": 86.21603114984542
  },
  "deflate L6 text 16KB": {
   "impl": "prev",
   "name": "deflate L6 text 16KB",
   "ms": 0.09128644688644771,
   "min": 0.08784761904761858,
   "samples": 60,
   "batch": 273,
   "mbps": 179.47899780106735
  },
  "deflate L6 js 51KB": {
   "impl": "prev",
   "name": "deflate L6 js 51KB",
   "ms": 0.6131926829268373,
   "min": 0.6021560975609757,
   "samples": 59,
   "batch": 41,
   "mbps": 83.78769256470423
  },
  "deflate L6 js 1MB": {
   "impl": "prev",
   "name": "deflate L6 js 1MB",
   "ms": 16.655550000000403,
   "min": 16.584649999999783,
   "samples": 45,
   "batch": 2,
   "mbps": 63.98455769998434
  },
  "deflate L6 json 1MB": {
   "impl": "prev",
   "name": "deflate L6 json 1MB",
   "ms": 7.639837499999885,
   "min": 7.503450000000157,
   "samples": 50,
   "batch": 4,
   "mbps": 137.2628671748602
  },
  "deflate L6 wasm 2MB": {
   "impl": "prev",
   "name": "deflate L6 wasm 2MB",
   "ms": 57.4759499999991,
   "min": 57.269099999999526,
   "samples": 26,
   "batch": 1,
   "mbps": 36.48746997657338
  },
  "deflate L6 random 1MB": {
   "impl": "prev",
   "name": "deflate L6 random 1MB",
   "ms": 15.831650000000081,
   "min": 15.762150000000474,
   "samples": 48,
   "batch": 2,
   "mbps": 66.23289423401822
  },
  "deflate L6 js 9MB": {
   "impl": "prev",
   "name": "deflate L6 js 9MB",
   "ms": 177.3614499999985,
   "min": 176.92369999999937,
   "samples": 10,
   "batch": 1,
   "mbps": 51.37853800811888
  },
  "deflateRaw L1 text 64KB": {
   "impl": "prev",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.1354012658227901,
   "min": 0.13096075949367414,
   "samples": 67,
   "batch": 158,
   "mbps": 484.013200332794
  },
  "deflateRaw L1 js 1MB": {
   "impl": "prev",
   "name": "deflateRaw L1 js 1MB",
   "ms": 3.751571428571229,
   "min": 3.7096857142860244,
   "samples": 57,
   "batch": 7,
   "mbps": 284.06709569324846
  },
  "deflateRaw L1 json 1MB": {
   "impl": "prev",
   "name": "deflateRaw L1 json 1MB",
   "ms": 2.085645833333274,
   "min": 2.060258333333271,
   "samples": 60,
   "batch": 12,
   "mbps": 502.8015702570291
  },
  "deflateRaw L1 js 9MB": {
   "impl": "prev",
   "name": "deflateRaw L1 js 9MB",
   "ms": 34.76220000000103,
   "min": 34.38550000000032,
   "samples": 43,
   "batch": 1,
   "mbps": 262.14025579508
  },
  "deflate L9 js 1MB": {
   "impl": "prev",
   "name": "deflate L9 js 1MB",
   "ms": 70.51445000000058,
   "min": 70.31879999999728,
   "samples": 22,
   "batch": 1,
   "mbps": 15.113186020737471
  },
  "deflate L9 wasm 2MB": {
   "impl": "prev",
   "name": "deflate L9 wasm 2MB",
   "ms": 174.63554999999906,
   "min": 173.8748999999989,
   "samples": 10,
   "batch": 1,
   "mbps": 12.008734762194818
  },
  "deflate L3 js 1MB": {
   "impl": "prev",
   "name": "deflate L3 js 1MB",
   "ms": 5.856659999999829,
   "min": 5.827820000000065,
   "samples": 51,
   "batch": 5,
   "mbps": 181.96343991285664
  },
  "deflate L0 js 1MB": {
   "impl": "prev",
   "name": "deflate L0 js 1MB",
   "ms": 0.33713287671229386,
   "min": 0.32621780821919194,
   "samples": 61,
   "batch": 73,
   "mbps": 3161.062220904243
  },
  "gzip L6 js 1MB": {
   "impl": "prev",
   "name": "gzip L6 js 1MB",
   "ms": 16.917849999997998,
   "min": 16.853900000001886,
   "samples": 45,
   "batch": 2,
   "mbps": 62.99251973508018
  },
  "inflate tiny 75B": {
   "impl": "prev",
   "name": "inflate tiny 75B",
   "ms": 0.0007739380448895963,
   "min": 0.0007618660730846794,
   "samples": 71,
   "batch": 26955,
   "mbps": 95.61488867052172
  },
  "inflate text 1KB": {
   "impl": "prev",
   "name": "inflate text 1KB",
   "ms": 0.006909521110795834,
   "min": 0.0068509492774166385,
   "samples": 61,
   "batch": 3529,
   "mbps": 148.20129840837208
  },
  "inflate text 16KB": {
   "impl": "prev",
   "name": "inflate text 16KB",
   "ms": 0.020716171328671523,
   "min": 0.016165209790205363,
   "samples": 65,
   "batch": 1144,
   "mbps": 790.8797306249478
  },
  "inflate js 51KB": {
   "impl": "prev",
   "name": "inflate js 51KB",
   "ms": 0.04768916500994584,
   "min": 0.040339363817092924,
   "samples": 62,
   "batch": 503,
   "mbps": 1077.3516371965168
  },
  "inflate js 1MB": {
   "impl": "prev",
   "name": "inflate js 1MB",
   "ms": 1.033539583333398,
   "min": 1.0069249999999859,
   "samples": 60,
   "batch": 24,
   "mbps": 1031.1148379657448
  },
  "inflate json 1MB": {
   "impl": "prev",
   "name": "inflate json 1MB",
   "ms": 0.6765578947367765,
   "min": 0.6212921052631971,
   "samples": 59,
   "batch": 38,
   "mbps": 1550.0018670360755
  },
  "inflate wasm 2MB": {
   "impl": "prev",
   "name": "inflate wasm 2MB",
   "ms": 2.739266666666582,
   "min": 2.709377777778071,
   "samples": 60,
   "batch": 9,
   "mbps": 765.588843729489
  },
  "inflate random 1MB": {
   "impl": "prev",
   "name": "inflate random 1MB",
   "ms": 0.2935154761904587,
   "min": 0.2837464285714218,
   "samples": 61,
   "batch": 84,
   "mbps": 3572.4726123797013
  },
  "inflate js 9MB": {
   "impl": "prev",
   "name": "inflate js 9MB",
   "ms": 9.307500000000195,
   "min": 9.154066666667253,
   "samples": 53,
   "batch": 3,
   "mbps": 979.0568896051367
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "prev",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.06667583333332408,
   "min": 0.0500108333333224,
   "samples": 65,
   "batch": 360,
   "mbps": 982.9048505831812
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "prev",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 1.096880952380854,
   "min": 1.0528666666668003,
   "samples": 64,
   "batch": 21,
   "mbps": 971.5712518180125
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "prev",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 9.650466666666034,
   "min": 9.419800000000881,
   "samples": 51,
   "batch": 3,
   "mbps": 944.2623154666715
  },
  "inflate(L9) js 1MB": {
   "impl": "prev",
   "name": "inflate(L9) js 1MB",
   "ms": 1.039504347826195,
   "min": 1.012808695652221,
   "samples": 62,
   "batch": 23,
   "mbps": 1025.1982131951456
  },
  "inflate to:string js 51KB": {
   "impl": "prev",
   "name": "inflate to:string js 51KB",
   "ms": 0.04090963455149469,
   "min": 0.039787375415278235,
   "samples": 61,
   "batch": 602,
   "mbps": 1255.8899770988746
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "prev",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 2.833616666666785,
   "min": 2.816155555555371,
   "samples": 58,
   "batch": 9,
   "mbps": 708.4769170141514
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "prev",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 23.605649999999514,
   "min": 23.401850000002014,
   "samples": 32,
   "batch": 2,
   "mbps": 616.1616392685777
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "prev",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 1.2111904761903654,
   "min": 1.1948952380958613,
   "samples": 57,
   "batch": 21,
   "mbps": 935.9122469039581
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "prev",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 9.904783333334004,
   "min": 9.798133333330043,
   "samples": 50,
   "batch": 3,
   "mbps": 817.7188462812867
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "prev",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 3.8925642857149274,
   "min": 3.8507714285702344,
   "samples": 54,
   "batch": 7,
   "mbps": 750.9209316662951
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "prev",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 31.36470000000554,
   "min": 30.823399999993853,
   "samples": 47,
   "batch": 1,
   "mbps": 682.7548167205878
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "prev",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 30.531399999992573,
   "min": 30.108600000006845,
   "samples": 49,
   "batch": 1,
   "mbps": 777.2551537107953
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "prev",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 4.070892857143398,
   "min": 4.011014285713567,
   "samples": 52,
   "batch": 7,
   "mbps": 635.1432205991173
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "prev",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 7.8158875000008265,
   "min": 7.669849999998405,
   "samples": 48,
   "batch": 4,
   "mbps": 872.5611774733553
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "prev",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 36.022799999998824,
   "min": 32.95150000001013,
   "samples": 42,
   "batch": 1,
   "mbps": 658.7685576912615
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "prev",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 16.742199999993318,
   "min": 16.618500000004133,
   "samples": 45,
   "batch": 2,
   "mbps": 63.65340277863277
  },
  "deflateRaw L1 group 128KB": {
   "impl": "prev",
   "name": "deflateRaw L1 group 128KB",
   "ms": 0.6169841463413877,
   "min": 0.6034121951219631,
   "samples": 60,
   "batch": 41,
   "mbps": 197.12500024709541
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "prev",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.11536549999997078,
   "min": 0.1086134999999922,
   "samples": 63,
   "batch": 200,
   "mbps": 1054.2406525350368
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "prev",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.10038326530609214,
   "min": 0.09425877551019562,
   "samples": 61,
   "batch": 245,
   "mbps": 1211.586409638528
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "prev",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 3.763242857141969,
   "min": 3.724042857142714,
   "samples": 57,
   "batch": 7,
   "mbps": 283.186081912703
  },
  "deflateRaw L1 300B": {
   "impl": "prev",
   "name": "deflateRaw L1 300B",
   "ms": 0.0060508060322445045,
   "min": 0.005935257410297653,
   "samples": 65,
   "batch": 3846,
   "mbps": 49.580171369122056
  },
  "inflateRaw 300B": {
   "impl": "prev",
   "name": "inflateRaw 300B",
   "ms": 0.0057732762719915395,
   "min": 0.005690608654302895,
   "samples": 61,
   "batch": 4206,
   "mbps": 51.96356208612765
  },
  "ungzip 300B": {
   "impl": "prev",
   "name": "ungzip 300B",
   "ms": 0.005832421406284972,
   "min": 0.0057723782097454,
   "samples": 62,
   "batch": 4167,
   "mbps": 51.436612532270445
  },
  "gzip 300B": {
   "impl": "prev",
   "name": "gzip 300B",
   "ms": 0.006623379960031551,
   "min": 0.006481558664001426,
   "samples": 65,
   "batch": 3503,
   "mbps": 45.294094829276695
  }
 },
 "fast": {
  "deflate L6 tiny 75B": {
   "impl": "fast",
   "name": "deflate L6 tiny 75B",
   "ms": 0.0039651547756994,
   "min": 0.0038863267670915433,
   "samples": 63,
   "batch": 6041,
   "mbps": 18.662575406516734
  },
  "deflate L6 text 1KB": {
   "impl": "fast",
   "name": "deflate L6 text 1KB",
   "ms": 0.011731673987310976,
   "min": 0.011459931673987149,
   "samples": 62,
   "batch": 2049,
   "mbps": 87.28507126157463
  },
  "deflate L6 text 16KB": {
   "impl": "fast",
   "name": "deflate L6 text 16KB",
   "ms": 0.09190671641791162,
   "min": 0.08833731343283537,
   "samples": 61,
   "batch": 268,
   "mbps": 178.2677114205653
  },
  "deflate L6 js 51KB": {
   "impl": "fast",
   "name": "deflate L6 js 51KB",
   "ms": 0.5998488095238026,
   "min": 0.5868119047619031,
   "samples": 60,
   "batch": 42,
   "mbps": 85.65158283932756
  },
  "deflate L6 js 1MB": {
   "impl": "fast",
   "name": "deflate L6 js 1MB",
   "ms": 16.559974999999667,
   "min": 16.396450000000186,
   "samples": 46,
   "batch": 2,
   "mbps": 64.35384111389186
  },
  "deflate L6 json 1MB": {
   "impl": "fast",
   "name": "deflate L6 json 1MB",
   "ms": 7.5281250000000455,
   "min": 7.428475000000162,
   "samples": 50,
   "batch": 4,
   "mbps": 139.29975923619676
  },
  "deflate L6 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L6 wasm 2MB",
   "ms": 56.58259999999973,
   "min": 56.39060000000063,
   "samples": 27,
   "batch": 1,
   "mbps": 37.06354957177666
  },
  "deflate L6 random 1MB": {
   "impl": "fast",
   "name": "deflate L6 random 1MB",
   "ms": 15.904749999999694,
   "min": 15.689800000000105,
   "samples": 47,
   "batch": 2,
   "mbps": 65.92848048539085
  },
  "deflate L6 js 9MB": {
   "impl": "fast",
   "name": "deflate L6 js 9MB",
   "ms": 176.07330000000002,
   "min": 175.80589999999938,
   "samples": 10,
   "batch": 1,
   "mbps": 51.75442273189631
  },
  "deflateRaw L1 text 64KB": {
   "impl": "fast",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.1324117977528045,
   "min": 0.12979606741572844,
   "samples": 63,
   "batch": 178,
   "mbps": 494.9407916230178
  },
  "deflateRaw L1 js 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 1MB",
   "ms": 3.2790624999997817,
   "min": 3.231800000000021,
   "samples": 57,
   "batch": 8,
   "mbps": 325.0008195940367
  },
  "deflateRaw L1 json 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 json 1MB",
   "ms": 1.8110714285713974,
   "min": 1.792699999999968,
   "samples": 59,
   "batch": 14,
   "mbps": 579.0307237231416
  },
  "deflateRaw L1 js 9MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 9MB",
   "ms": 30.504300000000512,
   "min": 30.33810000000085,
   "samples": 49,
   "batch": 1,
   "mbps": 298.7307363224151
  },
  "deflate L9 js 1MB": {
   "impl": "fast",
   "name": "deflate L9 js 1MB",
   "ms": 71.47920000000158,
   "min": 70.9272000000019,
   "samples": 21,
   "batch": 1,
   "mbps": 14.90920435595217
  },
  "deflate L9 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L9 wasm 2MB",
   "ms": 173.73484999999891,
   "min": 173.4278000000013,
   "samples": 10,
   "batch": 1,
   "mbps": 12.070992089382257
  },
  "deflate L3 js 1MB": {
   "impl": "fast",
   "name": "deflate L3 js 1MB",
   "ms": 5.652320000000327,
   "min": 5.612159999999858,
   "samples": 53,
   "batch": 5,
   "mbps": 188.54169615307313
  },
  "deflate L0 js 1MB": {
   "impl": "fast",
   "name": "deflate L0 js 1MB",
   "ms": 0.3650440298507731,
   "min": 0.35085373134328374,
   "samples": 62,
   "batch": 67,
   "mbps": 2919.3683853305265
  },
  "gzip L6 js 1MB": {
   "impl": "fast",
   "name": "gzip L6 js 1MB",
   "ms": 16.596125000001848,
   "min": 16.40070000000196,
   "samples": 46,
   "batch": 2,
   "mbps": 64.21366433428776
  },
  "inflate tiny 75B": {
   "impl": "fast",
   "name": "inflate tiny 75B",
   "ms": 0.0007274585257397224,
   "min": 0.0007187857020692964,
   "samples": 70,
   "batch": 29235,
   "mbps": 101.72401227238689
  },
  "inflate text 1KB": {
   "impl": "fast",
   "name": "inflate text 1KB",
   "ms": 0.003295121282718922,
   "min": 0.0032415239139376283,
   "samples": 62,
   "batch": 7297,
   "mbps": 310.7624612697294
  },
  "inflate text 16KB": {
   "impl": "fast",
   "name": "inflate text 16KB",
   "ms": 0.015227099483204503,
   "min": 0.011583591731262293,
   "samples": 66,
   "batch": 1548,
   "mbps": 1075.9764207275034
  },
  "inflate js 51KB": {
   "impl": "fast",
   "name": "inflate js 51KB",
   "ms": 0.039902105263159654,
   "min": 0.03145526315789188,
   "samples": 66,
   "batch": 570,
   "mbps": 1287.601234600413
  },
  "inflate js 1MB": {
   "impl": "fast",
   "name": "inflate js 1MB",
   "ms": 0.7949109374999352,
   "min": 0.7394093749999229,
   "samples": 60,
   "batch": 32,
   "mbps": 1340.6508197656883
  },
  "inflate json 1MB": {
   "impl": "fast",
   "name": "inflate json 1MB",
   "ms": 0.5975452380951625,
   "min": 0.5558452380951383,
   "samples": 61,
   "batch": 42,
   "mbps": 1754.9566679552286
  },
  "inflate wasm 2MB": {
   "impl": "fast",
   "name": "inflate wasm 2MB",
   "ms": 2.027019230769488,
   "min": 1.988430769230875,
   "samples": 56,
   "batch": 13,
   "mbps": 1034.598965893327
  },
  "inflate random 1MB": {
   "impl": "fast",
   "name": "inflate random 1MB",
   "ms": 0.2858835294117692,
   "min": 0.27509647058819503,
   "samples": 61,
   "batch": 85,
   "mbps": 3667.8433422084104
  },
  "inflate js 9MB": {
   "impl": "fast",
   "name": "inflate js 9MB",
   "ms": 6.787625000000844,
   "min": 6.599900000001071,
   "samples": 55,
   "batch": 4,
   "mbps": 1342.5273199386925
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "fast",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.05742273972603359,
   "min": 0.040713150684932274,
   "samples": 70,
   "batch": 365,
   "mbps": 1141.29002399877
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 0.7886178571429159,
   "min": 0.7494249999999738,
   "samples": 66,
   "batch": 28,
   "mbps": 1351.3490600642976
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 7.161587500000678,
   "min": 6.988900000000285,
   "samples": 52,
   "batch": 4,
   "mbps": 1272.4234675620646
  },
  "inflate(L9) js 1MB": {
   "impl": "fast",
   "name": "inflate(L9) js 1MB",
   "ms": 0.7910921874999985,
   "min": 0.7390250000000833,
   "samples": 60,
   "batch": 32,
   "mbps": 1347.1223921042729
  },
  "inflate to:string js 51KB": {
   "impl": "fast",
   "name": "inflate to:string js 51KB",
   "ms": 0.033570262793914715,
   "min": 0.032328215767633874,
   "samples": 61,
   "batch": 723,
   "mbps": 1530.4616563595473
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "fast",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 1.756746666666489,
   "min": 1.6672866666665263,
   "samples": 57,
   "batch": 15,
   "mbps": 1142.7669328153195
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "fast",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 14.364349999999831,
   "min": 14.223550000002433,
   "samples": 52,
   "batch": 2,
   "mbps": 1012.5690337537146
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "fast",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 0.7196058823529337,
   "min": 0.6717823529414839,
   "samples": 61,
   "batch": 34,
   "mbps": 1575.2622759190242
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "fast",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 5.727659999998286,
   "min": 5.474419999998645,
   "samples": 53,
   "batch": 5,
   "mbps": 1414.0727626993264
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "fast",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 2.331318181817716,
   "min": 2.223936363636643,
   "samples": 59,
   "batch": 11,
   "mbps": 1253.800542026806
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "fast",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 18.366850000005797,
   "min": 18.151200000000244,
   "samples": 41,
   "batch": 2,
   "mbps": 1165.9266559041557
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "fast",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 17.500099999997474,
   "min": 16.80434999999852,
   "samples": 43,
   "batch": 2,
   "mbps": 1356.031565534107
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "fast",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 2.4915699999997742,
   "min": 2.429680000001099,
   "samples": 59,
   "batch": 10,
   "mbps": 1037.7392567739353
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "fast",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 4.492741666667522,
   "min": 4.302583333332829,
   "samples": 56,
   "batch": 6,
   "mbps": 1517.9684268511696
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "fast",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 27.39190000000235,
   "min": 22.238899999996647,
   "samples": 56,
   "batch": 1,
   "mbps": 866.3396113448853
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "fast",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 16.58732499999678,
   "min": 16.44354999999632,
   "samples": 46,
   "batch": 2,
   "mbps": 64.24773132498501
  },
  "deflateRaw L1 group 128KB": {
   "impl": "fast",
   "name": "deflateRaw L1 group 128KB",
   "ms": 0.5527714285715428,
   "min": 0.5383928571429264,
   "samples": 62,
   "batch": 42,
   "mbps": 220.02403473402182
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "fast",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.09380258620688531,
   "min": 0.08614181034480962,
   "samples": 67,
   "batch": 232,
   "mbps": 1296.5847202949783
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "fast",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.07821850649350665,
   "min": 0.07381818181819619,
   "samples": 61,
   "batch": 308,
   "mbps": 1554.913350462612
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "fast",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 3.28353750000133,
   "min": 3.253362499999639,
   "samples": 57,
   "batch": 8,
   "mbps": 324.557889166659
  },
  "deflateRaw L1 300B": {
   "impl": "fast",
   "name": "deflateRaw L1 300B",
   "ms": 0.005652148760330161,
   "min": 0.005582739079104178,
   "samples": 62,
   "batch": 4235,
   "mbps": 53.077159275347164
  },
  "inflateRaw 300B": {
   "impl": "fast",
   "name": "inflateRaw 300B",
   "ms": 0.002134186570526744,
   "min": 0.0021059756647137974,
   "samples": 63,
   "batch": 11095,
   "mbps": 140.56877882328544
  },
  "ungzip 300B": {
   "impl": "fast",
   "name": "ungzip 300B",
   "ms": 0.0022640730391215533,
   "min": 0.0022361437656576587,
   "samples": 64,
   "batch": 10378,
   "mbps": 132.5045591799451
  },
  "gzip 300B": {
   "impl": "fast",
   "name": "gzip 300B",
   "ms": 0.006270541611623974,
   "min": 0.006124491413472075,
   "samples": 63,
   "batch": 3785,
   "mbps": 47.84275722592718
  }
 }
}
```
