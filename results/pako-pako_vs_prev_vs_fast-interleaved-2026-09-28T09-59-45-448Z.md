| case                                | pako      | prev             | fast             |
|-------------------------------------|-----------|------------------|------------------|
| deflate L6 tiny 75B                 | 80.6 us   | 4.0 us  x20.26   | 4.0 us  x20.37   |
| deflate L6 text 1KB                 | 68.5 us   | 11.8 us  x5.81   | 11.8 us  x5.82   |
| deflate L6 text 16KB                | 254.6 us  | 89.4 us  x2.85   | 89.3 us  x2.85   |
| deflate L6 js 51KB                  | 1.21 ms   | 565.2 us  x2.14  | 561.8 us  x2.16  |
| deflate L6 js 1MB                   | 32.80 ms  | 15.75 ms  x2.08  | 15.70 ms  x2.09  |
| deflate L6 json 1MB                 | 16.79 ms  | 7.25 ms  x2.32   | 7.21 ms  x2.33   |
| deflate L6 wasm 2MB                 | 107.68 ms | 53.73 ms  x2.00  | 53.74 ms  x2.00  |
| deflate L6 random 1MB               | 31.17 ms  | 15.86 ms  x1.97  | 15.84 ms  x1.97  |
| deflate L6 js 9MB                   | 338.98 ms | 166.58 ms  x2.03 | 166.89 ms  x2.03 |
| deflateRaw L1 text 64KB             | 624.6 us  | 131.8 us  x4.74  | 131.7 us  x4.74  |
| deflateRaw L1 js 1MB                | 9.85 ms   | 3.25 ms  x3.04   | 3.24 ms  x3.04   |
| deflateRaw L1 json 1MB              | 6.61 ms   | 1.79 ms  x3.69   | 1.78 ms  x3.71   |
| deflateRaw L1 js 9MB                | 89.31 ms  | 30.26 ms  x2.95  | 30.36 ms  x2.94  |
| deflate L9 js 1MB                   | 140.21 ms | 64.34 ms  x2.18  | 64.33 ms  x2.18  |
| deflate L9 wasm 2MB                 | 291.00 ms | 164.45 ms  x1.77 | 163.58 ms  x1.78 |
| deflate L3 js 1MB                   | 14.12 ms  | 5.49 ms  x2.57   | 5.48 ms  x2.58   |
| deflate L0 js 1MB                   | 951.9 us  | 319.4 us  x2.98  | 321.2 us  x2.96  |
| gzip L6 js 1MB                      | 34.12 ms  | 15.76 ms  x2.16  | 15.74 ms  x2.17  |
| inflate tiny 75B                    | 7.2 us    | 0.7 us  x10.36   | 0.7 us  x10.60   |
| inflate text 1KB                    | 13.3 us   | 3.2 us  x4.12    | 3.2 us  x4.18    |
| inflate text 16KB                   | 50.6 us   | 14.2 us  x3.58   | 15.3 us  x3.31   |
| inflate js 51KB                     | 116.1 us  | 40.1 us  x2.89   | 40.2 us  x2.89   |
| inflate js 1MB                      | 3.18 ms   | 762.4 us  x4.18  | 763.6 us  x4.17  |
| inflate json 1MB                    | 2.45 ms   | 567.6 us  x4.31  | 571.0 us  x4.29  |
| inflate wasm 2MB                    | 7.78 ms   | 2.00 ms  x3.89   | 2.00 ms  x3.89   |
| inflate random 1MB                  | 815.1 us  | 267.1 us  x3.05  | 274.7 us  x2.97  |
| inflate js 9MB                      | 28.13 ms  | 6.75 ms  x4.17   | 6.70 ms  x4.20   |
| inflateRaw(L1) text 64KB            | 146.4 us  | 57.9 us  x2.53   | 56.7 us  x2.58   |
| inflateRaw(L1) js 1MB               | 3.07 ms   | 777.9 us  x3.95  | 774.8 us  x3.96  |
| inflateRaw(L1) js 9MB               | 27.11 ms  | 6.82 ms  x3.98   | 6.81 ms  x3.98   |
| inflate(L9) js 1MB                  | 3.18 ms   | 761.2 us  x4.18  | 759.3 us  x4.19  |
| inflate to:string js 51KB           | 120.7 us  | 32.1 us  x3.76   | 32.5 us  x3.72   |
| ungzip babel-parser-7.29.9.tgz      | 8.99 ms   | 1.68 ms  x5.36   | 1.70 ms  x5.29   |
| ungzip esbuild-wasm-0.28.2.tgz      | 69.68 ms  | 13.91 ms  x5.01  | 13.99 ms  x4.98  |
| ungzip lodash-es-4.18.1.tgz         | 4.15 ms   | 692.8 us  x5.99  | 695.0 us  x5.97  |
| ungzip react-dom-19.3.0.tgz         | 32.96 ms  | 5.57 ms  x5.91   | 5.62 ms  x5.87   |
| ungzip rollup-4.63.5.tgz            | 12.55 ms  | 2.26 ms  x5.55   | 2.28 ms  x5.50   |
| ungzip three-0.186.1.tgz            | 95.90 ms  | 18.20 ms  x5.27  | 18.36 ms  x5.22  |
| ungzip typescript-5.9.3.tgz         | 99.84 ms  | 17.25 ms  x5.79  | 17.25 ms  x5.79  |
| ungzip vue-3.5.43.tgz               | 12.59 ms  | 2.46 ms  x5.11   | 2.46 ms  x5.12   |
| ungzip zod-4.6.5.tgz                | 26.19 ms  | 4.43 ms  x5.91   | 4.44 ms  x5.90   |
| Inflate stream 16KB pushes (ts tgz) | 98.26 ms  | 24.17 ms  x4.07  | 23.51 ms  x4.18  |
| Deflate stream 64KB pushes js 1MB   | 32.83 ms  | 15.86 ms  x2.07  | 15.75 ms  x2.08  |
| deflateRaw L1 group 128KB           | 1.43 ms   | 550.6 us  x2.60  | 551.1 us  x2.60  |
| inflateRaw(L1) group 128KB          | 405.0 us  | 88.4 us  x4.58   | 90.8 us  x4.46   |
| inflateRaw(L6) group 128KB          | 362.2 us  | 75.0 us  x4.83   | 75.1 us  x4.83   |
| Deflate L1 raw 256KB pushes js 1MB  | 9.59 ms   | 3.25 ms  x2.95   | 3.24 ms  x2.96   |
| deflateRaw L1 300B                  | 39.1 us   | 5.6 us  x6.99    | 5.5 us  x7.08    |
| inflateRaw 300B                     | 11.2 us   | 2.1 us  x5.43    | 2.1 us  x5.43    |
| ungzip 300B                         | 9.2 us    | 2.2 us  x4.19    | 2.2 us  x4.21    |
| gzip 300B                           | 39.9 us   | 6.2 us  x6.45    | 6.1 us  x6.51    |

