| case                                                     | orig     | fast            |
|----------------------------------------------------------|----------|-----------------|
| sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity) | 11.54 ms | 2.28 ms  x5.07  |
| sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity) | 46.55 ms | 9.53 ms  x4.88  |
| sha256 1 MB                                              | 5.52 ms  | 3.53 ms  x1.57  |
| sha256 64 KB                                             | 345.8 us | 207.3 us  x1.67 |
| sha256 1 KB                                              | 6.7 us   | 3.7 us  x1.79   |
| sha256 56-char string                                    | 2.0 us   | 0.5 us  x4.22   |
| sha512 1 MB                                              | 11.54 ms | 2.29 ms  x5.03  |
| sha512 64 KB                                             | 716.0 us | 141.5 us  x5.06 |
| sha512 1 KB                                              | 14.4 us  | 2.8 us  x5.15   |
| sha512 56-char string                                    | 3.3 us   | 0.6 us  x5.70   |
| sha384 1 MB                                              | 10.54 ms | 2.24 ms  x4.70  |
| sha384 1 KB                                              | 14.2 us  | 3.0 us  x4.78   |
| sha384 56-char string                                    | 3.5 us   | 0.6 us  x5.90   |
| sha1 1 MB                                                | 4.12 ms  | 1.72 ms  x2.39  |
| sha1 1 KB                                                | 5.4 us   | 1.9 us  x2.86   |
| sha1 56-char string                                      | 1.9 us   | 0.3 us  x5.64   |
| md5 1 MB                                                 | 9.98 ms  | 1.45 ms  x6.88  |
| md5 1 KB                                                 | 11.5 us  | 1.7 us  x6.73   |
| md5 56-char string                                       | 2.2 us   | 0.3 us  x7.16   |
| sha256.create().update(56-char string).digest()          | 1.9 us   | 1.3 us  x1.44   |
| sha1.create().update(56-char string).digest()            | 1.9 us   | 1.2 us  x1.66   |
| md5.create().update(56-char string).digest()             | 2.2 us   | 1.1 us  x2.07   |
| sha256.create(), 1 MB in 16 KB updates                   | 5.60 ms  | 3.46 ms  x1.62  |
| sha256.create(), 64 KB in 100 B updates                  | 496.1 us | 424.3 us  x1.17 |
| hmac sha256, 56-char string                              | 5.2 us   | 3.7 us  x1.39   |
| hmac sha256, 1 KB                                        | 10.2 us  | 7.2 us  x1.41   |
| pbkdf2 sha256, c=10000                                   | 15.48 ms | 4.68 ms  x3.30  |
| pbkdf2 sha512, c=10000                                   | 39.28 ms | 6.92 ms  x5.68  |
| scrypt N=2^14 r=8 p=1                                    | 55.30 ms | 17.89 ms  x3.09 |

