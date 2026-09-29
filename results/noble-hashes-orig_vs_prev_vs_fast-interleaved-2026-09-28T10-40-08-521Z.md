| case                                                     | orig     | prev            | fast            |
|----------------------------------------------------------|----------|-----------------|-----------------|
| sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity) | 9.82 ms  | 1.85 ms  x5.30  | 1.83 ms  x5.37  |
| sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity) | 30.47 ms | 5.76 ms  x5.29  | 5.68 ms  x5.36  |
| sha256 1 MB                                              | 3.65 ms  | 2.15 ms  x1.70  | 2.12 ms  x1.72  |
| sha256 64 KB                                             | 228.7 us | 134.2 us  x1.70 | 132.8 us  x1.72 |
| sha256 1 KB                                              | 4.4 us   | 2.4 us  x1.82   | 2.3 us  x1.89   |
| sha256 56-char string                                    | 1.2 us   | 0.3 us  x4.15   | 0.3 us  x3.97   |
| sha512 1 MB                                              | 7.30 ms  | 1.38 ms  x5.29  | 1.36 ms  x5.36  |
| sha512 64 KB                                             | 457.2 us | 86.4 us  x5.29  | 86.2 us  x5.30  |
| sha512 1 KB                                              | 8.7 us   | 1.9 us  x4.68   | 1.8 us  x4.74   |
| sha512 56-char string                                    | 2.1 us   | 0.4 us  x5.54   | 0.4 us  x5.49   |
| sha384 1 MB                                              | 7.30 ms  | 1.38 ms  x5.30  | 1.36 ms  x5.37  |
| sha384 1 KB                                              | 8.7 us   | 1.9 us  x4.56   | 1.9 us  x4.72   |
| sha384 56-char string                                    | 2.1 us   | 0.4 us  x5.54   | 0.4 us  x5.47   |
| sha1 1 MB                                                | 2.64 ms  | 1.27 ms  x2.08  | 1.01 ms  x2.61  |
| sha1 1 KB                                                | 3.5 us   | 1.4 us  x2.47   | 1.1 us  x3.05   |
| sha1 56-char string                                      | 1.2 us   | 0.2 us  x5.58   | 0.2 us  x5.62   |
| md5 1 MB                                                 | 8.95 ms  | 1.33 ms  x6.74  | 1.15 ms  x7.80  |
| md5 1 KB                                                 | 9.9 us   | 1.5 us  x6.79   | 1.3 us  x7.78   |
| md5 56-char string                                       | 1.5 us   | 0.2 us  x7.00   | 0.2 us  x6.98   |
| sha256.create().update(56-char string).digest()          | 1.2 us   | 0.7 us  x1.69   | 0.7 us  x1.70   |
| sha1.create().update(56-char string).digest()            | 1.2 us   | 0.6 us  x1.90   | 0.7 us  x1.74   |
| md5.create().update(56-char string).digest()             | 1.5 us   | 0.6 us  x2.52   | 0.7 us  x2.30   |
| sha256.create(), 1 MB in 16 KB updates                   | 3.67 ms  | 2.15 ms  x1.70  | 2.14 ms  x1.72  |
| sha256.create(), 64 KB in 100 B updates                  | 320.1 us | 258.1 us  x1.24 | 266.9 us  x1.20 |
| hmac sha256, 56-char string                              | 3.2 us   | 2.2 us  x1.44   | 2.4 us  x1.33   |
| hmac sha256, 1 KB                                        | 6.3 us   | 4.3 us  x1.46   | 4.5 us  x1.40   |
| pbkdf2 sha256, c=10000                                   | 9.09 ms  | 2.81 ms  x3.23  | 2.65 ms  x3.43  |
| pbkdf2 sha512, c=10000                                   | 24.17 ms | 4.11 ms  x5.88  | 3.36 ms  x7.18  |
| scrypt N=2^14 r=8 p=1                                    | 36.32 ms | 15.85 ms  x2.29 | 16.06 ms  x2.26 |

