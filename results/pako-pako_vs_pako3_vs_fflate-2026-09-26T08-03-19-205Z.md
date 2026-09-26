| case                                | pako                   | pako3                         | fflate                        |
|-------------------------------------|------------------------|-------------------------------|-------------------------------|
| deflate L6 tiny 75B                 | 215.9 µs (0.3 MB/s)    | 241.6 µs (0.3 MB/s)  x0.89    | 103.0 µs (0.7 MB/s)  x2.10    |
| deflate L6 text 1KB                 | 245.7 µs (4.2 MB/s)    | 275.7 µs (3.7 MB/s)  x0.89    | 120.3 µs (8.5 MB/s)  x2.04    |
| deflate L6 text 16KB                | 849.4 µs (19.3 MB/s)   | 927.4 µs (17.7 MB/s)  x0.92   | 498.8 µs (32.8 MB/s)  x1.70   |
| deflate L6 js 51KB                  | 2.60 ms (19.7 MB/s)    | 3.00 ms (17.1 MB/s)  x0.87    | 1.91 ms (27.0 MB/s)  x1.37    |
| deflate L6 js 1MB                   | 69.45 ms (15.3 MB/s)   | 75.90 ms (14.0 MB/s)  x0.92   | 56.01 ms (19.0 MB/s)  x1.24   |
| deflate L6 json 1MB                 | 39.43 ms (26.6 MB/s)   | 43.29 ms (24.2 MB/s)  x0.91   | 50.22 ms (20.9 MB/s)  x0.79   |
| deflate L6 wasm 2MB                 | 223.28 ms (9.4 MB/s)   | 237.12 ms (8.8 MB/s)  x0.94   | 148.89 ms (14.1 MB/s)  x1.50  |
| deflate L6 random 1MB               | 70.92 ms (14.8 MB/s)   | 72.29 ms (14.5 MB/s)  x0.98   | 86.36 ms (12.1 MB/s)  x0.82   |
| deflate L6 js 9MB                   | 692.43 ms (13.2 MB/s)  | 714.13 ms (12.8 MB/s)  x0.97  | 581.88 ms (15.7 MB/s)  x1.19  |
| deflateRaw L1 text 64KB             | 1.66 ms (39.4 MB/s)    | 1.93 ms (33.9 MB/s)  x0.86    | 1.55 ms (42.4 MB/s)  x1.07    |
| deflateRaw L1 js 1MB                | 24.90 ms (42.8 MB/s)   | 25.66 ms (41.5 MB/s)  x0.97   | 23.60 ms (45.1 MB/s)  x1.05   |
| deflateRaw L1 json 1MB              | 17.69 ms (59.3 MB/s)   | 18.47 ms (56.8 MB/s)  x0.96   | 19.28 ms (54.4 MB/s)  x0.92   |
| deflateRaw L1 js 9MB                | 229.08 ms (39.8 MB/s)  | 241.39 ms (37.8 MB/s)  x0.95  | 209.86 ms (43.4 MB/s)  x1.09  |
| deflate L9 js 1MB                   | 281.81 ms (3.8 MB/s)   | 285.24 ms (3.7 MB/s)  x0.99   | 106.36 ms (10.0 MB/s)  x2.65  |
| deflate L9 wasm 2MB                 | 569.31 ms (3.7 MB/s)   | 598.53 ms (3.5 MB/s)  x0.95   | 134.27 ms (15.6 MB/s)  x4.24  |
| deflate L3 js 1MB                   | 33.35 ms (32.0 MB/s)   | 34.18 ms (31.2 MB/s)  x0.98   | 29.48 ms (36.2 MB/s)  x1.13   |
| deflate L0 js 1MB                   | 2.48 ms (429.0 MB/s)   | 2.65 ms (402.9 MB/s)  x0.94   | 3.56 ms (299.2 MB/s)  x0.70   |
| gzip L6 js 1MB                      | 70.76 ms (15.1 MB/s)   | 73.22 ms (14.6 MB/s)  x0.97   | 46.96 ms (22.7 MB/s)  x1.51   |
| inflate tiny 75B                    | 20.3 µs (3.6 MB/s)     | 20.3 µs (3.7 MB/s)  x1.00     | 61.8 µs (1.2 MB/s)  x0.33     |
| inflate text 1KB                    | 36.3 µs (28.2 MB/s)    | 30.2 µs (33.9 MB/s)  x1.20    | 73.1 µs (14.0 MB/s)  x0.50    |
| inflate text 16KB                   | 148.8 µs (110.1 MB/s)  | 146.3 µs (112.0 MB/s)  x1.02  | 242.4 µs (67.6 MB/s)  x0.61   |
| inflate js 51KB                     | 383.1 µs (134.1 MB/s)  | 373.2 µs (137.7 MB/s)  x1.03  | 503.3 µs (102.1 MB/s)  x0.76  |
| inflate js 1MB                      | 7.99 ms (133.3 MB/s)   | 8.05 ms (132.5 MB/s)  x0.99   | 9.95 ms (107.1 MB/s)  x0.80   |
| inflate json 1MB                    | 6.46 ms (162.4 MB/s)   | 6.57 ms (159.7 MB/s)  x0.98   | 8.16 ms (128.6 MB/s)  x0.79   |
| inflate wasm 2MB                    | 19.58 ms (107.1 MB/s)  | 19.83 ms (105.7 MB/s)  x0.99  | 23.52 ms (89.2 MB/s)  x0.83   |
| inflate random 1MB                  | 2.26 ms (463.3 MB/s)   | 2.20 ms (476.2 MB/s)  x1.03   | 815.7 µs (1285.5 MB/s)  x2.77 |
| inflate js 9MB                      | 72.08 ms (126.4 MB/s)  | 89.71 ms (101.6 MB/s)  x0.80  | 87.29 ms (104.4 MB/s)  x0.83  |
| inflateRaw(L1) text 64KB            | 518.0 µs (126.5 MB/s)  | 663.1 µs (98.8 MB/s)  x0.78   | 784.0 µs (83.6 MB/s)  x0.66   |
| inflateRaw(L1) js 1MB               | 7.62 ms (139.9 MB/s)   | 7.61 ms (140.0 MB/s)  x1.00   | 16.72 ms (63.8 MB/s)  x0.46   |
| inflateRaw(L1) js 9MB               | 67.60 ms (134.8 MB/s)  | 70.42 ms (129.4 MB/s)  x0.96  | 152.38 ms (59.8 MB/s)  x0.44  |
| inflate(L9) js 1MB                  | 7.94 ms (134.3 MB/s)   | 8.06 ms (132.2 MB/s)  x0.98   | 10.30 ms (103.4 MB/s)  x0.77  |
| inflate to:string js 51KB           | 523.8 µs (98.1 MB/s)   | 422.2 µs (121.7 MB/s)  x1.24  | 621.9 µs (82.6 MB/s)  x0.84   |
| ungzip esbuild-wasm-0.28.2.tgz      | 165.33 ms (88.0 MB/s)  | 159.50 ms (91.2 MB/s)  x1.04  | 187.49 ms (77.6 MB/s)  x0.88  |
| ungzip lodash-4.17.21.tgz           | 19.64 ms (115.6 MB/s)  | 19.30 ms (117.6 MB/s)  x1.02  | 17.70 ms (128.2 MB/s)  x1.11  |
| ungzip react-dom-19.2.7.tgz         | 68.68 ms (107.1 MB/s)  | 68.09 ms (108.0 MB/s)  x1.01  | 63.52 ms (115.8 MB/s)  x1.08  |
| ungzip typescript-5.9.3.tgz         | 221.09 ms (107.3 MB/s) | 235.42 ms (100.8 MB/s)  x0.94 | 220.74 ms (107.5 MB/s)  x1.00 |
| ungzip zod-4.4.3.tgz                | 43.69 ms (117.7 MB/s)  | 44.16 ms (116.4 MB/s)  x0.99  | 40.36 ms (127.4 MB/s)  x1.08  |
| Inflate stream 16KB pushes (ts tgz) | 255.32 ms (92.9 MB/s)  | 221.53 ms (107.1 MB/s)  x1.15 | -                             |
| Deflate stream 64KB pushes js 1MB   | 71.39 ms (14.9 MB/s)   | 90.24 ms (11.8 MB/s)  x0.79   | -                             |

