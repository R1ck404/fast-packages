| case                                             | orig      | prev             | fast             |
|--------------------------------------------------|-----------|------------------|------------------|
| compress q11 tiny module (70B)                   | 2.31 ms   | 175.4 us  x13.15 | 175.2 us  x13.17 |
| compress q11 zod-errors.js (1.6KB)               | 4.30 ms   | 944.3 us  x4.56  | 939.3 us  x4.58  |
| compress q11 json API response (8KB)             | 11.35 ms  | 3.30 ms  x3.44   | 3.30 ms  x3.44   |
| compress q11 zod-schemas.js (51KB)               | 56.89 ms  | 19.03 ms  x2.99  | 18.99 ms  x3.00  |
| compress q11 react-dom-client.prod (536KB)       | 686.03 ms | 236.93 ms  x2.90 | 236.76 ms  x2.90 |
| compress q1 zod-schemas.js (51KB)                | 655.9 us  | 193.5 us  x3.39  | 193.9 us  x3.38  |
| compress q1 react-dom-client.prod (536KB)        | 8.45 ms   | 3.06 ms  x2.76   | 3.08 ms  x2.75   |
| compress q1 react-dom-client.dev (1MB)           | 16.01 ms  | 5.78 ms  x2.77   | 5.88 ms  x2.72   |
| compress q5 zod-schemas.js (51KB)                | 1.79 ms   | 547.8 us  x3.26  | 548.6 us  x3.25  |
| compress q5 react-dom-client.prod (536KB)        | 16.36 ms  | 6.84 ms  x2.39   | 6.88 ms  x2.38   |
| compress q5 react-dom-client.dev (1MB)           | 30.75 ms  | 12.63 ms  x2.43  | 12.67 ms  x2.43  |
| compress q9 zod-schemas.js (51KB)                | 4.23 ms   | 1.02 ms  x4.16   | 1.00 ms  x4.21   |
| compress q9 react-dom-client.prod (536KB)        | 31.94 ms  | 17.98 ms  x1.78  | 17.80 ms  x1.79  |
| compress q9 react-dom-client.dev (1MB)           | 60.07 ms  | 34.17 ms  x1.76  | 34.18 ms  x1.76  |
| decompress (q11) tiny module (70B)               | 9.1 us    | 2.5 us  x3.68    | 2.5 us  x3.66    |
| decompress (q5) tiny module (70B)                | 7.0 us    | 2.2 us  x3.23    | 2.2 us  x3.25    |
| decompress (q11) zod-errors.js (1.6KB)           | 12.7 us   | 5.1 us  x2.50    | 5.1 us  x2.48    |
| decompress (q5) zod-errors.js (1.6KB)            | 12.7 us   | 4.6 us  x2.74    | 4.7 us  x2.70    |
| decompress (q11) json API response (8KB)         | 26.6 us   | 12.0 us  x2.21   | 12.3 us  x2.17   |
| decompress (q5) json API response (8KB)          | 26.3 us   | 8.5 us  x3.11    | 8.4 us  x3.13    |
| decompress (q11) zod-schemas.js (51KB)           | 113.8 us  | 55.2 us  x2.06   | 56.3 us  x2.02   |
| decompress (q5) zod-schemas.js (51KB)            | 126.5 us  | 50.8 us  x2.49   | 50.9 us  x2.49   |
| decompress (q11) react-dom-client.prod (536KB)   | 1.22 ms   | 486.5 us  x2.50  | 495.8 us  x2.45  |
| decompress (q5) react-dom-client.prod (536KB)    | 1.36 ms   | 467.1 us  x2.91  | 471.2 us  x2.89  |
| decompress (q11) react-dom-client.dev (1MB)      | 2.21 ms   | 959.7 us  x2.30  | 959.4 us  x2.30  |
| decompress (q5) react-dom-client.dev (1MB)       | 2.46 ms   | 955.3 us  x2.58  | 961.6 us  x2.56  |
| CompressStream q5 react-dom-client.dev (1MB)     | 30.78 ms  | 12.88 ms  x2.39  | 12.83 ms  x2.40  |
| DecompressStream (q5) react-dom-client.dev (1MB) | 2.27 ms   | 1.53 ms  x1.49   | 1.55 ms  x1.46   |