```json
{
 "orig": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 9.820783333333338,
   "min": 9.720966666666603,
   "samples": 80,
   "batch": 3,
   "mbps": 143.49425622871217
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 30.46505000000002,
   "min": 30.212200000000394,
   "samples": 82,
   "batch": 1,
   "mbps": 143.6881935201156
  },
  "sha256 1 MB": {
   "impl": "orig",
   "name": "sha256 1 MB",
   "ms": 3.6462214285714123,
   "min": 3.4485999999999746,
   "samples": 98,
   "batch": 7,
   "mbps": 287.5788046725488
  },
  "sha256 64 KB": {
   "impl": "orig",
   "name": "sha256 64 KB",
   "ms": 0.22871620370371468,
   "min": 0.21779999999999847,
   "samples": 102,
   "batch": 108,
   "mbps": 286.538509028845
  },
  "sha256 1 KB": {
   "impl": "orig",
   "name": "sha256 1 KB",
   "ms": 0.004392029910632908,
   "min": 0.004197829655298218,
   "samples": 103,
   "batch": 5483,
   "mbps": 233.14959616302744
  },
  "sha256 56-char string": {
   "impl": "orig",
   "name": "sha256 56-char string",
   "ms": 0.001222953977509365,
   "min": 0.0011852509371095023,
   "samples": 107,
   "batch": 19208
  },
  "sha512 1 MB": {
   "impl": "orig",
   "name": "sha512 1 MB",
   "ms": 7.2966624999994565,
   "min": 7.22190000000046,
   "samples": 86,
   "batch": 4,
   "mbps": 143.70624926123116
  },
  "sha512 64 KB": {
   "impl": "orig",
   "name": "sha512 64 KB",
   "ms": 0.45722075471699014,
   "min": 0.4497981132075404,
   "samples": 103,
   "batch": 53,
   "mbps": 143.33557548271267
  },
  "sha512 1 KB": {
   "impl": "orig",
   "name": "sha512 1 KB",
   "ms": 0.008735958005248162,
   "min": 0.008653918260216763,
   "samples": 107,
   "batch": 2667,
   "mbps": 117.21668068743324
  },
  "sha512 56-char string": {
   "impl": "orig",
   "name": "sha512 56-char string",
   "ms": 0.0020758697429374418,
   "min": 0.0020428740121716743,
   "samples": 110,
   "batch": 11009
  },
  "sha384 1 MB": {
   "impl": "orig",
   "name": "sha384 1 MB",
   "ms": 7.298925000000054,
   "min": 7.238900000000285,
   "samples": 85,
   "batch": 4,
   "mbps": 143.66170360703694
  },
  "sha384 1 KB": {
   "impl": "orig",
   "name": "sha384 1 KB",
   "ms": 0.008748588469183808,
   "min": 0.008628827037774494,
   "samples": 113,
   "batch": 2515,
   "mbps": 117.04745326711353
  },
  "sha384 56-char string": {
   "impl": "orig",
   "name": "sha384 56-char string",
   "ms": 0.0020628720438810462,
   "min": 0.002031678805862514,
   "samples": 109,
   "batch": 11121
  },
  "sha1 1 MB": {
   "impl": "orig",
   "name": "sha1 1 MB",
   "ms": 2.6387999999999012,
   "min": 2.527530000000115,
   "samples": 95,
   "batch": 10,
   "mbps": 397.3685008337271
  },
  "sha1 1 KB": {
   "impl": "orig",
   "name": "sha1 1 KB",
   "ms": 0.0034702692972353438,
   "min": 0.003407229262671946,
   "samples": 104,
   "batch": 6944,
   "mbps": 295.07796435734514
  },
  "sha1 56-char string": {
   "impl": "orig",
   "name": "sha1 56-char string",
   "ms": 0.0011970223454915844,
   "min": 0.0011772567899943174,
   "samples": 109,
   "batch": 19109
  },
  "md5 1 MB": {
   "impl": "orig",
   "name": "md5 1 MB",
   "ms": 8.947366666664797,
   "min": 8.920266666667885,
   "samples": 93,
   "batch": 3,
   "mbps": 117.19381121449727
  },
  "md5 1 KB": {
   "impl": "orig",
   "name": "md5 1 KB",
   "ms": 0.009852592592592803,
   "min": 0.009668271604938808,
   "samples": 105,
   "batch": 2430,
   "mbps": 103.93203518532219
  },
  "md5 56-char string": {
   "impl": "orig",
   "name": "md5 56-char string",
   "ms": 0.0015121955255492912,
   "min": 0.0014945790309769142,
   "samples": 108,
   "batch": 15108
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0012083834864321508,
   "min": 0.0011887815436595352,
   "samples": 108,
   "batch": 18942
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0011607351019997996,
   "min": 0.0011415787358055203,
   "samples": 108,
   "batch": 19902
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0015261502770977135,
   "min": 0.0015118249774451458,
   "samples": 105,
   "batch": 15518
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "orig",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 3.666907142857131,
   "min": 3.4887857142852488,
   "samples": 94,
   "batch": 7,
   "mbps": 285.95651843612944
  },
  "sha256.create(), 64 KB in 100 B updates": {
   "impl": "orig",
   "name": "sha256.create(), 64 KB in 100 B updates",
   "ms": 0.32005389610380264,
   "min": 0.3030545454544685,
   "samples": 102,
   "batch": 77,
   "mbps": 204.765512302168
  },
  "hmac sha256, 56-char string": {
   "impl": "orig",
   "name": "hmac sha256, 56-char string",
   "ms": 0.003213733260453832,
   "min": 0.0031506149221107345,
   "samples": 107,
   "batch": 7318
  },
  "hmac sha256, 1 KB": {
   "impl": "orig",
   "name": "hmac sha256, 1 KB",
   "ms": 0.006348699034335501,
   "min": 0.00615775214592552,
   "samples": 106,
   "batch": 3728
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 9.085099999999027,
   "min": 8.780299999998533,
   "samples": 92,
   "batch": 3
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 24.16610000000219,
   "min": 23.997400000007474,
   "samples": 103,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "orig",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 36.323199999998906,
   "min": 35.70139999999083,
   "samples": 110,
   "batch": 1
  }
 },
 "prev": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "prev",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 1.854535714285719,
   "min": 1.8479214285714534,
   "samples": 97,
   "batch": 14,
   "mbps": 759.8807556762358
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "prev",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 5.761319999999978,
   "min": 5.735360000000037,
   "samples": 86,
   "batch": 5,
   "mbps": 759.8029618212522
  },
  "sha256 1 MB": {
   "impl": "prev",
   "name": "sha256 1 MB",
   "ms": 2.146383333333309,
   "min": 2.138291666666646,
   "samples": 96,
   "batch": 12,
   "mbps": 488.5315608426633
  },
  "sha256 64 KB": {
   "impl": "prev",
   "name": "sha256 64 KB",
   "ms": 0.13423756756756366,
   "min": 0.1336470270270208,
   "samples": 100,
   "batch": 185,
   "mbps": 488.2090847408629
  },
  "sha256 1 KB": {
   "impl": "prev",
   "name": "sha256 1 KB",
   "ms": 0.0024197792181487477,
   "min": 0.002410917561272139,
   "samples": 104,
   "batch": 9874,
   "mbps": 423.179103415646
  },
  "sha256 56-char string": {
   "impl": "prev",
   "name": "sha256 56-char string",
   "ms": 0.00029476904643305907,
   "min": 0.00029189138249035803,
   "samples": 114,
   "batch": 74279
  },
  "sha512 1 MB": {
   "impl": "prev",
   "name": "sha512 1 MB",
   "ms": 1.3788888888888726,
   "min": 1.3738666666665975,
   "samples": 101,
   "batch": 18,
   "mbps": 760.4499597099203
  },
  "sha512 64 KB": {
   "impl": "prev",
   "name": "sha512 64 KB",
   "ms": 0.08635259515571224,
   "min": 0.0859989619377151,
   "samples": 99,
   "batch": 289,
   "mbps": 758.934921200973
  },
  "sha512 1 KB": {
   "impl": "prev",
   "name": "sha512 1 KB",
   "ms": 0.0018675169373928869,
   "min": 0.001852150844828928,
   "samples": 110,
   "batch": 12251,
   "mbps": 548.3216668597055
  },
  "sha512 56-char string": {
   "impl": "prev",
   "name": "sha512 56-char string",
   "ms": 0.0003745874859745102,
   "min": 0.0003664576595604306,
   "samples": 110,
   "batch": 60604
  },
  "sha384 1 MB": {
   "impl": "prev",
   "name": "sha384 1 MB",
   "ms": 1.3778416666667301,
   "min": 1.3697444444444247,
   "samples": 100,
   "batch": 18,
   "mbps": 761.0279362045361
  },
  "sha384 1 KB": {
   "impl": "prev",
   "name": "sha384 1 KB",
   "ms": 0.0019192161218660826,
   "min": 0.0019022929228813895,
   "samples": 102,
   "batch": 12604,
   "mbps": 533.5511661940134
  },
  "sha384 56-char string": {
   "impl": "prev",
   "name": "sha384 56-char string",
   "ms": 0.0003724286684782486,
   "min": 0.00036344599184785596,
   "samples": 113,
   "batch": 58880
  },
  "sha1 1 MB": {
   "impl": "prev",
   "name": "sha1 1 MB",
   "ms": 1.269263157894832,
   "min": 1.2654684210524705,
   "samples": 103,
   "batch": 19,
   "mbps": 826.1297064189131
  },
  "sha1 1 KB": {
   "impl": "prev",
   "name": "sha1 1 KB",
   "ms": 0.0014057688986124162,
   "min": 0.001397927341815777,
   "samples": 99,
   "batch": 17369,
   "mbps": 728.4269846990877
  },
  "sha1 56-char string": {
   "impl": "prev",
   "name": "sha1 56-char string",
   "ms": 0.0002146022478321734,
   "min": 0.00021062880200529193,
   "samples": 118,
   "batch": 98139
  },
  "md5 1 MB": {
   "impl": "prev",
   "name": "md5 1 MB",
   "ms": 1.327994736842428,
   "min": 1.325989473684259,
   "samples": 99,
   "batch": 19,
   "mbps": 789.5934907793371
  },
  "md5 1 KB": {
   "impl": "prev",
   "name": "md5 1 KB",
   "ms": 0.0014500148729846684,
   "min": 0.0014449818549584945,
   "samples": 103,
   "batch": 16809,
   "mbps": 706.1996528988893
  },
  "md5 56-char string": {
   "impl": "prev",
   "name": "md5 56-char string",
   "ms": 0.00021590349952304948,
   "min": 0.00020719686699809985,
   "samples": 116,
   "batch": 99585
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0007129770992365444,
   "min": 0.000706229890858561,
   "samples": 110,
   "batch": 31702
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0006107206110251036,
   "min": 0.0006026427938897314,
   "samples": 113,
   "batch": 36136
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0006067202694627247,
   "min": 0.0006002580540012132,
   "samples": 112,
   "batch": 36814
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "prev",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 2.1529833333333954,
   "min": 2.1363583333331917,
   "samples": 96,
   "batch": 12,
   "mbps": 487.0339606282614
  },
  "sha256.create(), 64 KB in 100 B updates": {
   "impl": "prev",
   "name": "sha256.create(), 64 KB in 100 B updates",
   "ms": 0.2581113636363377,
   "min": 0.255562499999955,
   "samples": 110,
   "batch": 88,
   "mbps": 253.90590742194524
  },
  "hmac sha256, 56-char string": {
   "impl": "prev",
   "name": "hmac sha256, 56-char string",
   "ms": 0.0022277852607271724,
   "min": 0.0022150567635160854,
   "samples": 108,
   "batch": 10394
  },
  "hmac sha256, 1 KB": {
   "impl": "prev",
   "name": "hmac sha256, 1 KB",
   "ms": 0.004337706133037408,
   "min": 0.00430142671854763,
   "samples": 107,
   "batch": 5397
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "prev",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 2.809299999999995,
   "min": 2.782777777777584,
   "samples": 99,
   "batch": 9
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "prev",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 4.110599999999977,
   "min": 4.088316666668106,
   "samples": 100,
   "batch": 6
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "prev",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 15.85320000000138,
   "min": 15.520599999996193,
   "samples": 126,
   "batch": 2
  }
 },
 "fast": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 1.8293857142857186,
   "min": 1.8226285714285626,
   "samples": 96,
   "batch": 14,
   "mbps": 770.3274323152953
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 5.682119999999986,
   "min": 5.661299999999938,
   "samples": 88,
   "batch": 5,
   "mbps": 770.3934447002196
  },
  "sha256 1 MB": {
   "impl": "fast",
   "name": "sha256 1 MB",
   "ms": 2.12195833333332,
   "min": 2.115875000000036,
   "samples": 99,
   "batch": 12,
   "mbps": 494.15484909773124
  },
  "sha256 64 KB": {
   "impl": "fast",
   "name": "sha256 64 KB",
   "ms": 0.13277234042553535,
   "min": 0.13209734042553425,
   "samples": 100,
   "batch": 188,
   "mbps": 493.59678220597084
  },
  "sha256 1 KB": {
   "impl": "fast",
   "name": "sha256 1 KB",
   "ms": 0.002325360369017934,
   "min": 0.0023120219104362863,
   "samples": 103,
   "batch": 10406,
   "mbps": 440.36185257275383
  },
  "sha256 56-char string": {
   "impl": "fast",
   "name": "sha256 56-char string",
   "ms": 0.0003078127381298828,
   "min": 0.00030178034553944127,
   "samples": 112,
   "batch": 72177
  },
  "sha512 1 MB": {
   "impl": "fast",
   "name": "sha512 1 MB",
   "ms": 1.3603631578946653,
   "min": 1.355257894736975,
   "samples": 96,
   "batch": 19,
   "mbps": 770.8059380429006
  },
  "sha512 64 KB": {
   "impl": "fast",
   "name": "sha512 64 KB",
   "ms": 0.08619909909910282,
   "min": 0.08521081081080656,
   "samples": 123,
   "batch": 222,
   "mbps": 760.2863682444461
  },
  "sha512 1 KB": {
   "impl": "fast",
   "name": "sha512 1 KB",
   "ms": 0.001844930477264192,
   "min": 0.0018340999624200474,
   "samples": 101,
   "batch": 13305,
   "mbps": 555.0344647774846
  },
  "sha512 56-char string": {
   "impl": "fast",
   "name": "sha512 56-char string",
   "ms": 0.0003779471861614379,
   "min": 0.00036950156734667615,
   "samples": 109,
   "batch": 60931
  },
  "sha384 1 MB": {
   "impl": "fast",
   "name": "sha384 1 MB",
   "ms": 1.3597131578948107,
   "min": 1.3549526315789415,
   "samples": 96,
   "batch": 19,
   "mbps": 771.174415656511
  },
  "sha384 1 KB": {
   "impl": "fast",
   "name": "sha384 1 KB",
   "ms": 0.001852163388804564,
   "min": 0.001837473524962321,
   "samples": 102,
   "batch": 13220,
   "mbps": 552.8669912112435
  },
  "sha384 56-char string": {
   "impl": "fast",
   "name": "sha384 56-char string",
   "ms": 0.0003768060649725266,
   "min": 0.00036923794865077915,
   "samples": 109,
   "batch": 61072
  },
  "sha1 1 MB": {
   "impl": "fast",
   "name": "sha1 1 MB",
   "ms": 1.0103859999999987,
   "min": 1.0044200000001,
   "samples": 98,
   "batch": 25,
   "mbps": 1037.7974358314557
  },
  "sha1 1 KB": {
   "impl": "fast",
   "name": "sha1 1 KB",
   "ms": 0.0011393687393685952,
   "min": 0.0011318276318278767,
   "samples": 103,
   "batch": 21164,
   "mbps": 898.7432817995962
  },
  "sha1 56-char string": {
   "impl": "fast",
   "name": "sha1 56-char string",
   "ms": 0.00021293251113396945,
   "min": 0.00020750760735953385,
   "samples": 117,
   "batch": 99246
  },
  "md5 1 MB": {
   "impl": "fast",
   "name": "md5 1 MB",
   "ms": 1.1466045454544656,
   "min": 1.1446090909088193,
   "samples": 99,
   "batch": 22,
   "mbps": 914.5053577163247
  },
  "md5 1 KB": {
   "impl": "fast",
   "name": "md5 1 KB",
   "ms": 0.0012661536861809826,
   "min": 0.0012632941665802603,
   "samples": 103,
   "batch": 19234,
   "mbps": 808.7485833482228
  },
  "md5 56-char string": {
   "impl": "fast",
   "name": "md5 56-char string",
   "ms": 0.00021660335658538484,
   "min": 0.00021097648811578448,
   "samples": 113,
   "batch": 101353
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0007090250783698264,
   "min": 0.0007020094043886429,
   "samples": 111,
   "batch": 31900
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0006679801772036382,
   "min": 0.0006583811383090516,
   "samples": 111,
   "batch": 33295
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0006622367992418642,
   "min": 0.0006525483460182736,
   "samples": 112,
   "batch": 33767
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "fast",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 2.135933333333014,
   "min": 2.1174333333334894,
   "samples": 97,
   "batch": 12,
   "mbps": 490.92168919137146
  },
  "sha256.create(), 64 KB in 100 B updates": {
   "impl": "fast",
   "name": "sha256.create(), 64 KB in 100 B updates",
   "ms": 0.26688924731179114,
   "min": 0.2653870967743162,
   "samples": 101,
   "batch": 93,
   "mbps": 245.5550407523092
  },
  "hmac sha256, 56-char string": {
   "impl": "fast",
   "name": "hmac sha256, 56-char string",
   "ms": 0.0024227268134972496,
   "min": 0.002400868862396507,
   "samples": 104,
   "batch": 9898
  },
  "hmac sha256, 1 KB": {
   "impl": "fast",
   "name": "hmac sha256, 1 KB",
   "ms": 0.0045250141803734245,
   "min": 0.0044771790508599104,
   "samples": 105,
   "batch": 5289
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 2.6502449999999955,
   "min": 2.630439999999362,
   "samples": 94,
   "batch": 10
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 3.3644375000003492,
   "min": 3.3364999999994325,
   "samples": 93,
   "batch": 8
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "fast",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 16.05569999999716,
   "min": 15.652650000003632,
   "samples": 125,
   "batch": 2
  }
 }
}
```