```json
{
 "pako": {
  "deflate L6 tiny 75B": {
   "impl": "pako",
   "name": "deflate L6 tiny 75B",
   "ms": 0.2158979999999997,
   "min": 0.2004529999999977,
   "samples": 34,
   "batch": 100,
   "mbps": 0.3427544488601103
  },
  "deflate L6 text 1KB": {
   "impl": "pako",
   "name": "deflate L6 text 1KB",
   "ms": 0.2456715116279082,
   "min": 0.1303837209302401,
   "samples": 42,
   "batch": 86,
   "mbps": 4.1681674574907195
  },
  "deflate L6 text 16KB": {
   "impl": "pako",
   "name": "deflate L6 text 16KB",
   "ms": 0.849442307692313,
   "min": 0.7453230769230965,
   "samples": 37,
   "batch": 26,
   "mbps": 19.28794910687996
  },
  "deflate L6 js 51KB": {
   "impl": "pako",
   "name": "deflate L6 js 51KB",
   "ms": 2.6041055555555834,
   "min": 2.554066666666687,
   "samples": 34,
   "batch": 9,
   "mbps": 19.72961498829818
  },
  "deflate L6 js 1MB": {
   "impl": "pako",
   "name": "deflate L6 js 1MB",
   "ms": 69.45059999999967,
   "min": 69.16730000000098,
   "samples": 12,
   "batch": 1,
   "mbps": 15.344691046585705
  },
  "deflate L6 json 1MB": {
   "impl": "pako",
   "name": "deflate L6 json 1MB",
   "ms": 39.42610000000059,
   "min": 39.122299999999086,
   "samples": 21,
   "batch": 1,
   "mbps": 26.598268659593124
  },
  "deflate L6 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L6 wasm 2MB",
   "ms": 223.27630000000045,
   "min": 222.17330000000038,
   "samples": 10,
   "batch": 1,
   "mbps": 9.392631461556805
  },
  "deflate L6 random 1MB": {
   "impl": "pako",
   "name": "deflate L6 random 1MB",
   "ms": 70.91924999999992,
   "min": 69.58359999999993,
   "samples": 12,
   "batch": 1,
   "mbps": 14.785491950352
  },
  "deflate L6 js 9MB": {
   "impl": "pako",
   "name": "deflate L6 js 9MB",
   "ms": 692.4349999999977,
   "min": 688.5465999999997,
   "samples": 5,
   "batch": 1,
   "mbps": 13.160183988388846
  },
  "deflateRaw L1 text 64KB": {
   "impl": "pako",
   "name": "deflateRaw L1 text 64KB",
   "ms": 1.6624714285714748,
   "min": 1.610492857142942,
   "samples": 33,
   "batch": 14,
   "mbps": 39.42082785525743
  },
  "deflateRaw L1 js 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 1MB",
   "ms": 24.901200000000244,
   "min": 24.5496000000021,
   "samples": 33,
   "batch": 1,
   "mbps": 42.79705395723859
  },
  "deflateRaw L1 json 1MB": {
   "impl": "pako",
   "name": "deflateRaw L1 json 1MB",
   "ms": 17.685999999999694,
   "min": 17.59100000000035,
   "samples": 23,
   "batch": 2,
   "mbps": 59.293565532060285
  },
  "deflateRaw L1 js 9MB": {
   "impl": "pako",
   "name": "deflateRaw L1 js 9MB",
   "ms": 229.07719999999972,
   "min": 226.14570000000094,
   "samples": 10,
   "batch": 1,
   "mbps": 39.77948045462408
  },
  "deflate L9 js 1MB": {
   "impl": "pako",
   "name": "deflate L9 js 1MB",
   "ms": 281.8065999999999,
   "min": 276.66709999999875,
   "samples": 10,
   "batch": 1,
   "mbps": 3.7816644464678983
  },
  "deflate L9 wasm 2MB": {
   "impl": "pako",
   "name": "deflate L9 wasm 2MB",
   "ms": 569.3135500000026,
   "min": 567.5096000000049,
   "samples": 6,
   "batch": 1,
   "mbps": 3.6836502486195704
  },
  "deflate L3 js 1MB": {
   "impl": "pako",
   "name": "deflate L3 js 1MB",
   "ms": 33.34834999999657,
   "min": 32.910900000002584,
   "samples": 24,
   "batch": 1,
   "mbps": 31.956543577121796
  },
  "deflate L0 js 1MB": {
   "impl": "pako",
   "name": "deflate L0 js 1MB",
   "ms": 2.4842600000003587,
   "min": 2.399289999999746,
   "samples": 31,
   "batch": 10,
   "mbps": 428.9800584479266
  },
  "gzip L6 js 1MB": {
   "impl": "pako",
   "name": "gzip L6 js 1MB",
   "ms": 70.76425000000017,
   "min": 70.2922000000035,
   "samples": 12,
   "batch": 1,
   "mbps": 15.059836004762253
  },
  "inflate tiny 75B": {
   "impl": "pako",
   "name": "inflate tiny 75B",
   "ms": 0.02028065268064778,
   "min": 0.013387412587414447,
   "samples": 43,
   "batch": 858,
   "mbps": 3.648797756425873
  },
  "inflate text 1KB": {
   "impl": "pako",
   "name": "inflate text 1KB",
   "ms": 0.03629820466786038,
   "min": 0.02812262118491334,
   "samples": 39,
   "batch": 557,
   "mbps": 28.21076164427171
  },
  "inflate text 16KB": {
   "impl": "pako",
   "name": "inflate text 16KB",
   "ms": 0.14884648437498527,
   "min": 0.14576328124996962,
   "samples": 40,
   "batch": 128,
   "mbps": 110.07314058371841
  },
  "inflate js 51KB": {
   "impl": "pako",
   "name": "inflate js 51KB",
   "ms": 0.38310294117649857,
   "min": 0.3787705882353418,
   "samples": 40,
   "batch": 51,
   "mbps": 134.1101685155942
  },
  "inflate js 1MB": {
   "impl": "pako",
   "name": "inflate js 1MB",
   "ms": 7.992100000000695,
   "min": 7.927466666665471,
   "samples": 34,
   "batch": 3,
   "mbps": 133.34392712802733
  },
  "inflate json 1MB": {
   "impl": "pako",
   "name": "inflate json 1MB",
   "ms": 6.456575000000157,
   "min": 6.374149999999645,
   "samples": 31,
   "batch": 4,
   "mbps": 162.418310017304
  },
  "inflate wasm 2MB": {
   "impl": "pako",
   "name": "inflate wasm 2MB",
   "ms": 19.576349999999366,
   "min": 19.313050000000658,
   "samples": 21,
   "batch": 2,
   "mbps": 107.12681373187893
  },
  "inflate random 1MB": {
   "impl": "pako",
   "name": "inflate random 1MB",
   "ms": 2.2630818181814076,
   "min": 2.1893181818185523,
   "samples": 31,
   "batch": 11,
   "mbps": 463.3398543419107
  },
  "inflate js 9MB": {
   "impl": "pako",
   "name": "inflate js 9MB",
   "ms": 72.08439999999973,
   "min": 71.09169999999722,
   "samples": 11,
   "batch": 1,
   "mbps": 126.41531316068433
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "pako",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.5179589743590137,
   "min": 0.509071794871908,
   "samples": 39,
   "batch": 39,
   "mbps": 126.52739549710925
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 7.620166666665075,
   "min": 7.465300000001055,
   "samples": 34,
   "batch": 3,
   "mbps": 139.85232169028097
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "pako",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 67.59664999999586,
   "min": 66.93579999999929,
   "samples": 12,
   "batch": 1,
   "mbps": 134.80804152277602
  },
  "inflate(L9) js 1MB": {
   "impl": "pako",
   "name": "inflate(L9) js 1MB",
   "ms": 7.936933333333096,
   "min": 7.811466666666092,
   "samples": 34,
   "batch": 3,
   "mbps": 134.2707510877457
  },
  "inflate to:string js 51KB": {
   "impl": "pako",
   "name": "inflate to:string js 51KB",
   "ms": 0.5238072916666472,
   "min": 0.4196624999999585,
   "samples": 32,
   "batch": 48,
   "mbps": 98.085690706072
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "pako",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 165.33240000000296,
   "min": 155.09249999999884,
   "samples": 10,
   "batch": 1,
   "mbps": 87.97365791580924
  },
  "ungzip lodash-4.17.21.tgz": {
   "impl": "pako",
   "name": "ungzip lodash-4.17.21.tgz",
   "ms": 19.63600000000224,
   "min": 18.955949999999575,
   "samples": 21,
   "batch": 2,
   "mbps": 115.56243634140054
  },
  "ungzip react-dom-19.2.7.tgz": {
   "impl": "pako",
   "name": "ungzip react-dom-19.2.7.tgz",
   "ms": 68.68025000000125,
   "min": 66.34679999999935,
   "samples": 12,
   "batch": 1,
   "mbps": 107.07380942847277
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "pako",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 221.08700000000317,
   "min": 220.370600000002,
   "samples": 10,
   "batch": 1,
   "mbps": 107.33642412262893
  },
  "ungzip zod-4.4.3.tgz": {
   "impl": "pako",
   "name": "ungzip zod-4.4.3.tgz",
   "ms": 43.69079999999667,
   "min": 42.88040000000183,
   "samples": 19,
   "batch": 1,
   "mbps": 117.6558909427246
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "pako",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 255.3223999999973,
   "min": 219.42039999999542,
   "samples": 10,
   "batch": 1,
   "mbps": 92.94401117959197
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "pako",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 71.39100000000326,
   "min": 70.09910000000673,
   "samples": 11,
   "batch": 1,
   "mbps": 14.927623930186598
  }
 },
 "pako3": {
  "deflate L6 tiny 75B": {
   "impl": "pako3",
   "name": "deflate L6 tiny 75B",
   "ms": 0.24159787234042537,
   "min": 0.20782127659574742,
   "samples": 33,
   "batch": 94,
   "mbps": 0.30629408811899517
  },
  "deflate L6 text 1KB": {
   "impl": "pako3",
   "name": "deflate L6 text 1KB",
   "ms": 0.2756791139240474,
   "min": 0.1456227848101305,
   "samples": 38,
   "batch": 79,
   "mbps": 3.714463476845486
  },
  "deflate L6 text 16KB": {
   "impl": "pako3",
   "name": "deflate L6 text 16KB",
   "ms": 0.9273624999999962,
   "min": 0.8033791666666351,
   "samples": 37,
   "batch": 24,
   "mbps": 17.667309169823092
  },
  "deflate L6 js 51KB": {
   "impl": "pako3",
   "name": "deflate L6 js 51KB",
   "ms": 3.0037187500000186,
   "min": 2.732925000000023,
   "samples": 30,
   "batch": 8,
   "mbps": 17.104797178497382
  },
  "deflate L6 js 1MB": {
   "impl": "pako3",
   "name": "deflate L6 js 1MB",
   "ms": 75.90009999999893,
   "min": 71.03389999999945,
   "samples": 11,
   "batch": 1,
   "mbps": 14.040798365219743
  },
  "deflate L6 json 1MB": {
   "impl": "pako3",
   "name": "deflate L6 json 1MB",
   "ms": 43.28979999999956,
   "min": 42.17590000000018,
   "samples": 16,
   "batch": 1,
   "mbps": 24.22432074068281
  },
  "deflate L6 wasm 2MB": {
   "impl": "pako3",
   "name": "deflate L6 wasm 2MB",
   "ms": 237.1238999999996,
   "min": 234.09950000000026,
   "samples": 10,
   "batch": 1,
   "mbps": 8.844119044938125
  },
  "deflate L6 random 1MB": {
   "impl": "pako3",
   "name": "deflate L6 random 1MB",
   "ms": 72.29380000000128,
   "min": 71.82229999999981,
   "samples": 11,
   "batch": 1,
   "mbps": 14.504369669321315
  },
  "deflate L6 js 9MB": {
   "impl": "pako3",
   "name": "deflate L6 js 9MB",
   "ms": 714.132800000003,
   "min": 706.5075999999972,
   "samples": 5,
   "batch": 1,
   "mbps": 12.760332531988395
  },
  "deflateRaw L1 text 64KB": {
   "impl": "pako3",
   "name": "deflateRaw L1 text 64KB",
   "ms": 1.931865384615426,
   "min": 1.7971846153847695,
   "samples": 32,
   "batch": 13,
   "mbps": 33.92368874244629
  },
  "deflateRaw L1 js 1MB": {
   "impl": "pako3",
   "name": "deflateRaw L1 js 1MB",
   "ms": 25.66359999999986,
   "min": 25.26720000000205,
   "samples": 29,
   "batch": 1,
   "mbps": 41.52566280646542
  },
  "deflateRaw L1 json 1MB": {
   "impl": "pako3",
   "name": "deflateRaw L1 json 1MB",
   "ms": 18.47310000000016,
   "min": 18.25855000000047,
   "samples": 22,
   "batch": 2,
   "mbps": 56.767191213168935
  },
  "deflateRaw L1 js 9MB": {
   "impl": "pako3",
   "name": "deflateRaw L1 js 9MB",
   "ms": 241.39019999999982,
   "min": 239.13480000000345,
   "samples": 10,
   "batch": 1,
   "mbps": 37.750380918529444
  },
  "deflate L9 js 1MB": {
   "impl": "pako3",
   "name": "deflate L9 js 1MB",
   "ms": 285.2381499999992,
   "min": 281.71679999999833,
   "samples": 10,
   "batch": 1,
   "mbps": 3.736169232621944
  },
  "deflate L9 wasm 2MB": {
   "impl": "pako3",
   "name": "deflate L9 wasm 2MB",
   "ms": 598.5312500000018,
   "min": 584.1489999999976,
   "samples": 6,
   "batch": 1,
   "mbps": 3.503830418211235
  },
  "deflate L3 js 1MB": {
   "impl": "pako3",
   "name": "deflate L3 js 1MB",
   "ms": 34.18104999999923,
   "min": 33.7783999999956,
   "samples": 24,
   "batch": 1,
   "mbps": 31.178035782985717
  },
  "deflate L0 js 1MB": {
   "impl": "pako3",
   "name": "deflate L0 js 1MB",
   "ms": 2.645211111110661,
   "min": 2.4483555555553824,
   "samples": 33,
   "batch": 9,
   "mbps": 402.8782411822469
  },
  "gzip L6 js 1MB": {
   "impl": "pako3",
   "name": "gzip L6 js 1MB",
   "ms": 73.21719999999914,
   "min": 72.67710000000079,
   "samples": 11,
   "batch": 1,
   "mbps": 14.555295750179091
  },
  "inflate tiny 75B": {
   "impl": "pako3",
   "name": "inflate tiny 75B",
   "ms": 0.020268918918918858,
   "min": 0.013072855464159813,
   "samples": 46,
   "batch": 851,
   "mbps": 3.650910060670722
  },
  "inflate text 1KB": {
   "impl": "pako3",
   "name": "inflate text 1KB",
   "ms": 0.03018876543210354,
   "min": 0.027304197530862932,
   "samples": 58,
   "batch": 405,
   "mbps": 33.91990316076493
  },
  "inflate text 16KB": {
   "impl": "pako3",
   "name": "inflate text 16KB",
   "ms": 0.14625206896551013,
   "min": 0.1413041379310267,
   "samples": 36,
   "batch": 145,
   "mbps": 112.02576562430549
  },
  "inflate js 51KB": {
   "impl": "pako3",
   "name": "inflate js 51KB",
   "ms": 0.3732269230769396,
   "min": 0.36815961538461406,
   "samples": 38,
   "batch": 52,
   "mbps": 137.6588794196087
  },
  "inflate js 1MB": {
   "impl": "pako3",
   "name": "inflate js 1MB",
   "ms": 8.04599999999967,
   "min": 7.915966666667373,
   "samples": 33,
   "batch": 3,
   "mbps": 132.45065871240908
  },
  "inflate json 1MB": {
   "impl": "pako3",
   "name": "inflate json 1MB",
   "ms": 6.5669249999991735,
   "min": 6.403125000000728,
   "samples": 29,
   "batch": 4,
   "mbps": 159.6890477659075
  },
  "inflate wasm 2MB": {
   "impl": "pako3",
   "name": "inflate wasm 2MB",
   "ms": 19.832699999999022,
   "min": 19.366649999999936,
   "samples": 20,
   "batch": 2,
   "mbps": 105.74213294206554
  },
  "inflate random 1MB": {
   "impl": "pako3",
   "name": "inflate random 1MB",
   "ms": 2.2021272727275076,
   "min": 2.137909090909075,
   "samples": 33,
   "batch": 11,
   "mbps": 476.1650305076401
  },
  "inflate js 9MB": {
   "impl": "pako3",
   "name": "inflate js 9MB",
   "ms": 89.70895000000019,
   "min": 78.6562999999951,
   "samples": 10,
   "batch": 1,
   "mbps": 101.57929615718366
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "pako3",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.6630838709677318,
   "min": 0.529935483870964,
   "samples": 37,
   "batch": 31,
   "mbps": 98.8351592753328
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "pako3",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 7.611466666666577,
   "min": 7.468466666665336,
   "samples": 35,
   "batch": 3,
   "mbps": 140.01217461374233
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "pako3",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 70.42435000000114,
   "min": 68.57819999999629,
   "samples": 12,
   "batch": 1,
   "mbps": 129.39518788600608
  },
  "inflate(L9) js 1MB": {
   "impl": "pako3",
   "name": "inflate(L9) js 1MB",
   "ms": 8.061466666666092,
   "min": 7.962533333333947,
   "samples": 33,
   "batch": 3,
   "mbps": 132.19653991830387
  },
  "inflate to:string js 51KB": {
   "impl": "pako3",
   "name": "inflate to:string js 51KB",
   "ms": 0.4221568627450752,
   "min": 0.4151352941175277,
   "samples": 37,
   "batch": 51,
   "mbps": 121.70357640502284
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "pako3",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 159.4972000000016,
   "min": 157.26630000000296,
   "samples": 10,
   "batch": 1,
   "mbps": 91.19217139861924
  },
  "ungzip lodash-4.17.21.tgz": {
   "impl": "pako3",
   "name": "ungzip lodash-4.17.21.tgz",
   "ms": 19.29724999999962,
   "min": 19.1237000000001,
   "samples": 21,
   "batch": 2,
   "mbps": 117.59105572037699
  },
  "ungzip react-dom-19.2.7.tgz": {
   "impl": "pako3",
   "name": "ungzip react-dom-19.2.7.tgz",
   "ms": 68.08815000000322,
   "min": 67.42079999999987,
   "samples": 12,
   "batch": 1,
   "mbps": 108.00493184202615
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "pako3",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 235.41534999999567,
   "min": 227.92389999999432,
   "samples": 10,
   "batch": 1,
   "mbps": 100.80348626374804
  },
  "ungzip zod-4.4.3.tgz": {
   "impl": "pako3",
   "name": "ungzip zod-4.4.3.tgz",
   "ms": 44.15689999999813,
   "min": 43.562599999997474,
   "samples": 18,
   "batch": 1,
   "mbps": 116.41396927773955
  },
  "Inflate stream 16KB pushes (ts tgz)": {
   "impl": "pako3",
   "name": "Inflate stream 16KB pushes (ts tgz)",
   "ms": 221.5332999999955,
   "min": 220.06560000000172,
   "samples": 10,
   "batch": 1,
   "mbps": 107.12018464041515
  },
  "Deflate stream 64KB pushes js 1MB": {
   "impl": "pako3",
   "name": "Deflate stream 64KB pushes js 1MB",
   "ms": 90.24305000000459,
   "min": 73.09339999999793,
   "samples": 10,
   "batch": 1,
   "mbps": 11.809197494986549
  }
 },
 "fflate": {
  "deflate L6 tiny 75B": {
   "impl": "fflate",
   "name": "deflate L6 tiny 75B",
   "ms": 0.10297617801047065,
   "min": 0.033609947643978906,
   "samples": 36,
   "batch": 191,
   "mbps": 0.7186128037542396
  },
  "deflate L6 text 1KB": {
   "impl": "fflate",
   "name": "deflate L6 text 1KB",
   "ms": 0.12031918238993876,
   "min": 0.0696918238993719,
   "samples": 42,
   "batch": 159,
   "mbps": 8.510696130575004
  },
  "deflate L6 text 16KB": {
   "impl": "fflate",
   "name": "deflate L6 text 16KB",
   "ms": 0.4988499999999899,
   "min": 0.4932767441860474,
   "samples": 36,
   "batch": 43,
   "mbps": 32.84354014232802
  },
  "deflate L6 js 51KB": {
   "impl": "fflate",
   "name": "deflate L6 js 51KB",
   "ms": 1.906365384615408,
   "min": 1.7634153846153753,
   "samples": 32,
   "batch": 13,
   "mbps": 26.950762122847213
  },
  "deflate L6 js 1MB": {
   "impl": "fflate",
   "name": "deflate L6 js 1MB",
   "ms": 56.01260000000002,
   "min": 53.920099999999366,
   "samples": 15,
   "batch": 1,
   "mbps": 19.026040569443296
  },
  "deflate L6 json 1MB": {
   "impl": "fflate",
   "name": "deflate L6 json 1MB",
   "ms": 50.217099999999846,
   "min": 47.39500000000044,
   "samples": 11,
   "batch": 1,
   "mbps": 20.882647544362445
  },
  "deflate L6 wasm 2MB": {
   "impl": "fflate",
   "name": "deflate L6 wasm 2MB",
   "ms": 148.89490000000023,
   "min": 140.28850000000057,
   "samples": 10,
   "batch": 1,
   "mbps": 14.084780606991888
  },
  "deflate L6 random 1MB": {
   "impl": "fflate",
   "name": "deflate L6 random 1MB",
   "ms": 86.36105000000043,
   "min": 69.88999999999942,
   "samples": 10,
   "batch": 1,
   "mbps": 12.141769929846784
  },
  "deflate L6 js 9MB": {
   "impl": "fflate",
   "name": "deflate L6 js 9MB",
   "ms": 581.8843499999994,
   "min": 519.885199999997,
   "samples": 6,
   "batch": 1,
   "mbps": 15.660452115613712
  },
  "deflateRaw L1 text 64KB": {
   "impl": "fflate",
   "name": "deflateRaw L1 text 64KB",
   "ms": 1.5467200000000352,
   "min": 1.4979666666668587,
   "samples": 34,
   "batch": 15,
   "mbps": 42.37095272576711
  },
  "deflateRaw L1 js 1MB": {
   "impl": "fflate",
   "name": "deflateRaw L1 js 1MB",
   "ms": 23.604199999997945,
   "min": 22.91229999999996,
   "samples": 27,
   "batch": 1,
   "mbps": 45.14865998424403
  },
  "deflateRaw L1 json 1MB": {
   "impl": "fflate",
   "name": "deflateRaw L1 json 1MB",
   "ms": 19.284850000000006,
   "min": 18.20494999999937,
   "samples": 19,
   "batch": 2,
   "mbps": 54.377711001122634
  },
  "deflateRaw L1 js 9MB": {
   "impl": "fflate",
   "name": "deflateRaw L1 js 9MB",
   "ms": 209.85930000000008,
   "min": 200.7622999999985,
   "samples": 10,
   "batch": 1,
   "mbps": 43.42229293626728
  },
  "deflate L9 js 1MB": {
   "impl": "fflate",
   "name": "deflate L9 js 1MB",
   "ms": 106.35660000000098,
   "min": 104.10789999999906,
   "samples": 10,
   "batch": 1,
   "mbps": 10.020045770549173
  },
  "deflate L9 wasm 2MB": {
   "impl": "fflate",
   "name": "deflate L9 wasm 2MB",
   "ms": 134.26544999999714,
   "min": 131.41330000000016,
   "samples": 10,
   "batch": 1,
   "mbps": 15.619446402630345
  },
  "deflate L3 js 1MB": {
   "impl": "fflate",
   "name": "deflate L3 js 1MB",
   "ms": 29.475500000000466,
   "min": 28.77610000000277,
   "samples": 27,
   "batch": 1,
   "mbps": 36.155383284422086
  },
  "deflate L0 js 1MB": {
   "impl": "fflate",
   "name": "deflate L0 js 1MB",
   "ms": 3.562321428571522,
   "min": 3.5106142857143174,
   "samples": 32,
   "batch": 7,
   "mbps": 299.1582936487966
  },
  "gzip L6 js 1MB": {
   "impl": "fflate",
   "name": "gzip L6 js 1MB",
   "ms": 46.958300000002055,
   "min": 45.82600000000093,
   "samples": 17,
   "batch": 1,
   "mbps": 22.694560918941985
  },
  "inflate tiny 75B": {
   "impl": "fflate",
   "name": "inflate tiny 75B",
   "ms": 0.061846570397110126,
   "min": 0.05120830324910329,
   "samples": 43,
   "batch": 277,
   "mbps": 1.1965093541138017
  },
  "inflate text 1KB": {
   "impl": "fflate",
   "name": "inflate text 1KB",
   "ms": 0.07310485074627487,
   "min": 0.06859552238806352,
   "samples": 35,
   "batch": 268,
   "mbps": 14.007278443861386
  },
  "inflate text 16KB": {
   "impl": "fflate",
   "name": "inflate text 16KB",
   "ms": 0.24235257731962737,
   "min": 0.199912371133999,
   "samples": 31,
   "batch": 97,
   "mbps": 67.60398499245963
  },
  "inflate js 51KB": {
   "impl": "fflate",
   "name": "inflate js 51KB",
   "ms": 0.5033284313724959,
   "min": 0.464660784313809,
   "samples": 32,
   "batch": 51,
   "mbps": 102.07649081117955
  },
  "inflate js 1MB": {
   "impl": "fflate",
   "name": "inflate js 1MB",
   "ms": 9.949466666667528,
   "min": 9.776166666667754,
   "samples": 27,
   "batch": 3,
   "mbps": 107.11106792993003
  },
  "inflate json 1MB": {
   "impl": "fflate",
   "name": "inflate json 1MB",
   "ms": 8.157124999999724,
   "min": 7.932549999999537,
   "samples": 24,
   "batch": 4,
   "mbps": 128.5582849349539
  },
  "inflate wasm 2MB": {
   "impl": "fflate",
   "name": "inflate wasm 2MB",
   "ms": 23.522549999997864,
   "min": 22.833950000000186,
   "samples": 17,
   "batch": 2,
   "mbps": 89.15495981516419
  },
  "inflate random 1MB": {
   "impl": "fflate",
   "name": "inflate random 1MB",
   "ms": 0.8156774193548406,
   "min": 0.7730741935484994,
   "samples": 32,
   "batch": 31,
   "mbps": 1285.5278019457378
  },
  "inflate js 9MB": {
   "impl": "fflate",
   "name": "inflate js 9MB",
   "ms": 87.29169999999795,
   "min": 85.63529999999446,
   "samples": 10,
   "batch": 1,
   "mbps": 104.39219307219604
  },
  "inflateRaw(L1) text 64KB": {
   "impl": "fflate",
   "name": "inflateRaw(L1) text 64KB",
   "ms": 0.7840033333332637,
   "min": 0.7607066666668592,
   "samples": 32,
   "batch": 30,
   "mbps": 83.59148132874327
  },
  "inflateRaw(L1) js 1MB": {
   "impl": "fflate",
   "name": "inflateRaw(L1) js 1MB",
   "ms": 16.71560000000136,
   "min": 11.616899999997258,
   "samples": 26,
   "batch": 2,
   "mbps": 63.75469621191661
  },
  "inflateRaw(L1) js 9MB": {
   "impl": "fflate",
   "name": "inflateRaw(L1) js 9MB",
   "ms": 152.38085000000137,
   "min": 118.34850000000006,
   "samples": 10,
   "batch": 1,
   "mbps": 59.80129392899382
  },
  "inflate(L9) js 1MB": {
   "impl": "fflate",
   "name": "inflate(L9) js 1MB",
   "ms": 10.302583333334042,
   "min": 9.82916666666521,
   "samples": 26,
   "batch": 3,
   "mbps": 103.43988158309098
  },
  "inflate to:string js 51KB": {
   "impl": "fflate",
   "name": "inflate to:string js 51KB",
   "ms": 0.6219076923074541,
   "min": 0.5033307692305803,
   "samples": 47,
   "batch": 26,
   "mbps": 82.61354640810606
  },
  "ungzip esbuild-wasm-0.28.2.tgz": {
   "impl": "fflate",
   "name": "ungzip esbuild-wasm-0.28.2.tgz",
   "ms": 187.48979999999938,
   "min": 174.52329999999347,
   "samples": 10,
   "batch": 1,
   "mbps": 77.57699885540465
  },
  "ungzip lodash-4.17.21.tgz": {
   "impl": "fflate",
   "name": "ungzip lodash-4.17.21.tgz",
   "ms": 17.70154999999795,
   "min": 17.524100000002363,
   "samples": 23,
   "batch": 2,
   "mbps": 128.19126008740832
  },
  "ungzip react-dom-19.2.7.tgz": {
   "impl": "fflate",
   "name": "ungzip react-dom-19.2.7.tgz",
   "ms": 63.52440000000206,
   "min": 62.16909999999916,
   "samples": 13,
   "batch": 1,
   "mbps": 115.76427325562716
  },
  "ungzip typescript-5.9.3.tgz": {
   "impl": "fflate",
   "name": "ungzip typescript-5.9.3.tgz",
   "ms": 220.74254999999903,
   "min": 213.18360000000393,
   "samples": 10,
   "batch": 1,
   "mbps": 107.50391349560881
  },
  "ungzip zod-4.4.3.tgz": {
   "impl": "fflate",
   "name": "ungzip zod-4.4.3.tgz",
   "ms": 40.35590000000229,
   "min": 39.73539999999775,
   "samples": 20,
   "batch": 1,
   "mbps": 127.37864847518476
  }
 }
}
```
