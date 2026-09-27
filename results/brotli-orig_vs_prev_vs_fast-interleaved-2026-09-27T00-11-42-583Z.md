| case                                             | orig      | prev             | fast             |
|--------------------------------------------------|-----------|------------------|------------------|
| compress q11 tiny module (70B)                   | 2.30 ms   | 234.5 us  x9.82  | 181.5 us  x12.68 |
| compress q11 zod-errors.js (1.6KB)               | 4.31 ms   | 1.29 ms  x3.35   | 965.9 us  x4.46  |
| compress q11 json API response (8KB)             | 11.45 ms  | 5.30 ms  x2.16   | 3.34 ms  x3.42   |
| compress q11 zod-schemas.js (51KB)               | 57.40 ms  | 29.55 ms  x1.94  | 19.37 ms  x2.96  |
| compress q11 react-dom-client.prod (536KB)       | 698.63 ms | 383.02 ms  x1.82 | 241.50 ms  x2.89 |
| compress q1 zod-schemas.js (51KB)                | 667.3 us  | 195.7 us  x3.41  | 194.2 us  x3.44  |
| compress q1 react-dom-client.prod (536KB)        | 8.60 ms   | 3.08 ms  x2.79   | 3.08 ms  x2.79   |
| compress q1 react-dom-client.dev (1MB)           | 16.47 ms  | 5.81 ms  x2.83   | 5.79 ms  x2.84   |
| compress q5 zod-schemas.js (51KB)                | 1.82 ms   | 732.6 us  x2.49  | 569.8 us  x3.20  |
| compress q5 react-dom-client.prod (536KB)        | 16.68 ms  | 7.70 ms  x2.17   | 7.05 ms  x2.37   |
| compress q5 react-dom-client.dev (1MB)           | 31.27 ms  | 14.22 ms  x2.20  | 13.02 ms  x2.40  |
| compress q9 zod-schemas.js (51KB)                | 4.29 ms   | 1.16 ms  x3.70   | 1.03 ms  x4.18   |
| compress q9 react-dom-client.prod (536KB)        | 32.56 ms  | 18.14 ms  x1.79  | 17.97 ms  x1.81  |
| compress q9 react-dom-client.dev (1MB)           | 61.19 ms  | 34.59 ms  x1.77  | 34.37 ms  x1.78  |
| decompress (q11) tiny module (70B)               | 9.2 us    | 2.6 us  x3.61    | 2.5 us  x3.61    |
| decompress (q5) tiny module (70B)                | 7.2 us    | 2.2 us  x3.24    | 2.2 us  x3.22    |
| decompress (q11) zod-errors.js (1.6KB)           | 13.0 us   | 5.3 us  x2.47    | 5.1 us  x2.53    |
| decompress (q5) zod-errors.js (1.6KB)            | 13.1 us   | 4.8 us  x2.72    | 4.8 us  x2.73    |
| decompress (q11) json API response (8KB)         | 27.3 us   | 12.7 us  x2.16   | 12.6 us  x2.17   |
| decompress (q5) json API response (8KB)          | 27.0 us   | 9.0 us  x3.01    | 8.9 us  x3.03    |
| decompress (q11) zod-schemas.js (51KB)           | 115.8 us  | 57.6 us  x2.01   | 56.4 us  x2.05   |
| decompress (q5) zod-schemas.js (51KB)            | 129.0 us  | 53.5 us  x2.41   | 47.4 us  x2.72   |
| decompress (q11) react-dom-client.prod (536KB)   | 1.24 ms   | 507.1 us  x2.44  | 502.0 us  x2.46  |
| decompress (q5) react-dom-client.prod (536KB)    | 1.37 ms   | 483.3 us  x2.84  | 487.7 us  x2.82  |
| decompress (q11) react-dom-client.dev (1MB)      | 2.25 ms   | 965.9 us  x2.33  | 967.6 us  x2.33  |
| decompress (q5) react-dom-client.dev (1MB)       | 2.52 ms   | 975.2 us  x2.58  | 967.8 us  x2.60  |
| CompressStream q5 react-dom-client.dev (1MB)     | 31.14 ms  | 14.40 ms  x2.16  | 13.19 ms  x2.36  |
| DecompressStream (q5) react-dom-client.dev (1MB) | 2.31 ms   | 1.95 ms  x1.19   | 1.59 ms  x1.46   |

