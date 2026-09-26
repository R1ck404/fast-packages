| case                                | pako      | fast             |
|-------------------------------------|-----------|------------------|
| deflate L6 tiny 75B                 | 247.6 us  | 11.9 us  x20.76  |
| deflate L6 text 1KB                 | 204.8 us  | 30.1 us  x6.80   |
| deflate L6 text 16KB                | 760.2 us  | 339.4 us  x2.24  |
| deflate L6 js 51KB                  | 2.59 ms   | 1.32 ms  x1.96   |
| deflate L6 js 1MB                   | 69.32 ms  | 33.23 ms  x2.09  |
| deflate L6 json 1MB                 | 40.07 ms  | 15.86 ms  x2.53  |
| deflate L6 wasm 2MB                 | 225.71 ms | 111.86 ms  x2.02 |
| deflate L6 random 1MB               | 70.67 ms  | 32.44 ms  x2.18  |
| deflate L6 js 9MB                   | 685.37 ms | 340.92 ms  x2.01 |
| deflateRaw L1 text 64KB             | 1.65 ms   | 612.7 us  x2.69  |
| deflateRaw L1 js 1MB                | 24.42 ms  | 8.20 ms  x2.98   |
| deflateRaw L1 json 1MB              | 17.51 ms  | 4.83 ms  x3.62   |
| deflateRaw L1 js 9MB                | 228.43 ms | 75.72 ms  x3.02  |
| deflate L9 js 1MB                   | 278.99 ms | 154.61 ms  x1.80 |
| deflate L9 wasm 2MB                 | 570.27 ms | 338.05 ms  x1.69 |
| deflate L3 js 1MB                   | 32.96 ms  | 12.48 ms  x2.64  |
| deflate L0 js 1MB                   | 2.66 ms   | 793.6 us  x3.35  |
| gzip L6 js 1MB                      | 70.67 ms  | 33.64 ms  x2.10  |
| inflate tiny 75B                    | 19.4 us   | 1.8 us  x10.84   |
| inflate text 1KB                    | 37.4 us   | 16.8 us  x2.22   |
| inflate text 16KB                   | 147.4 us  | 51.7 us  x2.85   |
| inflate js 51KB                     | 384.1 us  | 133.5 us  x2.88  |
| inflate js 1MB                      | 7.99 ms   | 2.42 ms  x3.30   |
| inflate json 1MB                    | 6.46 ms   | 1.64 ms  x3.95   |
| inflate wasm 2MB                    | 19.49 ms  | 6.47 ms  x3.01   |
| inflate random 1MB                  | 2.27 ms   | 725.1 us  x3.14  |
| inflate js 9MB                      | 71.29 ms  | 22.83 ms  x3.12  |
| inflateRaw(L1) text 64KB            | 519.4 us  | 201.6 us  x2.58  |
| inflateRaw(L1) js 1MB               | 7.49 ms   | 2.57 ms  x2.92   |
| inflateRaw(L1) js 9MB               | 67.88 ms  | 24.60 ms  x2.76  |
| inflate(L9) js 1MB                  | 7.94 ms   | 2.40 ms  x3.31   |
| inflate to:string js 51KB           | 414.8 us  | 149.1 us  x2.78  |
| ungzip esbuild-wasm-0.28.2.tgz      | 158.00 ms | 54.54 ms  x2.90  |
| ungzip lodash-4.17.21.tgz           | 18.95 ms  | 5.42 ms  x3.49   |
| ungzip react-dom-19.2.7.tgz         | 66.63 ms  | 20.44 ms  x3.26  |
| ungzip typescript-5.9.3.tgz         | 222.28 ms | 70.81 ms  x3.14  |
| ungzip zod-4.4.3.tgz                | 43.47 ms  | 13.09 ms  x3.32  |
| Inflate stream 16KB pushes (ts tgz) | 218.10 ms | 86.52 ms  x2.52  |
| Deflate stream 64KB pushes js 1MB   | 68.97 ms  | 33.57 ms  x2.05  |

