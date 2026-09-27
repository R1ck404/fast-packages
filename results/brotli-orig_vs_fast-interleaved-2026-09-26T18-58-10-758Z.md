| case                                             | orig      | fast             |
|--------------------------------------------------|-----------|------------------|
| compress q11 tiny module (70B)                   | 2.34 ms   | 237.2 us  x9.85  |
| compress q11 zod-errors.js (1.6KB)               | 4.36 ms   | 1.28 ms  x3.40   |
| compress q11 json API response (8KB)             | 11.58 ms  | 5.25 ms  x2.21   |
| compress q11 zod-schemas.js (51KB)               | 58.14 ms  | 29.43 ms  x1.98  |
| compress q11 react-dom-client.prod (536KB)       | 719.61 ms | 388.43 ms  x1.85 |
| compress q1 zod-schemas.js (51KB)                | 688.8 us  | 204.2 us  x3.37  |
| compress q1 react-dom-client.prod (536KB)        | 8.77 ms   | 3.08 ms  x2.84   |
| compress q1 react-dom-client.dev (1MB)           | 16.45 ms  | 5.89 ms  x2.79   |
| compress q5 zod-schemas.js (51KB)                | 1.83 ms   | 746.3 us  x2.45  |
| compress q5 react-dom-client.prod (536KB)        | 16.86 ms  | 7.75 ms  x2.18   |
| compress q5 react-dom-client.dev (1MB)           | 31.27 ms  | 14.33 ms  x2.18  |
| compress q9 zod-schemas.js (51KB)                | 4.29 ms   | 1.16 ms  x3.70   |
| compress q9 react-dom-client.prod (536KB)        | 32.55 ms  | 18.36 ms  x1.77  |
| compress q9 react-dom-client.dev (1MB)           | 61.90 ms  | 36.41 ms  x1.70  |
| decompress (q11) tiny module (70B)               | 9.2 us    | 2.5 us  x3.63    |
| decompress (q5) tiny module (70B)                | 7.1 us    | 2.2 us  x3.22    |
| decompress (q11) zod-errors.js (1.6KB)           | 13.0 us   | 5.2 us  x2.49    |
| decompress (q5) zod-errors.js (1.6KB)            | 13.1 us   | 4.8 us  x2.73    |
| decompress (q11) json API response (8KB)         | 27.2 us   | 12.6 us  x2.15   |
| decompress (q5) json API response (8KB)          | 27.0 us   | 10.5 us  x2.57   |
| decompress (q11) zod-schemas.js (51KB)           | 117.8 us  | 57.7 us  x2.04   |
| decompress (q5) zod-schemas.js (51KB)            | 129.7 us  | 54.0 us  x2.40   |
| decompress (q11) react-dom-client.prod (536KB)   | 1.25 ms   | 508.0 us  x2.45  |
| decompress (q5) react-dom-client.prod (536KB)    | 1.38 ms   | 506.4 us  x2.73  |
| decompress (q11) react-dom-client.dev (1MB)      | 2.33 ms   | 996.3 us  x2.34  |
| decompress (q5) react-dom-client.dev (1MB)       | 2.54 ms   | 1.01 ms  x2.53   |
| CompressStream q5 react-dom-client.dev (1MB)     | 31.41 ms  | 14.45 ms  x2.17  |
| DecompressStream (q5) react-dom-client.dev (1MB) | 2.32 ms   | 1.98 ms  x1.17   |