```json
{
 "orig": {
  "compress q11 tiny module (70B)": {
   "impl": "orig",
   "name": "compress q11 tiny module (70B)",
   "ms": 2.3020954545454515,
   "min": 2.268054545454561,
   "samples": 156,
   "batch": 11,
   "mbps": 0.028669532303573268
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 4.3110583333333725,
   "min": 4.261900000000121,
   "samples": 154,
   "batch": 6,
   "mbps": 0.37322621861994104
  },
  "compress q11 json API response (8KB)": {
   "impl": "orig",
   "name": "compress q11 json API response (8KB)",
   "ms": 11.44531666666656,
   "min": 11.363666666666782,
   "samples": 116,
   "batch": 3,
   "mbps": 0.7019465021355233
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 57.39969999999812,
   "min": 56.97060000000056,
   "samples": 69,
   "batch": 1,
   "mbps": 0.8950917861940338
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 698.6338000000014,
   "min": 694.4072000000015,
   "samples": 6,
   "batch": 1,
   "mbps": 0.7672345655191589
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.6672833333334185,
   "min": 0.6568916666666256,
   "samples": 103,
   "batch": 36,
   "mbps": 76.99577890450351
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 8.596166666666855,
   "min": 8.492833333333692,
   "samples": 96,
   "batch": 3,
   "mbps": 62.355235860944404
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 16.468324999999822,
   "min": 16.287500000000364,
   "samples": 76,
   "batch": 2,
   "mbps": 64.71198497722213
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 1.8246071428568809,
   "min": 1.7712214285711525,
   "samples": 97,
   "batch": 14,
   "mbps": 28.15839026013832
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 16.681300000000192,
   "min": 16.51469999999972,
   "samples": 75,
   "batch": 2,
   "mbps": 32.13274744774052
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 31.268499999998312,
   "min": 31.053399999997055,
   "samples": 80,
   "batch": 1,
   "mbps": 34.08215936165974
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 4.290233333334375,
   "min": 4.219383333333099,
   "samples": 97,
   "batch": 6,
   "mbps": 11.975572424185366
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 32.558499999999185,
   "min": 31.82259999999951,
   "samples": 77,
   "batch": 1,
   "mbps": 16.46316630065923
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 61.19219999999768,
   "min": 60.668900000004214,
   "samples": 41,
   "batch": 1,
   "mbps": 17.41558564653731
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.009200080482895749,
   "min": 0.008780684104627649,
   "samples": 109,
   "batch": 2485,
   "mbps": 7.173850285625582
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.007211967361740275,
   "min": 0.0068828346932611525,
   "samples": 105,
   "batch": 3309,
   "mbps": 9.151455724845926
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.01299840085287955,
   "min": 0.012336513859276846,
   "samples": 103,
   "batch": 1876,
   "mbps": 123.78445765838622
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.013078856526430321,
   "min": 0.012655825242719777,
   "samples": 101,
   "batch": 1854,
   "mbps": 123.02298727327292
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.027306417410711346,
   "min": 0.025933147321430688,
   "samples": 102,
   "batch": 896,
   "mbps": 294.21655280375757
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.026974414519897696,
   "min": 0.024874824355980048,
   "samples": 108,
   "batch": 854,
   "mbps": 297.8377897349251
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.11581186046512515,
   "min": 0.1099493023255829,
   "samples": 98,
   "batch": 215,
   "mbps": 443.6333186743999
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.12903463541666346,
   "min": 0.12236875000000207,
   "samples": 96,
   "batch": 192,
   "mbps": 398.17216388527163
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 1.2363249999994879,
   "min": 1.1470750000000407,
   "samples": 101,
   "batch": 20,
   "mbps": 433.5559015632799
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 1.3732705882353269,
   "min": 1.282794117646785,
   "samples": 107,
   "batch": 17,
   "mbps": 390.3207456651267
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 2.253368181818091,
   "min": 2.164718181818237,
   "samples": 100,
   "batch": 11,
   "mbps": 472.93558531573836
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 2.51960909090915,
   "min": 2.427118181818514,
   "samples": 89,
   "batch": 11,
   "mbps": 422.96164267904925
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 31.14379999999801,
   "min": 30.7213999999949,
   "samples": 80,
   "batch": 1,
   "mbps": 34.21862457375363
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 2.3075499999997025,
   "min": 2.2474909090907946,
   "samples": 96,
   "batch": 11,
   "mbps": 461.8309462417445
  }
 },
 "prev": {
  "compress q11 tiny module (70B)": {
   "impl": "prev",
   "name": "compress q11 tiny module (70B)",
   "ms": 0.2344688679245294,
   "min": 0.22370471698113245,
   "samples": 151,
   "batch": 106,
   "mbps": 0.2814872634658006
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 1.2876210526315652,
   "min": 1.246715789473647,
   "samples": 159,
   "batch": 19,
   "mbps": 1.2495912494686376
  },
  "compress q11 json API response (8KB)": {
   "impl": "prev",
   "name": "compress q11 json API response (8KB)",
   "ms": 5.29806000000026,
   "min": 5.119599999999991,
   "samples": 151,
   "batch": 5,
   "mbps": 1.5164041177335865
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 29.55069999999978,
   "min": 28.844499999999243,
   "samples": 135,
   "batch": 1,
   "mbps": 1.7386390170114545
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 383.0155999999988,
   "min": 382.0301999999974,
   "samples": 11,
   "batch": 1,
   "mbps": 1.3994625806364067
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.19566709401709903,
   "min": 0.19033418803419952,
   "samples": 108,
   "batch": 117,
   "mbps": 262.57864286322035
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 3.0770444444440526,
   "min": 3.0458666666668757,
   "samples": 89,
   "batch": 9,
   "mbps": 174.19832884371783
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 5.812099999999919,
   "min": 5.7426600000006145,
   "samples": 86,
   "batch": 5,
   "mbps": 183.35851069321154
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 0.7325636363635898,
   "min": 0.7208575757575807,
   "samples": 103,
   "batch": 33,
   "mbps": 70.13452135713136
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 7.7035499999983585,
   "min": 7.5516999999999825,
   "samples": 81,
   "batch": 4,
   "mbps": 69.5803882625691
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 14.222074999999677,
   "min": 13.9587500000016,
   "samples": 88,
   "batch": 2,
   "mbps": 74.93266629518016
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 1.1591954545454592,
   "min": 1.121936363636368,
   "samples": 97,
   "batch": 22,
   "mbps": 44.322119965649975
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 18.144349999998667,
   "min": 17.669200000000274,
   "samples": 69,
   "batch": 2,
   "mbps": 29.541758178167825
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 34.58690000000206,
   "min": 33.855499999997846,
   "samples": 73,
   "batch": 1,
   "mbps": 30.812186116707096
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "prev",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.0025503918754828745,
   "min": 0.0025052434043492337,
   "samples": 108,
   "batch": 9059,
   "mbps": 25.878376038781884
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "prev",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.002223315438726485,
   "min": 0.0021966123657903144,
   "samples": 104,
   "batch": 10804,
   "mbps": 29.685396345650716
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.005253039383561615,
   "min": 0.004982063356164436,
   "samples": 102,
   "batch": 4672,
   "mbps": 306.29886481244716
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.004804089133930358,
   "min": 0.0045824488858269155,
   "samples": 119,
   "batch": 4353,
   "mbps": 334.92301144788144
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "prev",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.012662369519834736,
   "min": 0.010423225469728735,
   "samples": 105,
   "batch": 1916,
   "mbps": 634.4784036996621
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "prev",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.008950781893005945,
   "min": 0.008163703703707172,
   "samples": 109,
   "batch": 2430,
   "mbps": 897.5752170073197
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.05764717444718423,
   "min": 0.043400245700244616,
   "samples": 106,
   "batch": 407,
   "mbps": 891.249232814906
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.05351917960087587,
   "min": 0.03917494456762832,
   "samples": 106,
   "batch": 451,
   "mbps": 959.9922940365694
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 0.5070729166664023,
   "min": 0.4511333333333217,
   "samples": 103,
   "batch": 48,
   "mbps": 1057.0787403197853
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 0.48334600000001954,
   "min": 0.45580400000006194,
   "samples": 103,
   "batch": 50,
   "mbps": 1108.969558039124
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 0.9658799999998883,
   "min": 0.9431160000001546,
   "samples": 101,
   "batch": 25,
   "mbps": 1103.3441007165727
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 0.9751557692305561,
   "min": 0.9447192307695962,
   "samples": 96,
   "batch": 26,
   "mbps": 1092.8489925675012
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 14.39627499999915,
   "min": 14.046249999999418,
   "samples": 84,
   "batch": 2,
   "mbps": 74.02595463062931
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 1.9466833333329607,
   "min": 1.846875000000485,
   "samples": 105,
   "batch": 12,
   "mbps": 547.442915728566
  }
 },
 "fast": {
  "compress q11 tiny module (70B)": {
   "impl": "fast",
   "name": "compress q11 tiny module (70B)",
   "ms": 0.18150255474452487,
   "min": 0.17683868613138437,
   "samples": 156,
   "batch": 137,
   "mbps": 0.3636312452620777
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 0.9658820000000015,
   "min": 0.9397119999999995,
   "samples": 164,
   "batch": 25,
   "mbps": 1.6658349570651463
  },
  "compress q11 json API response (8KB)": {
   "impl": "fast",
   "name": "compress q11 json API response (8KB)",
   "ms": 3.3435000000001764,
   "min": 3.2645500000000993,
   "samples": 149,
   "batch": 8,
   "mbps": 2.402871242709608
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 19.370300000000498,
   "min": 18.976650000000518,
   "samples": 103,
   "batch": 2,
   "mbps": 2.6524111655471874
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 241.49849999999788,
   "min": 240.95969999999943,
   "samples": 17,
   "batch": 1,
   "mbps": 2.219541736284096
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.19422887931034047,
   "min": 0.1898793103448419,
   "samples": 110,
   "batch": 116,
   "mbps": 264.52296992306594
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 3.0805749999999534,
   "min": 3.04175000000032,
   "samples": 101,
   "batch": 8,
   "mbps": 173.9986853103749
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 5.789770000000136,
   "min": 5.734520000000339,
   "samples": 86,
   "batch": 5,
   "mbps": 184.065688274314
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 0.5698134146341323,
   "min": 0.5519634146341293,
   "samples": 106,
   "batch": 41,
   "mbps": 90.16635740839651
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 7.052674999998999,
   "min": 6.91412500000115,
   "samples": 89,
   "batch": 4,
   "mbps": 76.00180073519284
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 13.018599999999424,
   "min": 12.73660000000018,
   "samples": 95,
   "batch": 2,
   "mbps": 81.85964696665134
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 1.0255279999999038,
   "min": 0.9941639999998734,
   "samples": 98,
   "batch": 25,
   "mbps": 50.09907091761982
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 17.965649999998277,
   "min": 17.48449999999866,
   "samples": 69,
   "batch": 2,
   "mbps": 29.83560294228439
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 34.365499999999884,
   "min": 33.59410000000207,
   "samples": 73,
   "batch": 1,
   "mbps": 31.010693864486292
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.002546787260016122,
   "min": 0.002503184996115756,
   "samples": 109,
   "batch": 9011,
   "mbps": 25.915003202734024
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.0022381623134328068,
   "min": 0.0022094962686566503,
   "samples": 104,
   "batch": 10720,
   "mbps": 29.48847793740739
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.0051379514255551345,
   "min": 0.004905744456177331,
   "samples": 103,
   "batch": 4735,
   "mbps": 313.1598309779961
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.0047848523622046136,
   "min": 0.004607755905512537,
   "samples": 102,
   "batch": 5080,
   "mbps": 336.2695185141837
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.012560590858416919,
   "min": 0.010406911928650085,
   "samples": 115,
   "batch": 1794,
   "mbps": 639.619591988889
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.008899056603773499,
   "min": 0.00822517152658731,
   "samples": 114,
   "batch": 2332,
   "mbps": 902.7923248171401
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.05637091346153074,
   "min": 0.04270721153845723,
   "samples": 109,
   "batch": 416,
   "mbps": 911.4274870685206
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.04742857142858212,
   "min": 0.03943224489794003,
   "samples": 107,
   "batch": 490,
   "mbps": 1083.2710843371053
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 0.5020187500000853,
   "min": 0.4575875000000451,
   "samples": 103,
   "batch": 48,
   "mbps": 1067.7210761548426
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 0.48773600000014994,
   "min": 0.45472999999998137,
   "samples": 101,
   "batch": 50,
   "mbps": 1098.9879771020292
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 0.9675961538461986,
   "min": 0.9386500000003323,
   "samples": 97,
   "batch": 26,
   "mbps": 1101.3871807611536
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 0.9677634615386174,
   "min": 0.9430153846154169,
   "samples": 98,
   "batch": 26,
   "mbps": 1101.1967720972639
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 13.185349999999744,
   "min": 12.89890000000014,
   "samples": 95,
   "batch": 2,
   "mbps": 80.82439980736353
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 1.5851066666664944,
   "min": 1.51439333333401,
   "samples": 105,
   "batch": 15,
   "mbps": 672.3194232986103
  }
 }
}
```