```json
{
 "pako": {
  "deflate L6 tiny 75B": {
   "impl": "pako",
   "name": "deflate L6 tiny 75B",
   "ms": 0.2476406250000025,
   "min": 0.20003281249999816,
   "samples": 59,
   "batch": 64,
   "mbps": 0.2988201148337404
  },
  "deflate L6 text 1KB": {
   "impl": "pako",
   "name": "deflate L6 text 1KB",
   "ms": 0.2048303571428527,
   "min": 0.12984285714285415,
   "samples": 56,
   "batch": 84,
   "mbps": 4.999258968658841
  },
  "deflate L6 text 16KB": {
   "impl": "pako",
   "name": "deflate L6 text 16KB",
   "ms": 0.7601999999999828,
   "min": 0.7399370370370283,
   "samples": 47,
   "batch": 27,
   "mbps": 21.55222309918491
  },
  "deflate L6 js 51KB": {
   "impl": "pako",
   "name": "deflate L6 js 51KB",
   "ms": 2.5876444444444737,
   "min": 2.5578222222223608,
   "samples": 43,
   "batch": 9,
   "mbps": 19.85512349283753
  },
  "deflate L6 js 1MB": {
   "impl": "pako",
   "name": "deflate L6 js 1MB",
   "ms": 69.3155999999999,
   "min": 68.98600000000079,
   "samples": 15,
   "batch": 1,
   "mbps": 15.374576574393087
  },
  "deflate L6 json 1MB": {
   "impl": "pako",
   "name": "deflate L6 json 1MB",
   "ms": 40.073199999999815,
   "min": 38.99830000000111,
   "samples": 24,
   "batch": 1,
   "mbps": 26.168761167064396
  },
  "deflate L6 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L6 wasm 2MB",
   "ms": 225.70625000000018,
   "min": 222.10839999999916,
   "samples": 10,
   "batch": 1,
   "mbps": 9.291510536371936
  },
  "deflate L6 random 1MB": {
   "impl": "pako",
   "name": "deflate L6 random 1MB",
   "ms": 70.66529999999875,
   "min": 68.622800000001,
   "samples": 15,
   "batch": 1,
   "mbps": 14.838626596080658
  },
  "deflate L6 js 9MB": {
   "impl": "pako",
   "name": "deflate L6 js 9MB",
   "ms": 685.3724999999995,
   "min": 682.5907000000007,
   "samples": 6,
   "batch": 1,
   "mbps": 13.295794622632227
  },
  "deflateRaw L1 text 64KB": {
   "impl": "pako",
   "name": "deflateRaw L1 text 64KB",
   "ms": 1.6475857142857941,
   "min": 1.6150357142856333,
   "samples": 43,
   "batch": 14,
   "mbps": 39.776989707882336
  },
  "deflateRaw L1 js 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 1MB",
   "ms": 24.424000000002707,
   "min": 24.264200000001438,
   "samples": 41,
   "batch": 1,
   "mbps": 43.63322961021462
  },
  "deflateRaw L1 json 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 json 1MB",
   "ms": 17.514650000000984,
   "min": 17.355900000000474,
   "samples": 29,
   "batch": 2,
   "mbps": 59.873648631285306
  },
  "deflateRaw L1 js 9MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 9MB",
   "ms": 228.4323000000004,
   "min": 226.13990000000194,
   "samples": 10,
   "batch": 1,
   "mbps": 39.891784130352775
  },
  "deflate L9 js 1MB": {
   "impl": "pako",
   "name": "deflate L9 js 1MB",
   "ms": 278.9904999999999,
   "min": 277.1808000000019,
   "samples": 10,
   "batch": 1,
   "mbps": 3.8198361592957486
  },
  "deflate L9 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L9 wasm 2MB",
   "ms": 570.2697000000007,
   "min": 568.2791999999972,
   "samples": 8,
   "batch": 1,
   "mbps": 3.6774740092275584
  },
  "deflate L3 js 1MB": {
   "impl": "pako",
   "name": "deflate L3 js 1MB",
   "ms": 32.95650000000023,
   "min": 32.50569999999425,
   "samples": 31,
   "batch": 1,
   "mbps": 32.33650417975187
  },
  "deflate L0 js 1MB": {
   "impl": "pako",
   "name": "deflate L0 js 1MB",
   "ms": 2.659044444444185,
   "min": 2.4421888888884697,
   "samples": 40,
   "batch": 9,
   "mbps": 400.78231946317123
  },
  "gzip L6 js 1MB": {
   "impl": "pako",
   "name": "gzip L6 js 1MB",
   "ms": 70.66539999999804,
   "min": 70.01380000000063,
   "samples": 14,
   "batch": 1,
   "mbps": 15.080902393533886
  },
  "inflate tiny 75B": {
   "impl": "pako",
   "name": "inflate tiny 75B",
   "ms": 0.019354924242423657,
   "min": 0.013323809523813568,
   "samples": 52,
   "batch": 924,
   "mbps": 3.823316437364344
  },
  "inflate text 1KB": {
   "impl": "pako",
   "name": "inflate text 1KB",
   "ms": 0.03744530938123655,
   "min": 0.02865369261476616,
   "samples": 53,
   "batch": 501,
   "mbps": 27.346549325430747
  },
  "inflate text 16KB": {
   "impl": "pako",
   "name": "inflate text 16KB",
   "ms": 0.14740703124999754,
   "min": 0.14408984375000955,
   "samples": 51,
   "batch": 128,
   "mbps": 111.14802232339423
  },
  "inflate js 51KB": {
   "impl": "pako",
   "name": "inflate js 51KB",
   "ms": 0.38414814814826026,
   "min": 0.37919814814813435,
   "samples": 47,
   "batch": 54,
   "mbps": 133.7452757423443
  },
  "inflate js 1MB": {
   "impl": "pako",
   "name": "inflate js 1MB",
   "ms": 7.993633333334097,
   "min": 7.927133333333283,
   "samples": 42,
   "batch": 3,
   "mbps": 133.31834918621465
  },
  "inflate json 1MB": {
   "impl": "pako",
   "name": "inflate json 1MB",
   "ms": 6.460800000000745,
   "min": 6.429874999999811,
   "samples": 39,
   "batch": 4,
   "mbps": 162.31209757303728
  },
  "inflate wasm 2MB": {
   "impl": "pako",
   "name": "inflate wasm 2MB",
   "ms": 19.488550000000032,
   "min": 19.38550000000032,
   "samples": 26,
   "batch": 2,
   "mbps": 107.60944246749997
  },
  "inflate random 1MB": {
   "impl": "pako",
   "name": "inflate random 1MB",
   "ms": 2.2736363636358874,
   "min": 2.183390909090866,
   "samples": 39,
   "batch": 11,
   "mbps": 461.1889644143309
  },
  "inflate js 9MB": {
   "impl": "pako",
   "name": "inflate js 9MB",
   "ms": 71.28835000000254,
   "min": 70.88190000000031,
   "samples": 14,
   "batch": 1,
   "mbps": 127.82694507587391
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.5194095238094589,
   "min": 0.5110095238094454,
   "samples": 45,
   "batch": 42,
   "mbps": 126.17404378599984
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 7.485899999999674,
   "min": 7.388933333333019,
   "samples": 44,
   "batch": 3,
   "mbps": 142.36070479168123
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 67.8813999999984,
   "min": 67.53929999999673,
   "samples": 15,
   "batch": 1,
   "mbps": 134.24254655914896
  },
  "inflate(L9) js 1MB": {
   "impl": "pako",
   "name": "inflate(L9) js 1MB",
   "ms": 7.936899999998181,
   "min": 7.881299999998494,
   "samples": 40,
   "batch": 3,
   "mbps": 134.27131499706994
  },
  "inflate to:string js 51KB": {
   "impl": "pako",
   "name": "inflate to:string js 51KB",
   "ms": 0.41478431372539204,
   "min": 0.4030078431371972,
   "samples": 47,
   "batch": 51,
   "mbps": 123.86678642340078
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "pako",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 157.99844999999914,
   "min": 155.8156999999992,
   "samples": 10,
   "batch": 1,
   "mbps": 92.05720689032125
  },
  "ungzip lodash-4.17.21.tgz": {
   "impl": "pako",
   "name": "ungzip lodash-4.17.21.tgz",
   "ms": 18.947199999998702,
   "min": 18.721150000001217,
   "samples": 27,
   "batch": 2,
   "mbps": 119.76355345381668
  },
  "ungzip react-dom-19.2.7.tgz": {
   "impl": "pako",
   "name": "ungzip react-dom-19.2.7.tgz",
   "ms": 66.63349999999627,
   "min": 66.20249999999942,
   "samples": 15,
   "batch": 1,
   "mbps": 110.36274546587543
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "pako",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 222.2760999999955,
   "min": 220.51750000000175,
   "samples": 10,
   "batch": 1,
   "mbps": 106.76221150182354
  },
  "ungzip zod-4.4.3.tgz": {
   "impl": "pako",
   "name": "ungzip zod-4.4.3.tgz",
   "ms": 43.47019999999611,
   "min": 43.25939999999537,
   "samples": 23,
   "batch": 1,
   "mbps": 118.25296409955463
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "pako",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 218.10169999999925,
   "min": 215.88120000000345,
   "samples": 10,
   "batch": 1,
   "mbps": 108.80560765917956
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 68.97149999999965,
   "min": 68.71179999999003,
   "samples": 15,
   "batch": 1,
   "mbps": 15.451280601407909
  }
 },
 "fast": {
  "deflate L6 tiny 75B": {
   "impl": "fast",
   "name": "deflate L6 tiny 75B",
   "ms": 0.011928836701256114,
   "min": 0.011644019661387282,
   "samples": 46,
   "batch": 1831,
   "mbps": 6.203454859282947
  },
  "deflate L6 text 1KB": {
   "impl": "fast",
   "name": "deflate L6 text 1KB",
   "ms": 0.030132138442521886,
   "min": 0.029744004944375648,
   "samples": 41,
   "batch": 809,
   "mbps": 33.983648454068934
  },
  "deflate L6 text 16KB": {
   "impl": "fast",
   "name": "deflate L6 text 16KB",
   "ms": 0.33941369863013066,
   "min": 0.3376479452054772,
   "samples": 41,
   "batch": 73,
   "mbps": 48.271475388664676
  },
  "deflate L6 js 51KB": {
   "impl": "fast",
   "name": "deflate L6 js 51KB",
   "ms": 1.3206605263157574,
   "min": 1.316984210526339,
   "samples": 40,
   "batch": 19,
   "mbps": 38.903260130996
  },
  "deflate L6 js 1MB": {
   "impl": "fast",
   "name": "deflate L6 js 1MB",
   "ms": 33.22600000000057,
   "min": 33.09569999999985,
   "samples": 31,
   "batch": 1,
   "mbps": 32.07421898513158
  },
  "deflate L6 json 1MB": {
   "impl": "fast",
   "name": "deflate L6 json 1MB",
   "ms": 15.858250000000226,
   "min": 15.789500000000771,
   "samples": 32,
   "batch": 2,
   "mbps": 66.12747308183344
  },
  "deflate L6 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L6 wasm 2MB",
   "ms": 111.86265000000003,
   "min": 111.75960000000123,
   "samples": 10,
   "batch": 1,
   "mbps": 18.747562300732184
  },
  "deflate L6 random 1MB": {
   "impl": "fast",
   "name": "deflate L6 random 1MB",
   "ms": 32.436899999998786,
   "min": 32.20959999999832,
   "samples": 31,
   "batch": 1,
   "mbps": 32.3266403386279
  },
  "deflate L6 js 9MB": {
   "impl": "fast",
   "name": "deflate L6 js 9MB",
   "ms": 340.9216499999993,
   "min": 340.25350000000253,
   "samples": 10,
   "batch": 1,
   "mbps": 26.72922649529597
  },
  "deflateRaw L1 text 64KB": {
   "impl": "fast",
   "name": "deflateRaw L1 text 64KB",
   "ms": 0.6126719512194985,
   "min": 0.6075609756097525,
   "samples": 40,
   "batch": 41,
   "mbps": 106.96752131308325
  },
  "deflateRaw L1 js 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 1MB",
   "ms": 8.196633333333011,
   "min": 8.15296666666715,
   "samples": 41,
   "batch": 3,
   "mbps": 130.01655151099135
  },
  "deflateRaw L1 json 1MB": {
   "impl": "fast",
   "name": "deflateRaw L1 json 1MB",
   "ms": 4.832466666666733,
   "min": 4.808033333333394,
   "samples": 35,
   "batch": 6,
   "mbps": 217.00429042448695
  },
  "deflateRaw L1 js 9MB": {
   "impl": "fast",
   "name": "deflateRaw L1 js 9MB",
   "ms": 75.71794999999838,
   "min": 75.60770000000048,
   "samples": 14,
   "batch": 1,
   "mbps": 120.34890009568662
  },
  "deflate L9 js 1MB": {
   "impl": "fast",
   "name": "deflate L9 js 1MB",
   "ms": 154.61484999999993,
   "min": 154.53510000000097,
   "samples": 10,
   "batch": 1,
   "mbps": 6.892597961968081
  },
  "deflate L9 wasm 2MB": {
   "impl": "fast",
   "name": "deflate L9 wasm 2MB",
   "ms": 338.0522000000001,
   "min": 336.14450000000215,
   "samples": 10,
   "batch": 1,
   "mbps": 6.203633640011807
  },
  "deflate L3 js 1MB": {
   "impl": "fast",
   "name": "deflate L3 js 1MB",
   "ms": 12.481649999999718,
   "min": 12.431500000000597,
   "samples": 41,
   "batch": 2,
   "mbps": 85.38117957161306
  },
  "deflate L0 js 1MB": {
   "impl": "fast",
   "name": "deflate L0 js 1MB",
   "ms": 0.7935645161290473,
   "min": 0.7343580645161462,
   "samples": 40,
   "batch": 31,
   "mbps": 1342.9254689945071
  },
  "gzip L6 js 1MB": {
   "impl": "fast",
   "name": "gzip L6 js 1MB",
   "ms": 33.64280000000144,
   "min": 33.370999999999185,
   "samples": 30,
   "batch": 1,
   "mbps": 31.676852105055296
  },
  "inflate tiny 75B": {
   "impl": "fast",
   "name": "inflate tiny 75B",
   "ms": 0.0017859932576877726,
   "min": 0.0017688620292716278,
   "samples": 46,
   "batch": 12162,
   "mbps": 41.43352707602252
  },
  "inflate text 1KB": {
   "impl": "fast",
   "name": "inflate text 1KB",
   "ms": 0.016846175243396103,
   "min": 0.016573226703756504,
   "samples": 42,
   "batch": 1438,
   "mbps": 60.78531092103057
  },
  "inflate text 16KB": {
   "impl": "fast",
   "name": "inflate text 16KB",
   "ms": 0.05170438413361259,
   "min": 0.04360793319415707,
   "samples": 39,
   "batch": 479,
   "mbps": 316.87835131467887
  },
  "inflate js 51KB": {
   "impl": "fast",
   "name": "inflate js 51KB",
   "ms": 0.13350497237567868,
   "min": 0.1284640883977923,
   "samples": 40,
   "batch": 181,
   "mbps": 384.8395987486067
  },
  "inflate js 1MB": {
   "impl": "fast",
   "name": "inflate js 1MB",
   "ms": 2.424709090908767,
   "min": 2.3910727272728267,
   "samples": 37,
   "batch": 11,
   "mbps": 439.51581820505425
  },
  "inflate json 1MB": {
   "impl": "fast",
   "name": "inflate json 1MB",
   "ms": 1.6373066666667,
   "min": 1.6141799999997601,
   "samples": 40,
   "batch": 15,
   "mbps": 640.482336845864
  },
  "inflate wasm 2MB": {
   "impl": "fast",
   "name": "inflate wasm 2MB",
   "ms": 6.466112500000236,
   "min": 6.378099999999904,
   "samples": 38,
   "batch": 4,
   "mbps": 324.3296493836016
  },
  "inflate random 1MB": {
   "impl": "fast",
   "name": "inflate random 1MB",
   "ms": 0.7251222222221259,
   "min": 0.6480388888889542,
   "samples": 38,
   "batch": 36,
   "mbps": 1446.067942569261
  },
  "inflate js 9MB": {
   "impl": "fast",
   "name": "inflate js 9MB",
   "ms": 22.831574999998338,
   "min": 22.512000000002445,
   "samples": 22,
   "batch": 2,
   "mbps": 399.12147979281605
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "fast",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.20155483870967733,
   "min": 0.19560967741932883,
   "samples": 39,
   "batch": 124,
   "mbps": 325.1522038347045
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 2.5652399999999034,
   "min": 2.526280000000406,
   "samples": 39,
   "batch": 10,
   "mbps": 415.4379317334987
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "fast",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 24.59560000000056,
   "min": 24.396499999995285,
   "samples": 41,
   "batch": 1,
   "mbps": 370.4960236790236
  },
  "inflate(L9) js 1MB": {
   "impl": "fast",
   "name": "inflate(L9) js 1MB",
   "ms": 2.4012363636370124,
   "min": 2.3918272727268315,
   "samples": 37,
   "batch": 11,
   "mbps": 443.8122028044959
  },
  "inflate to:string js 51KB": {
   "impl": "fast",
   "name": "inflate to:string js 51KB",
   "ms": 0.14911871165643514,
   "min": 0.14687177914110308,
   "samples": 42,
   "batch": 163,
   "mbps": 344.54428575250375
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "fast",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 54.53979999999865,
   "min": 53.96190000000206,
   "samples": 19,
   "batch": 1,
   "mbps": 266.68407291556554
  },
  "ungzip lodash-4.17.21.tgz": {
   "impl": "fast",
   "name": "ungzip lodash-4.17.21.tgz",
   "ms": 5.423399999999674,
   "min": 5.404480000000331,
   "samples": 37,
   "batch": 5,
   "mbps": 418.40616587383124
  },
  "ungzip react-dom-19.2.7.tgz": {
   "impl": "fast",
   "name": "ungzip react-dom-19.2.7.tgz",
   "ms": 20.440150000002177,
   "min": 20.240300000001298,
   "samples": 25,
   "batch": 2,
   "mbps": 359.7750505744438
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "fast",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 70.80674999999974,
   "min": 70.19750000000204,
   "samples": 14,
   "batch": 1,
   "mbps": 335.1472564409479
  },
  "ungzip zod-4.4.3.tgz": {
   "impl": "fast",
   "name": "ungzip zod-4.4.3.tgz",
   "ms": 13.089899999997215,
   "min": 12.985099999998056,
   "samples": 38,
   "batch": 2,
   "mbps": 392.7058266297751
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "fast",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 86.521850000001,
   "min": 83.1849000000002,
   "samples": 12,
   "batch": 1,
   "mbps": 274.2739319605363
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "fast",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 33.57040000000052,
   "min": 33.44720000000234,
   "samples": 30,
   "batch": 1,
   "mbps": 31.745168362604662
  }
 }
}
```