```json
{
 "orig": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 11.540000000000001,
   "min": 10.669033333333422,
   "samples": 71,
   "batch": 3,
   "mbps": 122.11663778162911
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 46.55090000000018,
   "min": 39.76940000000013,
   "samples": 55,
   "batch": 1,
   "mbps": 94.03616256613691
  },
  "sha256 1 MB": {
   "impl": "orig",
   "name": "sha256 1 MB",
   "ms": 5.524579999999878,
   "min": 4.529799999999886,
   "samples": 91,
   "batch": 5,
   "mbps": 189.80193969496742
  },
  "sha256 64 KB": {
   "impl": "orig",
   "name": "sha256 64 KB",
   "ms": 0.34578281249999065,
   "min": 0.28996250000000146,
   "samples": 114,
   "batch": 64,
   "mbps": 189.529374020005
  },
  "sha256 1 KB": {
   "impl": "orig",
   "name": "sha256 1 KB",
   "ms": 0.006710135329686088,
   "min": 0.005513245033112855,
   "samples": 108,
   "batch": 3473,
   "mbps": 152.60496989826052
  },
  "sha256 56-char string": {
   "impl": "orig",
   "name": "sha256 56-char string",
   "ms": 0.0019740146538654996,
   "min": 0.0014962607377462538,
   "samples": 102,
   "batch": 11874
  },
  "sha512 1 MB": {
   "impl": "orig",
   "name": "sha512 1 MB",
   "ms": 11.539299999999153,
   "min": 10.475833333333867,
   "samples": 71,
   "batch": 3,
   "mbps": 90.86998344787611
  },
  "sha512 64 KB": {
   "impl": "orig",
   "name": "sha512 64 KB",
   "ms": 0.7160249999999451,
   "min": 0.5640968750000184,
   "samples": 110,
   "batch": 32,
   "mbps": 91.52753046332883
  },
  "sha512 1 KB": {
   "impl": "orig",
   "name": "sha512 1 KB",
   "ms": 0.014351980792317325,
   "min": 0.01267803121248414,
   "samples": 103,
   "batch": 1666,
   "mbps": 71.3490364025676
  },
  "sha512 56-char string": {
   "impl": "orig",
   "name": "sha512 56-char string",
   "ms": 0.003308408611863852,
   "min": 0.00263065341764522,
   "samples": 116,
   "batch": 6642
  },
  "sha384 1 MB": {
   "impl": "orig",
   "name": "sha384 1 MB",
   "ms": 10.544566666666771,
   "min": 8.595399999999549,
   "samples": 78,
   "batch": 3,
   "mbps": 99.44230361924052
  },
  "sha384 1 KB": {
   "impl": "orig",
   "name": "sha384 1 KB",
   "ms": 0.014231791569086528,
   "min": 0.010461358313818626,
   "samples": 105,
   "batch": 1708,
   "mbps": 71.9515877554217
  },
  "sha384 56-char string": {
   "impl": "orig",
   "name": "sha384 56-char string",
   "ms": 0.0034800608941038848,
   "min": 0.002830387642952725,
   "samples": 104,
   "batch": 6733
  },
  "sha1 1 MB": {
   "impl": "orig",
   "name": "sha1 1 MB",
   "ms": 4.118358333333768,
   "min": 3.5279166666659876,
   "samples": 102,
   "batch": 6,
   "mbps": 254.61019054920084
  },
  "sha1 1 KB": {
   "impl": "orig",
   "name": "sha1 1 KB",
   "ms": 0.005448464963674475,
   "min": 0.0046796812749010964,
   "samples": 108,
   "batch": 4267,
   "mbps": 187.94284387017672
  },
  "sha1 56-char string": {
   "impl": "orig",
   "name": "sha1 56-char string",
   "ms": 0.0018796146373057441,
   "min": 0.001599919041450566,
   "samples": 108,
   "batch": 12352
  },
  "md5 1 MB": {
   "impl": "orig",
   "name": "md5 1 MB",
   "ms": 9.981866666666367,
   "min": 9.758433333333718,
   "samples": 84,
   "batch": 3,
   "mbps": 105.0480871981224
  },
  "md5 1 KB": {
   "impl": "orig",
   "name": "md5 1 KB",
   "ms": 0.011471232876713474,
   "min": 0.010910420743640901,
   "samples": 107,
   "batch": 2044,
   "mbps": 89.26677812275202
  },
  "md5 56-char string": {
   "impl": "orig",
   "name": "md5 56-char string",
   "ms": 0.002243877068557859,
   "min": 0.0018076406619384946,
   "samples": 107,
   "batch": 10575
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0019206911335964982,
   "min": 0.0016488681186757703,
   "samples": 107,
   "batch": 11662
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0019438538781162498,
   "min": 0.001535647506924839,
   "samples": 113,
   "batch": 11552
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0022329899912548346,
   "min": 0.0019144689534547226,
   "samples": 109,
   "batch": 10291
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "orig",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 5.603320000000531,
   "min": 4.884799999999814,
   "samples": 89,
   "batch": 5,
   "mbps": 187.13477010056548
  },
  "sha256.create(), 64 KB in 100 B updates": {
   "impl": "orig",
   "name": "sha256.create(), 64 KB in 100 B updates",
   "ms": 0.49614999999998277,
   "min": 0.4102739130435309,
   "samples": 110,
   "batch": 46,
   "mbps": 132.08908596191125
  },
  "hmac sha256, 56-char string": {
   "impl": "orig",
   "name": "hmac sha256, 56-char string",
   "ms": 0.005171776536312969,
   "min": 0.004066212290501893,
   "samples": 108,
   "batch": 4475
  },
  "hmac sha256, 1 KB": {
   "impl": "orig",
   "name": "hmac sha256, 1 KB",
   "ms": 0.010212373403784746,
   "min": 0.008246367239098898,
   "samples": 109,
   "batch": 2271
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 15.476800000004005,
   "min": 13.127699999997276,
   "samples": 81,
   "batch": 2
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 39.282500000001164,
   "min": 28.58859999998822,
   "samples": 64,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "orig",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 55.29755000000296,
   "min": 49.905200000008335,
   "samples": 72,
   "batch": 1
  }
 },
 "fast": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 2.2757272727272637,
   "min": 2.008527272727261,
   "samples": 99,
   "batch": 11,
   "mbps": 619.2420405065338
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 9.533766666666756,
   "min": 7.9980333333332965,
   "samples": 87,
   "batch": 3,
   "mbps": 459.1540943943065
  },
  "sha256 1 MB": {
   "impl": "fast",
   "name": "sha256 1 MB",
   "ms": 3.526178571428643,
   "min": 2.832685714285747,
   "samples": 102,
   "batch": 7,
   "mbps": 297.3689445271531
  },
  "sha256 64 KB": {
   "impl": "fast",
   "name": "sha256 64 KB",
   "ms": 0.2072657024793353,
   "min": 0.17215454545454903,
   "samples": 100,
   "batch": 121,
   "mbps": 316.19317241613595
  },
  "sha256 1 KB": {
   "impl": "fast",
   "name": "sha256 1 KB",
   "ms": 0.0037439950980392633,
   "min": 0.0029206648284313733,
   "samples": 104,
   "batch": 6528,
   "mbps": 273.5046315996168
  },
  "sha256 56-char string": {
   "impl": "fast",
   "name": "sha256 56-char string",
   "ms": 0.0004672497187851378,
   "min": 0.00040548256467945004,
   "samples": 118,
   "batch": 44450
  },
  "sha512 1 MB": {
   "impl": "fast",
   "name": "sha512 1 MB",
   "ms": 2.292763636363485,
   "min": 1.8296363636363822,
   "samples": 99,
   "batch": 11,
   "mbps": 457.3415171845316
  },
  "sha512 64 KB": {
   "impl": "fast",
   "name": "sha512 64 KB",
   "ms": 0.14154441176470917,
   "min": 0.11724941176469335,
   "samples": 104,
   "batch": 170,
   "mbps": 463.0066223238909
  },
  "sha512 1 KB": {
   "impl": "fast",
   "name": "sha512 1 KB",
   "ms": 0.0027887651102159365,
   "min": 0.0023648139369516,
   "samples": 107,
   "batch": 8438,
   "mbps": 367.1876115520933
  },
  "sha512 56-char string": {
   "impl": "fast",
   "name": "sha512 56-char string",
   "ms": 0.0005803679197266177,
   "min": 0.00046306745194987927,
   "samples": 105,
   "batch": 41259
  },
  "sha384 1 MB": {
   "impl": "fast",
   "name": "sha384 1 MB",
   "ms": 2.242286363636264,
   "min": 1.8846454545452038,
   "samples": 102,
   "batch": 11,
   "mbps": 467.636969570447
  },
  "sha384 1 KB": {
   "impl": "fast",
   "name": "sha384 1 KB",
   "ms": 0.0029772849462371626,
   "min": 0.002504644563918476,
   "samples": 123,
   "batch": 6696,
   "mbps": 343.9375197507316
  },
  "sha384 56-char string": {
   "impl": "fast",
   "name": "sha384 56-char string",
   "ms": 0.0005903369594056189,
   "min": 0.0005048607057575126,
   "samples": 112,
   "batch": 37690
  },
  "sha1 1 MB": {
   "impl": "fast",
   "name": "sha1 1 MB",
   "ms": 1.7233428571427274,
   "min": 1.385857142857276,
   "samples": 104,
   "batch": 14,
   "mbps": 608.4546645224856
  },
  "sha1 1 KB": {
   "impl": "fast",
   "name": "sha1 1 KB",
   "ms": 0.0019071457638149864,
   "min": 0.0015746724180026156,
   "samples": 107,
   "batch": 12287,
   "mbps": 536.928020620525
  },
  "sha1 56-char string": {
   "impl": "fast",
   "name": "sha1 56-char string",
   "ms": 0.00033330012650215985,
   "min": 0.000246541745730551,
   "samples": 119,
   "batch": 63240
  },
  "md5 1 MB": {
   "impl": "fast",
   "name": "md5 1 MB",
   "ms": 1.4506749999998445,
   "min": 1.4271055555553984,
   "samples": 96,
   "batch": 18,
   "mbps": 722.8193771865596
  },
  "md5 1 KB": {
   "impl": "fast",
   "name": "md5 1 KB",
   "ms": 0.001703804081059988,
   "min": 0.0016160998527453114,
   "samples": 104,
   "batch": 14261,
   "mbps": 601.0080685820042
  },
  "md5 56-char string": {
   "impl": "fast",
   "name": "md5 56-char string",
   "ms": 0.0003134120187327983,
   "min": 0.00025848299607544373,
   "samples": 118,
   "batch": 68543
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.001331160098234203,
   "min": 0.001090463103730696,
   "samples": 111,
   "batch": 17102
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0011721885367807225,
   "min": 0.0009572932158794777,
   "samples": 118,
   "batch": 17482
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0010800904088052088,
   "min": 0.0008946590015724975,
   "samples": 115,
   "batch": 20352
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "fast",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 3.4624250000006214,
   "min": 2.903874999999971,
   "samples": 91,
   "batch": 8,
   "mbps": 302.8443937413263
  },
  "sha256.create(), 64 KB in 100 B updates": {
   "impl": "fast",
   "name": "sha256.create(), 64 KB in 100 B updates",
   "ms": 0.42425245901636044,
   "min": 0.33202950819657895,
   "samples": 97,
   "batch": 61,
   "mbps": 154.47406044963606
  },
  "hmac sha256, 56-char string": {
   "impl": "fast",
   "name": "hmac sha256, 56-char string",
   "ms": 0.003726842105263181,
   "min": 0.003212096908940088,
   "samples": 112,
   "batch": 5985
  },
  "hmac sha256, 1 KB": {
   "impl": "fast",
   "name": "hmac sha256, 1 KB",
   "ms": 0.007237321258340697,
   "min": 0.005336447410231797,
   "samples": 110,
   "batch": 3147
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 4.684508333333119,
   "min": 3.697116666667474,
   "samples": 90,
   "batch": 6
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 6.91504999999961,
   "min": 5.491125000000466,
   "samples": 89,
   "batch": 4
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "fast",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 17.889400000000023,
   "min": 17.099499999996624,
   "samples": 112,
   "batch": 2
  }
 }
}
```