```json
{
 "pako": {
  "deflate L6 tiny 75B": {
   "impl": "pako",
   "name": "deflate L6 tiny 75B",
   "ms": 0.08062585365853632,
   "min": 0.048081951219512295,
   "samples": 83,
   "batch": 205,
   "mbps": 0.9178197394771421
  },
  "deflate L6 text 1KB": {
   "impl": "pako",
   "name": "deflate L6 text 1KB",
   "ms": 0.06852577854671196,
   "min": 0.05470657439446488,
   "samples": 72,
   "batch": 289,
   "mbps": 14.943281517071272
  },
  "deflate L6 text 16KB": {
   "impl": "pako",
   "name": "deflate L6 text 16KB",
   "ms": 0.25463863636363465,
   "min": 0.23316590909091287,
   "samples": 65,
   "batch": 88,
   "mbps": 64.34216045911808
  },
  "deflate L6 js 51KB": {
   "impl": "pako",
   "name": "deflate L6 js 51KB",
   "ms": 1.2114800000000288,
   "min": 1.1695999999999913,
   "samples": 61,
   "batch": 20,
   "mbps": 42.409284511505575
  },
  "deflate L6 js 1MB": {
   "impl": "pako",
   "name": "deflate L6 js 1MB",
   "ms": 32.803750000000036,
   "min": 32.21600000000035,
   "samples": 46,
   "batch": 1,
   "mbps": 32.48707845901761
  },
  "deflate L6 json 1MB": {
   "impl": "pako",
   "name": "deflate L6 json 1MB",
   "ms": 16.79190000000017,
   "min": 16.586449999999786,
   "samples": 45,
   "batch": 2,
   "mbps": 62.45070539962658
  },
  "deflate L6 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L6 wasm 2MB",
   "ms": 107.68299999999999,
   "min": 106.85919999999896,
   "samples": 14,
   "batch": 1,
   "mbps": 19.475237502669874
  },
  "deflate L6 random 1MB": {
   "impl": "pako",
   "name": "deflate L6 random 1MB",
   "ms": 31.170250000000124,
   "min": 30.571799999999712,
   "samples": 48,
   "batch": 1,
   "mbps": 33.640281999663
  },
  "deflate L6 js 9MB": {
   "impl": "pako",
   "name": "deflate L6 js 9MB",
   "ms": 338.98209999999926,
   "min": 335.8293999999987,
   "samples": 10,
   "batch": 1,
   "mbps": 26.882162804466724
  },
  "deflateRaw L1 text 64KB": {
   "impl": "pako",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.6246342105263657,
   "min": 0.6100578947368233,
   "samples": 63,
   "batch": 38,
   "mbps": 104.91900522831472
  },
  "deflateRaw L1 js 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 1MB",
   "ms": 9.851600000000568,
   "min": 9.631466666665801,
   "samples": 51,
   "batch": 3,
   "mbps": 108.1751187624283
  },
  "deflateRaw L1 json 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 json 1MB",
   "ms": 6.610775000000103,
   "min": 6.456500000000233,
   "samples": 57,
   "batch": 4,
   "mbps": 158.6298126921554
  },
  "deflateRaw L1 js 9MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 9MB",
   "ms": 89.30710000000181,
   "min": 88.34330000000045,
   "samples": 17,
   "batch": 1,
   "mbps": 102.03636664945806
  },
  "deflate L9 js 1MB": {
   "impl": "pako",
   "name": "deflate L9 js 1MB",
   "ms": 140.20579999999973,
   "min": 139.47999999999956,
   "samples": 11,
   "batch": 1,
   "mbps": 7.600955167332608
  },
  "deflate L9 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L9 wasm 2MB",
   "ms": 291.0046999999995,
   "min": 290.2030999999988,
   "samples": 10,
   "batch": 1,
   "mbps": 7.2065915086594945
  },
  "deflate L3 js 1MB": {
   "impl": "pako",
   "name": "deflate L3 js 1MB",
   "ms": 14.123500000001513,
   "min": 13.876899999999296,
   "samples": 53,
   "batch": 2,
   "mbps": 75.45565900802816
  },
  "deflate L0 js 1MB": {
   "impl": "pako",
   "name": "deflate L0 js 1MB",
   "ms": 0.9519461538462706,
   "min": 0.9085807692306564,
   "samples": 60,
   "batch": 26,
   "mbps": 1119.4939920647016
  },
  "gzip L6 js 1MB": {
   "impl": "pako",
   "name": "gzip L6 js 1MB",
   "ms": 34.12010000000009,
   "min": 33.50140000000101,
   "samples": 44,
   "batch": 1,
   "mbps": 31.23373026456538
  },
  "inflate tiny 75B": {
   "impl": "pako",
   "name": "inflate tiny 75B",
   "ms": 0.007187495792662988,
   "min": 0.005882127229888981,
   "samples": 66,
   "batch": 2971,
   "mbps": 10.295658200668356
  },
  "inflate text 1KB": {
   "impl": "pako",
   "name": "inflate text 1KB",
   "ms": 0.013265669014082293,
   "min": 0.011803462441315906,
   "samples": 61,
   "batch": 1704,
   "mbps": 77.19173446231497
  },
  "inflate text 16KB": {
   "impl": "pako",
   "name": "inflate text 16KB",
   "ms": 0.05061550976139176,
   "min": 0.04564815618221142,
   "samples": 64,
   "batch": 461,
   "mbps": 323.6952482991153
  },
  "inflate js 51KB": {
   "impl": "pako",
   "name": "inflate js 51KB",
   "ms": 0.11605300546446917,
   "min": 0.1134049180327963,
   "samples": 69,
   "batch": 183,
   "mbps": 442.7114988911675
  },
  "inflate js 1MB": {
   "impl": "pako",
   "name": "inflate js 1MB",
   "ms": 3.1847999999999956,
   "min": 3.1440249999996013,
   "samples": 59,
   "batch": 8,
   "mbps": 334.6200703340874
  },
  "inflate json 1MB": {
   "impl": "pako",
   "name": "inflate json 1MB",
   "ms": 2.4491399999998977,
   "min": 2.400359999999637,
   "samples": 61,
   "batch": 10,
   "mbps": 428.1772377242803
  },
  "inflate wasm 2MB": {
   "impl": "pako",
   "name": "inflate wasm 2MB",
   "ms": 7.784037500000522,
   "min": 7.740200000000186,
   "samples": 48,
   "batch": 4,
   "mbps": 269.4169959998085
  },
  "inflate random 1MB": {
   "impl": "pako",
   "name": "inflate random 1MB",
   "ms": 0.815145161290392,
   "min": 0.781945161290247,
   "samples": 59,
   "batch": 31,
   "mbps": 1286.367201566997
  },
  "inflate js 9MB": {
   "impl": "pako",
   "name": "inflate js 9MB",
   "ms": 28.128700000001118,
   "min": 27.868600000001607,
   "samples": 54,
   "batch": 1,
   "mbps": 323.95994126993565
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.1464188356164152,
   "min": 0.14192602739725996,
   "samples": 68,
   "batch": 146,
   "mbps": 447.5926865836425
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 3.0696500000003653,
   "min": 3.022675000000163,
   "samples": 60,
   "batch": 8,
   "mbps": 347.1724789470699
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 27.11319999999978,
   "min": 26.75209999999788,
   "samples": 56,
   "batch": 1,
   "mbps": 336.0935632828318
  },
  "inflate(L9) js 1MB": {
   "impl": "pako",
   "name": "inflate(L9) js 1MB",
   "ms": 3.1805875000000015,
   "min": 3.1148624999996173,
   "samples": 59,
   "batch": 8,
   "mbps": 335.0632548232047
  },
  "inflate to:string js 51KB": {
   "impl": "pako",
   "name": "inflate to:string js 51KB",
   "ms": 0.1207128205128053,
   "min": 0.11950666666667437,
   "samples": 64,
   "batch": 195,
   "mbps": 425.6217341433902
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "pako",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 8.987516666665519,
   "min": 8.945900000001226,
   "samples": 56,
   "batch": 3,
   "mbps": 223.37115740168377
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "pako",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 69.67725000000064,
   "min": 68.92719999999099,
   "samples": 22,
   "batch": 1,
   "mbps": 208.74669996304198
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "pako",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 4.146591666666305,
   "min": 4.108066666665157,
   "samples": 60,
   "batch": 6,
   "mbps": 273.373433201187
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "pako",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 32.95880000000034,
   "min": 32.72939999999653,
   "samples": 46,
   "batch": 1,
   "mbps": 245.74098571549683
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "pako",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 12.552999999999884,
   "min": 12.472900000000664,
   "samples": 59,
   "batch": 2,
   "mbps": 232.85334183064023
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "pako",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 95.89549999999872,
   "min": 95.23159999999916,
   "samples": 16,
   "batch": 1,
   "mbps": 223.30974863262912
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "pako",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 99.83649999999034,
   "min": 98.67470000000321,
   "samples": 15,
   "batch": 1,
   "mbps": 237.6955121624085
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "pako",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 12.593049999999494,
   "min": 12.476150000002235,
   "samples": 60,
   "batch": 2,
   "mbps": 205.3196008909759
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "pako",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 26.190499999996973,
   "min": 25.953099999998813,
   "samples": 57,
   "batch": 1,
   "mbps": 260.3936541876172
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "pako",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 98.26274999999441,
   "min": 97.67919999999867,
   "samples": 16,
   "batch": 1,
   "mbps": 241.5023800982707
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 32.830599999993865,
   "min": 32.24760000000242,
   "samples": 46,
   "batch": 1,
   "mbps": 32.46050940281929
  },
  "deflateRaw L1 group 128KB": {
   "impl": "pako",
   "name": "deflateRaw L1 group 128KB",
   "ms": 1.4313529411763952,
   "min": 1.3992470588238897,
   "samples": 61,
   "batch": 17,
   "mbps": 84.97065713229395
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.4050105263158912,
   "min": 0.3944175438595458,
   "samples": 65,
   "batch": 57,
   "mbps": 300.2958987419976
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "pako",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.36218968253963374,
   "min": 0.3491095238095445,
   "samples": 66,
   "batch": 63,
   "mbps": 335.7991844140701
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 9.590016666666392,
   "min": 9.50689999999789,
   "samples": 52,
   "batch": 3,
   "mbps": 111.12577141854435
  },
  "deflateRaw L1 300B": {
   "impl": "pako",
   "name": "deflateRaw L1 300B",
   "ms": 0.039094335937505775,
   "min": 0.036322460937498136,
   "samples": 65,
   "batch": 512,
   "mbps": 7.673745897092735
  },
  "inflateRaw 300B": {
   "impl": "pako",
   "name": "inflateRaw 300B",
   "ms": 0.01117802319160249,
   "min": 0.010239867476531673,
   "samples": 65,
   "batch": 1811,
   "mbps": 26.838376952498677
  },
  "ungzip 300B": {
   "impl": "pako",
   "name": "ungzip 300B",
   "ms": 0.009229441391943219,
   "min": 0.008678754578755655,
   "samples": 68,
   "batch": 2184,
   "mbps": 32.50467577180597
  },
  "gzip 300B": {
   "impl": "pako",
   "name": "gzip 300B",
   "ms": 0.039860869565221585,
   "min": 0.0371064182194832,
   "samples": 72,
   "batch": 483,
   "mbps": 7.526178010470411
  }
 },
 "prev": {
  "deflate L6 tiny 75B": {
   "impl": "prev",
   "name": "deflate L6 tiny 75B",
   "ms": 0.003980449362843717,
   "min": 0.003901794097920843,
   "samples": 63,
   "batch": 5964,
   "mbps": 18.59086581800725
  },
  "deflate L6 text 1KB": {
   "impl": "prev",
   "name": "deflate L6 text 1KB",
   "ms": 0.011798134863701517,
   "min": 0.011622572931611855,
   "samples": 61,
   "batch": 2091,
   "mbps": 86.79337978670408
  },
  "deflate L6 text 16KB": {
   "impl": "prev",
   "name": "deflate L6 text 16KB",
   "ms": 0.08940533807829126,
   "min": 0.08684590747331229,
   "samples": 60,
   "batch": 281,
   "mbps": 183.25527705798407
  },
  "deflate L6 js 51KB": {
   "impl": "prev",
   "name": "deflate L6 js 51KB",
   "ms": 0.565228888888891,
   "min": 0.5514200000000022,
   "samples": 59,
   "batch": 45,
   "mbps": 90.89768943161636
  },
  "deflate L6 js 1MB": {
   "impl": "prev",
   "name": "deflate L6 js 1MB",
   "ms": 15.751999999999953,
   "min": 15.539999999999964,
   "samples": 48,
   "batch": 2,
   "mbps": 67.65477399695297
  },
  "deflate L6 json 1MB": {
   "impl": "prev",
   "name": "deflate L6 json 1MB",
   "ms": 7.251750000000129,
   "min": 7.196574999999939,
   "samples": 52,
   "batch": 4,
   "mbps": 144.6086806632856
  },
  "deflate L6 wasm 2MB": {
   "impl": "prev",
   "name": "deflate L6 wasm 2MB",
   "ms": 53.72859999999946,
   "min": 53.492999999998574,
   "samples": 28,
   "batch": 1,
   "mbps": 39.03232170575859
  },
  "deflate L6 random 1MB": {
   "impl": "prev",
   "name": "deflate L6 random 1MB",
   "ms": 15.859750000000531,
   "min": 15.728900000000067,
   "samples": 47,
   "batch": 2,
   "mbps": 66.11554406595091
  },
  "deflate L6 js 9MB": {
   "impl": "prev",
   "name": "deflate L6 js 9MB",
   "ms": 166.57684999999947,
   "min": 166.05069999999978,
   "samples": 10,
   "batch": 1,
   "mbps": 54.70491247733421
  },
  "deflateRaw L1 text 64KB": {
   "impl": "prev",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.13180276243093628,
   "min": 0.12961933701657702,
   "samples": 63,
   "batch": 181,
   "mbps": 497.2278182283198
  },
  "deflateRaw L1 js 1MB": {
   "impl": "prev",
   "name": "deflateRaw L1 js 1MB",
   "ms": 3.2458812500001386,
   "min": 3.2212374999999156,
   "samples": 58,
   "batch": 8,
   "mbps": 328.3231633935944
  },
  "deflateRaw L1 json 1MB": {
   "impl": "prev",
   "name": "deflateRaw L1 json 1MB",
   "ms": 1.7917142857143387,
   "min": 1.7752857142856686,
   "samples": 60,
   "batch": 14,
   "mbps": 585.2863977036983
  },
  "deflateRaw L1 js 9MB": {
   "impl": "prev",
   "name": "deflateRaw L1 js 9MB",
   "ms": 30.258100000000923,
   "min": 30.065599999998085,
   "samples": 50,
   "batch": 1,
   "mbps": 301.16140801966156
  },
  "deflate L9 js 1MB": {
   "impl": "prev",
   "name": "deflate L9 js 1MB",
   "ms": 64.34154999999919,
   "min": 64.20969999999943,
   "samples": 24,
   "batch": 1,
   "mbps": 16.563138438536427
  },
  "deflate L9 wasm 2MB": {
   "impl": "prev",
   "name": "deflate L9 wasm 2MB",
   "ms": 164.45144999999866,
   "min": 163.26640000000043,
   "samples": 10,
   "batch": 1,
   "mbps": 12.752408081534197
  },
  "deflate L3 js 1MB": {
   "impl": "prev",
   "name": "deflate L3 js 1MB",
   "ms": 5.494200000000274,
   "min": 5.439400000000023,
   "samples": 55,
   "batch": 5,
   "mbps": 193.96782061081632
  },
  "deflate L0 js 1MB": {
   "impl": "prev",
   "name": "deflate L0 js 1MB",
   "ms": 0.3194307692307726,
   "min": 0.31467820512821515,
   "samples": 60,
   "batch": 78,
   "mbps": 3336.240909309795
  },
  "gzip L6 js 1MB": {
   "impl": "prev",
   "name": "gzip L6 js 1MB",
   "ms": 15.762724999998682,
   "min": 15.565199999997276,
   "samples": 48,
   "batch": 2,
   "mbps": 67.6087415088501
  },
  "inflate tiny 75B": {
   "impl": "prev",
   "name": "inflate tiny 75B",
   "ms": 0.0006937186177021544,
   "min": 0.0006843753076696593,
   "samples": 70,
   "batch": 30471,
   "mbps": 106.6714920310408
  },
  "inflate text 1KB": {
   "impl": "prev",
   "name": "inflate text 1KB",
   "ms": 0.003222467078742161,
   "min": 0.003169712442891688,
   "samples": 63,
   "batch": 7442,
   "mbps": 317.76895619976426
  },
  "inflate text 16KB": {
   "impl": "prev",
   "name": "inflate text 16KB",
   "ms": 0.014150420439842964,
   "min": 0.011441203104786154,
   "samples": 68,
   "batch": 1546,
   "mbps": 1157.8454555221556
  },
  "inflate js 51KB": {
   "impl": "prev",
   "name": "inflate js 51KB",
   "ms": 0.0401438003220667,
   "min": 0.029204347826088776,
   "samples": 61,
   "batch": 621,
   "mbps": 1279.8489327817315
  },
  "inflate js 1MB": {
   "impl": "prev",
   "name": "inflate js 1MB",
   "ms": 0.7624060606059643,
   "min": 0.7285212121212019,
   "samples": 60,
   "batch": 33,
   "mbps": 1397.8089302608348
  },
  "inflate json 1MB": {
   "impl": "prev",
   "name": "inflate json 1MB",
   "ms": 0.5676181818181993,
   "min": 0.5415613636363229,
   "samples": 60,
   "batch": 44,
   "mbps": 1847.4848649860091
  },
  "inflate wasm 2MB": {
   "impl": "prev",
   "name": "inflate wasm 2MB",
   "ms": 1.99876923076926,
   "min": 1.9292923076920068,
   "samples": 58,
   "batch": 13,
   "mbps": 1049.221674876832
  },
  "inflate random 1MB": {
   "impl": "prev",
   "name": "inflate random 1MB",
   "ms": 0.26711382978720255,
   "min": 0.26018510638297154,
   "samples": 60,
   "batch": 94,
   "mbps": 3925.577349684038
  },
  "inflate js 9MB": {
   "impl": "prev",
   "name": "inflate js 9MB",
   "ms": 6.748037500000464,
   "min": 6.468049999999494,
   "samples": 56,
   "batch": 4,
   "mbps": 1350.4032839176389
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "prev",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.057881235431237035,
   "min": 0.04036713286712676,
   "samples": 64,
   "batch": 429,
   "mbps": 1132.2495021353998
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "prev",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 0.777878787878735,
   "min": 0.7380363636363075,
   "samples": 59,
   "batch": 33,
   "mbps": 1370.0052201013787
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "prev",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 6.8151250000009895,
   "min": 6.647800000000643,
   "samples": 55,
   "batch": 4,
   "mbps": 1337.1100309970363
  },
  "inflate(L9) js 1MB": {
   "impl": "prev",
   "name": "inflate(L9) js 1MB",
   "ms": 0.7611939393939269,
   "min": 0.7233303030302385,
   "samples": 60,
   "batch": 33,
   "mbps": 1400.0347938247164
  },
  "inflate to:string js 51KB": {
   "impl": "prev",
   "name": "inflate to:string js 51KB",
   "ms": 0.03207882585751706,
   "min": 0.03181134564643477,
   "samples": 62,
   "batch": 758,
   "mbps": 1601.6172234047194
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "prev",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 1.677023333333394,
   "min": 1.6322266666669747,
   "samples": 60,
   "batch": 15,
   "mbps": 1197.0924674074863
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "prev",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 13.909550000000309,
   "min": 13.806200000002718,
   "samples": 54,
   "batch": 2,
   "mbps": 1045.6769629498924
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "prev",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 0.6927972222221999,
   "min": 0.6600250000000314,
   "samples": 61,
   "batch": 36,
   "mbps": 1636.2190315428722
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "prev",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 5.572869999999239,
   "min": 5.38753999999899,
   "samples": 54,
   "batch": 5,
   "mbps": 1453.3495308523445
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "prev",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 2.2616416666666432,
   "min": 2.212358333334123,
   "samples": 56,
   "batch": 12,
   "mbps": 1292.4275507835519
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "prev",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 18.19590000000244,
   "min": 17.823000000003958,
   "samples": 42,
   "batch": 2,
   "mbps": 1176.880506047908
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "prev",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 17.25002499999755,
   "min": 16.819799999997485,
   "samples": 44,
   "batch": 2,
   "mbps": 1375.6900642174937
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "prev",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 2.46424545454581,
   "min": 2.3833454545462947,
   "samples": 56,
   "batch": 11,
   "mbps": 1049.2461273410595
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "prev",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 4.428233333334599,
   "min": 4.282999999998235,
   "samples": 57,
   "batch": 6,
   "mbps": 1540.0814470777777
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "prev",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 24.1716249999954,
   "min": 20.564299999998184,
   "samples": 32,
   "batch": 2,
   "mbps": 981.7580737747055
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "prev",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 15.864349999996193,
   "min": 15.633049999996729,
   "samples": 47,
   "batch": 2,
   "mbps": 67.17564854533944
  },
  "deflateRaw L1 group 128KB": {
   "impl": "prev",
   "name": "deflateRaw L1 group 128KB",
   "ms": 0.550636956521687,
   "min": 0.5361478260870765,
   "samples": 59,
   "batch": 46,
   "mbps": 220.87692909004707
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "prev",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.08841234042551963,
   "min": 0.08431191489359295,
   "samples": 69,
   "batch": 235,
   "mbps": 1375.633756720395
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "prev",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.07504088050318272,
   "min": 0.07266792452829354,
   "samples": 61,
   "batch": 318,
   "mbps": 1620.756568745773
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "prev",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 3.2519874999998137,
   "min": 3.206625000000713,
   "samples": 57,
   "batch": 8,
   "mbps": 327.70667168925496
  },
  "deflateRaw L1 300B": {
   "impl": "prev",
   "name": "deflateRaw L1 300B",
   "ms": 0.005595148741420134,
   "min": 0.005539267734551586,
   "samples": 61,
   "batch": 4370,
   "mbps": 53.6178775336463
  },
  "inflateRaw 300B": {
   "impl": "prev",
   "name": "inflateRaw 300B",
   "ms": 0.0020599311329471117,
   "min": 0.0020188040648366733,
   "samples": 61,
   "batch": 11907,
   "mbps": 145.63593665910307
  },
  "ungzip 300B": {
   "impl": "prev",
   "name": "ungzip 300B",
   "ms": 0.002200629779577724,
   "min": 0.0021515069725586825,
   "samples": 61,
   "batch": 11115,
   "mbps": 136.32461161075744
  },
  "gzip 300B": {
   "impl": "prev",
   "name": "gzip 300B",
   "ms": 0.006183111459149048,
   "min": 0.006056068911512917,
   "samples": 63,
   "batch": 3831,
   "mbps": 48.51926121372031
  }
 },
 "fast": {
  "deflate L6 tiny 75B": {
   "impl": "fast",
   "name": "deflate L6 tiny 75B",
   "ms": 0.003958903428855374,
   "min": 0.003895941692893827,
   "samples": 63,
   "batch": 6037,
   "mbps": 18.692044736588944
  },
  "deflate L6 text 1KB": {
   "impl": "fast",
   "name": "deflate L6 text 1KB",
   "ms": 0.01176506881822485,
   "min": 0.011522164214523015,
   "samples": 61,
   "batch": 2107,
   "mbps": 87.03731493807821
  },
  "deflate L6 text 16KB": {
   "impl": "fast",
   "name": "deflate L6 text 16KB",
   "ms": 0.08934000000000261,
   "min": 0.08748392857142855,
   "samples": 59,
   "batch": 280,
   "mbps": 183.38929930601657
  },
  "deflate L6 js 51KB": {
   "impl": "fast",
   "name": "deflate L6 js 51KB",
   "ms": 0.5617922222222155,
   "min": 0.5483422222222241,
   "samples": 60,
   "batch": 45,
   "mbps": 91.45374031126684
  },
  "deflate L6 js 1MB": {
   "impl": "fast",
   "name": "deflate L6 js 1MB",
   "ms": 15.69747499999994,
   "min": 15.565950000000157,
   "samples": 48,
   "batch": 2,
   "mbps": 67.88977208117892
  },
  "deflate L6 json 1MB": {
   "impl": "fast",
   "name": "deflate L6 json 1MB",
   "ms": 7.210462500000176,
   "min": 7.161650000000009,
   "samples": 52,
   "batch": 4,
   "mbps": 145.4367178249626
  },
  "deflate L6 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L6 wasm 2MB",
   "ms": 53.740750000000844,
   "min": 53.53980000000047,
   "samples": 28,
   "batch": 1,
   "mbps": 39.023497066936486
  },
  "deflate L6 random 1MB": {
   "impl": "fast",
   "name": "deflate L6 random 1MB",
   "ms": 15.84375,
   "min": 15.777350000000297,
   "samples": 48,
   "batch": 2,
   "mbps": 66.18231163708086
  },
  "deflate L6 js 9MB": {
   "impl": "fast",
   "name": "deflate L6 js 9MB",
   "ms": 166.89040000000023,
   "min": 166.50790000000052,
   "samples": 10,
   "batch": 1,
   "mbps": 54.60213409519054
  },
  "deflateRaw L1 text 64KB": {
   "impl": "fast",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.13170819672130243,
   "min": 0.1281901639344281,
   "samples": 62,
   "batch": 183,
   "mbps": 497.58482487369923
  },
  "deflateRaw L1 js 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 1MB",
   "ms": 3.237574999999879,
   "min": 3.216649999999845,
   "samples": 58,
   "batch": 8,
   "mbps": 329.1655019574959
  },
  "deflateRaw L1 json 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 json 1MB",
   "ms": 1.781110714285595,
   "min": 1.763985714285809,
   "samples": 60,
   "batch": 14,
   "mbps": 588.7708111511871
  },
  "deflateRaw L1 js 9MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 9MB",
   "ms": 30.35725000000093,
   "min": 30.02889999999752,
   "samples": 50,
   "batch": 1,
   "mbps": 300.1777829019335
  },
  "deflate L9 js 1MB": {
   "impl": "fast",
   "name": "deflate L9 js 1MB",
   "ms": 64.32765000000109,
   "min": 64.19610000000102,
   "samples": 24,
   "batch": 1,
   "mbps": 16.566717422445592
  },
  "deflate L9 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L9 wasm 2MB",
   "ms": 163.5754500000021,
   "min": 163.32570000000123,
   "samples": 10,
   "batch": 1,
   "mbps": 12.820701394983006
  },
  "deflate L3 js 1MB": {
   "impl": "fast",
   "name": "deflate L3 js 1MB",
   "ms": 5.48211999999985,
   "min": 5.456620000000112,
   "samples": 55,
   "batch": 5,
   "mbps": 194.3952339605899
  },
  "deflate L0 js 1MB": {
   "impl": "fast",
   "name": "deflate L0 js 1MB",
   "ms": 0.32124155844155816,
   "min": 0.3148714285714298,
   "samples": 61,
   "batch": 77,
   "mbps": 3317.435032908038
  },
  "gzip L6 js 1MB": {
   "impl": "fast",
   "name": "gzip L6 js 1MB",
   "ms": 15.742424999998548,
   "min": 15.627650000002177,
   "samples": 48,
   "batch": 2,
   "mbps": 67.69592359500511
  },
  "inflate tiny 75B": {
   "impl": "fast",
   "name": "inflate tiny 75B",
   "ms": 0.0006782424647507957,
   "min": 0.0006728285432382395,
   "samples": 71,
   "batch": 31419,
   "mbps": 109.10552471407044
  },
  "inflate text 1KB": {
   "impl": "fast",
   "name": "inflate text 1KB",
   "ms": 0.003177147423092097,
   "min": 0.0031260753762145433,
   "samples": 63,
   "batch": 7509,
   "mbps": 322.3016950857798
  },
  "inflate text 16KB": {
   "impl": "fast",
   "name": "inflate text 16KB",
   "ms": 0.01528262273901649,
   "min": 0.011434237726097748,
   "samples": 66,
   "batch": 1548,
   "mbps": 1072.0672936701956
  },
  "inflate js 51KB": {
   "impl": "fast",
   "name": "inflate js 51KB",
   "ms": 0.0401567387687195,
   "min": 0.02773194675540188,
   "samples": 62,
   "batch": 601,
   "mbps": 1279.4365671950784
  },
  "inflate js 1MB": {
   "impl": "fast",
   "name": "inflate js 1MB",
   "ms": 0.7635606060606678,
   "min": 0.7285454545454934,
   "samples": 60,
   "batch": 33,
   "mbps": 1395.695366603717
  },
  "inflate json 1MB": {
   "impl": "fast",
   "name": "inflate json 1MB",
   "ms": 0.5710034090909011,
   "min": 0.5504022727272968,
   "samples": 60,
   "batch": 44,
   "mbps": 1836.5319423741958
  },
  "inflate wasm 2MB": {
   "impl": "fast",
   "name": "inflate wasm 2MB",
   "ms": 1.9990192307691008,
   "min": 1.9368923076925477,
   "samples": 58,
   "batch": 13,
   "mbps": 1049.0904578207303
  },
  "inflate random 1MB": {
   "impl": "fast",
   "name": "inflate random 1MB",
   "ms": 0.27471521739125426,
   "min": 0.2662282608695893,
   "samples": 60,
   "batch": 92,
   "mbps": 3816.9563737949015
  },
  "inflate js 9MB": {
   "impl": "fast",
   "name": "inflate js 9MB",
   "ms": 6.696224999998776,
   "min": 6.471700000000055,
   "samples": 56,
   "batch": 4,
   "mbps": 1360.8521219047545
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "fast",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.05673370288248794,
   "min": 0.03987250554323338,
   "samples": 61,
   "batch": 451,
   "mbps": 1155.151112483248
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 0.7747812499999327,
   "min": 0.739725000000135,
   "samples": 61,
   "batch": 32,
   "mbps": 1375.4824345582608
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 6.811574999999721,
   "min": 6.518675000001167,
   "samples": 55,
   "batch": 4,
   "mbps": 1337.8068948811947
  },
  "inflate(L9) js 1MB": {
   "impl": "fast",
   "name": "inflate(L9) js 1MB",
   "ms": 0.7592727272727422,
   "min": 0.7337848484848192,
   "samples": 60,
   "batch": 33,
   "mbps": 1403.5773467432675
  },
  "inflate to:string js 51KB": {
   "impl": "fast",
   "name": "inflate to:string js 51KB",
   "ms": 0.032473076923068445,
   "min": 0.03209761273209592,
   "samples": 61,
   "batch": 754,
   "mbps": 1582.1722136685405
  },
  "ungzip babel-parser-7.29.9.tgz": {
   "impl": "fast",
   "name": "ungzip babel-parser-7.29.9.tgz",
   "ms": 1.6980733333334987,
   "min": 1.6352333333333566,
   "samples": 59,
   "batch": 15,
   "mbps": 1182.2528277144318
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "fast",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 13.987199999997756,
   "min": 13.860850000000937,
   "samples": 54,
   "batch": 2,
   "mbps": 1039.8718828644999
  },
  "ungzip lodash-es-4.18.1.tgz": {
   "impl": "fast",
   "name": "ungzip lodash-es-4.18.1.tgz",
   "ms": 0.6950108108108366,
   "min": 0.6576135135135799,
   "samples": 59,
   "batch": 37,
   "mbps": 1631.0077229986096
  },
  "ungzip react-dom-19.3.0.tgz": {
   "impl": "fast",
   "name": "ungzip react-dom-19.3.0.tgz",
   "ms": 5.619109999999637,
   "min": 5.456600000002072,
   "samples": 54,
   "batch": 5,
   "mbps": 1441.3898286384363
  },
  "ungzip rollup-4.63.5.tgz": {
   "impl": "fast",
   "name": "ungzip rollup-4.63.5.tgz",
   "ms": 2.281041666667079,
   "min": 2.1934500000000603,
   "samples": 56,
   "batch": 12,
   "mbps": 1281.435601424556
  },
  "ungzip three-0.186.1.tgz": {
   "impl": "fast",
   "name": "ungzip three-0.186.1.tgz",
   "ms": 18.364699999998265,
   "min": 17.95075000000361,
   "samples": 41,
   "batch": 2,
   "mbps": 1166.0631537679365
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "fast",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 17.24529999999868,
   "min": 16.705950000003213,
   "samples": 44,
   "batch": 2,
   "mbps": 1376.0669863674054
  },
  "ungzip vue-3.5.43.tgz": {
   "impl": "fast",
   "name": "ungzip vue-3.5.43.tgz",
   "ms": 2.4612954545459202,
   "min": 2.423681818181649,
   "samples": 56,
   "batch": 11,
   "mbps": 1050.5037073970514
  },
  "ungzip zod-4.6.5.tgz": {
   "impl": "fast",
   "name": "ungzip zod-4.6.5.tgz",
   "ms": 4.439366666666805,
   "min": 4.310716666666849,
   "samples": 56,
   "batch": 6,
   "mbps": 1536.2191303563843
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "fast",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 23.513950000000477,
   "min": 19.618450000001758,
   "samples": 33,
   "batch": 2,
   "mbps": 1009.2174219984103
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "fast",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 15.749899999998888,
   "min": 15.617749999997613,
   "samples": 48,
   "batch": 2,
   "mbps": 67.66379469076473
  },
  "deflateRaw L1 group 128KB": {
   "impl": "fast",
   "name": "deflateRaw L1 group 128KB",
   "ms": 0.5510826086958885,
   "min": 0.5355630434784436,
   "samples": 59,
   "batch": 46,
   "mbps": 220.6983092567831
  },
  "inflateRaw(L1) group 128KB": {
   "impl": "fast",
   "name": "inflateRaw(L1) group 128KB",
   "ms": 0.0907564102563834,
   "min": 0.08560512820513706,
   "samples": 68,
   "batch": 234,
   "mbps": 1340.1036869618317
  },
  "inflateRaw(L6) group 128KB": {
   "impl": "fast",
   "name": "inflateRaw(L6) group 128KB",
   "ms": 0.07505993690852267,
   "min": 0.07231766561510619,
   "samples": 62,
   "batch": 317,
   "mbps": 1620.345086996607
  },
  "Deflate L1 raw 256KB pushes js 1MB": {
   "impl": "fast",
   "name": "Deflate L1 raw 256KB pushes js 1MB",
   "ms": 3.2409937499996886,
   "min": 3.2087625000003754,
   "samples": 58,
   "batch": 8,
   "mbps": 328.81828297265383
  },
  "deflateRaw L1 300B": {
   "impl": "fast",
   "name": "deflateRaw L1 300B",
   "ms": 0.005520702592087588,
   "min": 0.005434311050477246,
   "samples": 62,
   "batch": 4398,
   "mbps": 54.34090951212761
  },
  "inflateRaw 300B": {
   "impl": "fast",
   "name": "inflateRaw 300B",
   "ms": 0.0020569144919029155,
   "min": 0.002016379961400058,
   "samples": 62,
   "batch": 11917,
   "mbps": 145.84952421744117
  },
  "ungzip 300B": {
   "impl": "fast",
   "name": "ungzip 300B",
   "ms": 0.0021948666127725876,
   "min": 0.0021688583490526514,
   "samples": 62,
   "batch": 11133,
   "mbps": 136.68256569862146
  },
  "gzip 300B": {
   "impl": "fast",
   "name": "gzip 300B",
   "ms": 0.006122613951145094,
   "min": 0.006019768320323392,
   "samples": 62,
   "batch": 3971,
   "mbps": 48.99867971324435
  }
 }
}
```