```json
{
 "orig": {
  "compress q11 tiny module (70B)": {
   "impl": "orig",
   "name": "compress q11 tiny module (70B)",
   "ms": 2.335036363636391,
   "min": 2.272100000000054,
   "samples": 155,
   "batch": 11,
   "mbps": 0.0282650844448594
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 4.363141666666555,
   "min": 4.244683333333342,
   "samples": 150,
   "batch": 6,
   "mbps": 0.36877097351488886
  },
  "compress q11 json API response (8KB)": {
   "impl": "orig",
   "name": "compress q11 json API response (8KB)",
   "ms": 11.583133333333535,
   "min": 11.345200000000355,
   "samples": 114,
   "batch": 3,
   "mbps": 0.6935947095489298
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 58.136349999998856,
   "min": 57.28759999999966,
   "samples": 68,
   "batch": 1,
   "mbps": 0.8837500118256651
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 719.6106999999993,
   "min": 711.1749000000018,
   "samples": 6,
   "batch": 1,
   "mbps": 0.7448694134203404
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.6887921874999847,
   "min": 0.6528593750000482,
   "samples": 112,
   "batch": 32,
   "mbps": 74.59143836471162
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 8.773700000000341,
   "min": 8.504800000000008,
   "samples": 95,
   "batch": 3,
   "mbps": 61.093495332639506
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 16.449749999999767,
   "min": 16.003499999998894,
   "samples": 76,
   "batch": 2,
   "mbps": 64.7850575236715
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 1.8273714285709761,
   "min": 1.7782214285715392,
   "samples": 97,
   "batch": 14,
   "mbps": 28.115794740305283
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 16.863900000000285,
   "min": 16.565549999999348,
   "samples": 74,
   "batch": 2,
   "mbps": 31.784818458363187
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 31.267399999996996,
   "min": 30.68789999999717,
   "samples": 79,
   "batch": 1,
   "mbps": 34.08335838605392
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 4.291016666667322,
   "min": 4.1890166666671576,
   "samples": 97,
   "batch": 6,
   "mbps": 11.973386260441501
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 32.552199999998265,
   "min": 31.712300000006508,
   "samples": 77,
   "batch": 1,
   "mbps": 16.4663525045935
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 61.90260000000126,
   "min": 60.89619999999559,
   "samples": 40,
   "batch": 1,
   "mbps": 17.21572276447158
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.00916889101338452,
   "min": 0.008818738049713773,
   "samples": 104,
   "batch": 2615,
   "mbps": 7.198253300606893
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.007128160254555557,
   "min": 0.006864246456466157,
   "samples": 100,
   "batch": 3457,
   "mbps": 9.2590510935581
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.012966482300887028,
   "min": 0.012442256637169255,
   "samples": 103,
   "batch": 1808,
   "mbps": 124.089167953434
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.01307450561197239,
   "min": 0.012512934259756388,
   "samples": 102,
   "batch": 1871,
   "mbps": 123.06392667931021
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.027180952380947088,
   "min": 0.02578527131783433,
   "samples": 102,
   "batch": 903,
   "mbps": 295.5746320953624
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.027008548387096598,
   "min": 0.024647419354834554,
   "samples": 100,
   "batch": 930,
   "mbps": 297.4613772222673
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.11784676616915574,
   "min": 0.1094497512437841,
   "samples": 104,
   "batch": 201,
   "mbps": 435.9729305278745
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.12968062827225252,
   "min": 0.12290575916233414,
   "samples": 99,
   "batch": 191,
   "mbps": 396.1887036214586
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 1.2470425000003162,
   "min": 1.1527049999996961,
   "samples": 100,
   "batch": 20,
   "mbps": 429.8297772528716
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 1.384489473683827,
   "min": 1.2783473684210453,
   "samples": 95,
   "batch": 19,
   "mbps": 387.1578731283362
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 2.3334500000002496,
   "min": 2.1655272727273935,
   "samples": 90,
   "batch": 11,
   "mbps": 456.70487904171335
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 2.5446562500001164,
   "min": 2.4105875000004744,
   "samples": 122,
   "batch": 8,
   "mbps": 418.798413341665
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 31.409450000006473,
   "min": 30.824800000002142,
   "samples": 80,
   "batch": 1,
   "mbps": 33.929215570466226
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 2.3202363636360546,
   "min": 2.222181818182104,
   "samples": 97,
   "batch": 11,
   "mbps": 459.3057917297439
  }
 },
 "fast": {
  "compress q11 tiny module (70B)": {
   "impl": "fast",
   "name": "compress q11 tiny module (70B)",
   "ms": 0.23716666666666805,
   "min": 0.22484380952381408,
   "samples": 159,
   "batch": 105,
   "mbps": 0.2782853127196049
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 1.2821225000000367,
   "min": 1.2359800000000178,
   "samples": 156,
   "batch": 20,
   "mbps": 1.2549502875114928
  },
  "compress q11 json API response (8KB)": {
   "impl": "fast",
   "name": "compress q11 json API response (8KB)",
   "ms": 5.253119999999763,
   "min": 5.086059999999998,
   "samples": 151,
   "batch": 5,
   "mbps": 1.529376827485449
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 29.431000000000495,
   "min": 28.73700000000099,
   "samples": 133,
   "batch": 1,
   "mbps": 1.7457103054601997
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 388.4284000000007,
   "min": 383.8156999999992,
   "samples": 11,
   "batch": 1,
   "mbps": 1.3799608885447077
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.20422936507935766,
   "min": 0.18917619047617393,
   "samples": 95,
   "batch": 126,
   "mbps": 251.5700912062082
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 3.0844611111111186,
   "min": 3.0206444444443656,
   "samples": 90,
   "batch": 9,
   "mbps": 173.77946444813838
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 5.888380000000325,
   "min": 5.699319999999716,
   "samples": 85,
   "batch": 5,
   "mbps": 180.98322458807706
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 0.7463044117647608,
   "min": 0.7208294117646052,
   "samples": 94,
   "batch": 34,
   "mbps": 68.84322159976006
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 7.7501124999998865,
   "min": 7.558150000000751,
   "samples": 80,
   "batch": 4,
   "mbps": 69.1623508691013
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 14.330799999999726,
   "min": 13.989799999999377,
   "samples": 87,
   "batch": 2,
   "mbps": 74.36416668992801
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 1.158625000000029,
   "min": 1.127072727272951,
   "samples": 98,
   "batch": 22,
   "mbps": 44.34394217283306
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 18.35782499999914,
   "min": 17.87249999999767,
   "samples": 66,
   "batch": 2,
   "mbps": 29.198230182498484
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 36.40995000000112,
   "min": 34.4233000000022,
   "samples": 64,
   "batch": 1,
   "mbps": 29.269416739104756
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.002524674960770866,
   "min": 0.0024535305985209444,
   "samples": 110,
   "batch": 8922,
   "mbps": 26.14197907672362
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.0022111731340592193,
   "min": 0.0021647699648875878,
   "samples": 101,
   "batch": 11107,
   "mbps": 29.848408965985747
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.005213370118845395,
   "min": 0.004957767402377849,
   "samples": 101,
   "batch": 4712,
   "mbps": 308.62953585124416
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.004787379024293793,
   "min": 0.004558897886627529,
   "samples": 103,
   "batch": 5063,
   "mbps": 336.0920436495731
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.012626711271230032,
   "min": 0.010504477611939496,
   "samples": 103,
   "batch": 1943,
   "mbps": 636.2701916139853
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.010499347826085083,
   "min": 0.008579869565216105,
   "samples": 106,
   "batch": 2300,
   "mbps": 765.1903844960678
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.05768659793811259,
   "min": 0.04301675257731179,
   "samples": 111,
   "batch": 388,
   "mbps": 890.6401458293557
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.0540029082774269,
   "min": 0.0398340044742772,
   "samples": 105,
   "batch": 447,
   "mbps": 951.3932052706851
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 0.5080489361702968,
   "min": 0.4558744680850415,
   "samples": 106,
   "batch": 47,
   "mbps": 1055.0479724266734
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 0.5064260000002104,
   "min": 0.4573080000001937,
   "samples": 97,
   "batch": 50,
   "mbps": 1058.4290695970926
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 0.9962571428574544,
   "min": 0.9399095238096336,
   "samples": 117,
   "batch": 21,
   "mbps": 1069.7017408009503
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 1.0072540000002481,
   "min": 0.9478840000001947,
   "samples": 98,
   "batch": 25,
   "mbps": 1058.023100429224
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 14.454249999998865,
   "min": 14.080849999998463,
   "samples": 84,
   "batch": 2,
   "mbps": 73.72904163135989
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 1.9757750000001884,
   "min": 1.8499833333322993,
   "samples": 102,
   "batch": 12,
   "mbps": 539.3822677176797
  }
 }
}
```