```json
{
 "orig": {
  "compress q11 tiny module (70B)": {
   "impl": "orig",
   "name": "compress q11 tiny module (70B)",
   "ms": 2.3074090909091285,
   "min": 2.24397272727269,
   "samples": 157,
   "batch": 11,
   "mbps": 0.028603510430825135
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 4.3026416666667355,
   "min": 4.213833333333241,
   "samples": 154,
   "batch": 6,
   "mbps": 0.3739563097864237
  },
  "compress q11 json API response (8KB)": {
   "impl": "orig",
   "name": "compress q11 json API response (8KB)",
   "ms": 11.354233333332862,
   "min": 11.229500000000067,
   "samples": 117,
   "batch": 3,
   "mbps": 0.7075774967927086
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 56.88829999999871,
   "min": 56.22530000000188,
   "samples": 71,
   "batch": 1,
   "mbps": 0.9031382551421148
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 686.0283500000005,
   "min": 685.4295999999995,
   "samples": 6,
   "batch": 1,
   "mbps": 0.781332141740206
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.6558684210526017,
   "min": 0.6413684210526155,
   "samples": 101,
   "batch": 38,
   "mbps": 78.33583436986274
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 8.449200000000323,
   "min": 8.374233333333299,
   "samples": 99,
   "batch": 3,
   "mbps": 63.43985229370586
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 16.00957500000004,
   "min": 15.862550000001647,
   "samples": 78,
   "batch": 2,
   "mbps": 66.566289236285
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 1.785150000000223,
   "min": 1.7470285714287976,
   "samples": 99,
   "batch": 14,
   "mbps": 28.780774724809444
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 16.360749999999825,
   "min": 16.222750000000815,
   "samples": 77,
   "batch": 2,
   "mbps": 32.76231224118734
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 30.74920000000202,
   "min": 30.35949999999866,
   "samples": 82,
   "batch": 1,
   "mbps": 34.65774719342064
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 4.229799999999523,
   "min": 4.178119999999763,
   "samples": 118,
   "batch": 5,
   "mbps": 12.146673601590098
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 31.936150000001362,
   "min": 31.586100000000442,
   "samples": 78,
   "batch": 1,
   "mbps": 16.78398930365674
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 60.06934999999794,
   "min": 59.78349999999773,
   "samples": 42,
   "batch": 1,
   "mbps": 17.741127546744497
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.00907942386831273,
   "min": 0.008664758698092998,
   "samples": 103,
   "batch": 2673,
   "mbps": 7.269183701219258
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "orig",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.007011218678815604,
   "min": 0.006809567198176486,
   "samples": 102,
   "batch": 3512,
   "mbps": 9.413484734033327
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.012662830482116385,
   "min": 0.012251270088129566,
   "samples": 102,
   "batch": 1929,
   "mbps": 127.06479821177247
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.01271550346297196,
   "min": 0.01220809802876741,
   "samples": 105,
   "batch": 1877,
   "mbps": 126.53844220053658
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.026561698717952636,
   "min": 0.026058333333332066,
   "samples": 100,
   "batch": 936,
   "mbps": 302.4655947388615
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "orig",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.026307542194095763,
   "min": 0.024104957805911716,
   "samples": 100,
   "batch": 948,
   "mbps": 305.3877074766445
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.11378318181821008,
   "min": 0.10744227272728246,
   "samples": 99,
   "batch": 220,
   "mbps": 451.5430064355729
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "orig",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.12652873563220265,
   "min": 0.12053620689653928,
   "samples": 113,
   "batch": 174,
   "mbps": 406.05795784877705
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 1.215802380952352,
   "min": 1.143857142856827,
   "samples": 98,
   "batch": 21,
   "mbps": 440.87428055547366
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 1.360878947368627,
   "min": 1.2909368421058294,
   "samples": 97,
   "batch": 19,
   "mbps": 393.87485642013326
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 2.209725000000011,
   "min": 2.1493166666671946,
   "samples": 94,
   "batch": 12,
   "mbps": 482.2763013497131
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 2.4610599999999976,
   "min": 2.3871999999988476,
   "samples": 101,
   "batch": 10,
   "mbps": 433.0239815364116
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 30.775400000005902,
   "min": 30.27530000000843,
   "samples": 82,
   "batch": 1,
   "mbps": 34.628242037464844
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "orig",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 2.2681454545447854,
   "min": 2.214981818181431,
   "samples": 100,
   "batch": 11,
   "mbps": 469.85434636240495
  }
 },
 "prev": {
  "compress q11 tiny module (70B)": {
   "impl": "prev",
   "name": "compress q11 tiny module (70B)",
   "ms": 0.1754043165467612,
   "min": 0.17400791366906548,
   "samples": 164,
   "batch": 139,
   "mbps": 0.3762735222220429
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 0.9443153846153879,
   "min": 0.9317961538461602,
   "samples": 163,
   "batch": 26,
   "mbps": 1.7038798967098612
  },
  "compress q11 json API response (8KB)": {
   "impl": "prev",
   "name": "compress q11 json API response (8KB)",
   "ms": 3.297462500000165,
   "min": 3.24737499999992,
   "samples": 149,
   "batch": 8,
   "mbps": 2.4364189130276985
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 19.03440000000046,
   "min": 18.87669999999889,
   "samples": 105,
   "batch": 2,
   "mbps": 2.699218257470619
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 236.9274000000005,
   "min": 235.83439999999973,
   "samples": 17,
   "batch": 1,
   "mbps": 2.262363914009097
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.19352890625000896,
   "min": 0.18750078124998026,
   "samples": 101,
   "batch": 128,
   "mbps": 265.47972081042866
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 3.061899999999797,
   "min": 2.9710333333330508,
   "samples": 91,
   "batch": 9,
   "mbps": 175.05993010876762
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 5.779550000000017,
   "min": 5.661799999999493,
   "samples": 86,
   "batch": 5,
   "mbps": 184.3911723231042
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 0.5477577777778303,
   "min": 0.5380355555555272,
   "samples": 101,
   "batch": 45,
   "mbps": 93.79693376227848
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 6.837925000000723,
   "min": 6.7059749999989435,
   "samples": 92,
   "batch": 4,
   "mbps": 78.38869247614494
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 12.634200000000419,
   "min": 12.486550000001444,
   "samples": 99,
   "batch": 2,
   "mbps": 84.35025565528206
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 1.0159459999999672,
   "min": 0.9808079999999609,
   "samples": 98,
   "batch": 25,
   "mbps": 50.57158549765603
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 17.982449999999517,
   "min": 17.56329999999798,
   "samples": 69,
   "batch": 2,
   "mbps": 29.80772920264004
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 34.17409999999654,
   "min": 33.354599999998754,
   "samples": 73,
   "batch": 1,
   "mbps": 31.18437647224383
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "prev",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.0024662043714636286,
   "min": 0.002430145345612,
   "samples": 110,
   "batch": 9013,
   "mbps": 26.761772367158166
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "prev",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.0021732109713341625,
   "min": 0.0021389874200867503,
   "samples": 110,
   "batch": 9698,
   "mbps": 30.36980802626896
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.0050616729480736445,
   "min": 0.004863463149079841,
   "samples": 104,
   "batch": 4776,
   "mbps": 317.8790918548675
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "prev",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.004636558829193003,
   "min": 0.004446658963990424,
   "samples": 104,
   "batch": 5193,
   "mbps": 347.02460580664035
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "prev",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.012045086393088003,
   "min": 0.010114092872569905,
   "samples": 116,
   "batch": 1852,
   "mbps": 666.9939706377083
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "prev",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.008463154897493889,
   "min": 0.00818523158694009,
   "samples": 108,
   "batch": 2634,
   "mbps": 949.2913809694099
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.05523589743587697,
   "min": 0.04242610722608725,
   "samples": 109,
   "batch": 429,
   "mbps": 930.155974375983
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "prev",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.05082648221344462,
   "min": 0.03948517786561518,
   "samples": 101,
   "batch": 506,
   "mbps": 1010.850992682108
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 0.4864645833334483,
   "min": 0.4511020833333532,
   "samples": 107,
   "batch": 48,
   "mbps": 1101.8602758848463
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "prev",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 0.46713846153845506,
   "min": 0.4446384615383487,
   "samples": 102,
   "batch": 52,
   "mbps": 1147.445659333437
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 0.9596538461541618,
   "min": 0.9372538461539079,
   "samples": 100,
   "batch": 26,
   "mbps": 1110.5025049092576
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 0.9553307692308758,
   "min": 0.9306576923073198,
   "samples": 101,
   "batch": 26,
   "mbps": 1115.5277672653415
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 12.880899999996473,
   "min": 12.766750000002503,
   "samples": 97,
   "batch": 2,
   "mbps": 82.73474679566583
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "prev",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 1.5252366666662662,
   "min": 1.4866199999999177,
   "samples": 108,
   "batch": 15,
   "mbps": 698.7099269841925
  }
 },
 "fast": {
  "compress q11 tiny module (70B)": {
   "impl": "fast",
   "name": "compress q11 tiny module (70B)",
   "ms": 0.1751642857142867,
   "min": 0.17199642857143058,
   "samples": 163,
   "batch": 140,
   "mbps": 0.37678913672878317
  },
  "compress q11 zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "compress q11 zod-errors.js (1.6KB)",
   "ms": 0.939285185185175,
   "min": 0.9270666666666835,
   "samples": 158,
   "batch": 27,
   "mbps": 1.713004767218589
  },
  "compress q11 json API response (8KB)": {
   "impl": "fast",
   "name": "compress q11 json API response (8KB)",
   "ms": 3.297568749999982,
   "min": 3.241325000000188,
   "samples": 152,
   "batch": 8,
   "mbps": 2.436340409885326
  },
  "compress q11 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q11 zod-schemas.js (51KB)",
   "ms": 18.992299999999886,
   "min": 18.850749999999607,
   "samples": 105,
   "batch": 2,
   "mbps": 2.70520158169365
  },
  "compress q11 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q11 react-dom-client.prod (536KB)",
   "ms": 236.76480000000083,
   "min": 235.96240000000034,
   "samples": 17,
   "batch": 1,
   "mbps": 2.2639176093743587
  },
  "compress q1 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q1 zod-schemas.js (51KB)",
   "ms": 0.19394961240308928,
   "min": 0.18937519379842835,
   "samples": 99,
   "batch": 129,
   "mbps": 264.9038549931211
  },
  "compress q1 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.prod (536KB)",
   "ms": 3.0778388888890427,
   "min": 3.011866666666821,
   "samples": 90,
   "batch": 9,
   "mbps": 174.15336518588114
  },
  "compress q1 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q1 react-dom-client.dev (1MB)",
   "ms": 5.881360000000131,
   "min": 5.781240000000253,
   "samples": 85,
   "batch": 5,
   "mbps": 181.1992464327938
  },
  "compress q5 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q5 zod-schemas.js (51KB)",
   "ms": 0.5485744444445219,
   "min": 0.5406199999999242,
   "samples": 102,
   "batch": 45,
   "mbps": 93.65729760164926
  },
  "compress q5 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.prod (536KB)",
   "ms": 6.877575000000434,
   "min": 6.793024999999034,
   "samples": 90,
   "batch": 4,
   "mbps": 77.9367727723749
  },
  "compress q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q5 react-dom-client.dev (1MB)",
   "ms": 12.66504999999961,
   "min": 12.47439999999915,
   "samples": 97,
   "batch": 2,
   "mbps": 84.14479216426567
  },
  "compress q9 zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "compress q9 zod-schemas.js (51KB)",
   "ms": 1.0048624999999447,
   "min": 0.9737374999998186,
   "samples": 101,
   "batch": 24,
   "mbps": 51.12938337334992
  },
  "compress q9 react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.prod (536KB)",
   "ms": 17.79594999999972,
   "min": 17.382300000001123,
   "samples": 71,
   "batch": 2,
   "mbps": 30.12011159842596
  },
  "compress q9 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "compress q9 react-dom-client.dev (1MB)",
   "ms": 34.17500000000291,
   "min": 33.53659999999945,
   "samples": 73,
   "batch": 1,
   "mbps": 31.183555230428947
  },
  "decompress (q11) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q11) tiny module (70B)",
   "ms": 0.0024809800062156233,
   "min": 0.0024525018129078076,
   "samples": 104,
   "batch": 9653,
   "mbps": 26.60239092400969
  },
  "decompress (q5) tiny module (70B)": {
   "impl": "fast",
   "name": "decompress (q5) tiny module (70B)",
   "ms": 0.0021605258514209844,
   "min": 0.0021359272983940457,
   "samples": 97,
   "batch": 11334,
   "mbps": 30.548118624265292
  },
  "decompress (q11) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-errors.js (1.6KB)",
   "ms": 0.005102838338133474,
   "min": 0.004932126696833238,
   "samples": 101,
   "batch": 4862,
   "mbps": 315.31471180969123
  },
  "decompress (q5) zod-errors.js (1.6KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-errors.js (1.6KB)",
   "ms": 0.0047078065134106145,
   "min": 0.004440670498084289,
   "samples": 102,
   "batch": 5220,
   "mbps": 341.7727545549328
  },
  "decompress (q11) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q11) json API response (8KB)",
   "ms": 0.012258491508491188,
   "min": 0.010216583416583783,
   "samples": 105,
   "batch": 2002,
   "mbps": 655.3824338365796
  },
  "decompress (q5) json API response (8KB)": {
   "impl": "fast",
   "name": "decompress (q5) json API response (8KB)",
   "ms": 0.00839829198861426,
   "min": 0.008104026026839227,
   "samples": 113,
   "batch": 2459,
   "mbps": 956.6230860860591
  },
  "decompress (q11) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q11) zod-schemas.js (51KB)",
   "ms": 0.05630367816092671,
   "min": 0.04321885057470772,
   "samples": 103,
   "batch": 435,
   "mbps": 912.5158724648827
  },
  "decompress (q5) zod-schemas.js (51KB)": {
   "impl": "fast",
   "name": "decompress (q5) zod-schemas.js (51KB)",
   "ms": 0.05088792016808953,
   "min": 0.03914999999999834,
   "samples": 108,
   "batch": 476,
   "mbps": 1009.6305730376024
  },
  "decompress (q11) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.prod (536KB)",
   "ms": 0.49579767441867073,
   "min": 0.4445906976744841,
   "samples": 117,
   "batch": 43,
   "mbps": 1081.1184232126257
  },
  "decompress (q5) react-dom-client.prod (536KB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.prod (536KB)",
   "ms": 0.47121698113201177,
   "min": 0.4494735849054776,
   "samples": 99,
   "batch": 53,
   "mbps": 1137.5141844683114
  },
  "decompress (q11) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q11) react-dom-client.dev (1MB)",
   "ms": 0.959396296296661,
   "min": 0.9340074074069789,
   "samples": 97,
   "batch": 27,
   "mbps": 1110.8006192161376
  },
  "decompress (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "decompress (q5) react-dom-client.dev (1MB)",
   "ms": 0.9615576923077662,
   "min": 0.9290461538464745,
   "samples": 100,
   "batch": 26,
   "mbps": 1108.3037539248362
  },
  "CompressStream q5 react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "CompressStream q5 react-dom-client.dev (1MB)",
   "ms": 12.83087499999965,
   "min": 12.640999999995984,
   "samples": 98,
   "batch": 2,
   "mbps": 83.05731292682916
  },
  "DecompressStream (q5) react-dom-client.dev (1MB)": {
   "impl": "fast",
   "name": "DecompressStream (q5) react-dom-client.dev (1MB)",
   "ms": 1.5508312499996464,
   "min": 1.4901687499996115,
   "samples": 99,
   "batch": 16,
   "mbps": 687.1785695576118
  }
 }
}
```
