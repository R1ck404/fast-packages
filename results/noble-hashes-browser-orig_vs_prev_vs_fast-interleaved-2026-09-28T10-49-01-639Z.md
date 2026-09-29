| case                                                     | orig     | prev            | fast            |
|----------------------------------------------------------|----------|-----------------|-----------------|
| sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity) | 10.98 ms | 1.86 ms  x5.89  | 1.84 ms  x5.97  |
| sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity) | 34.05 ms | 5.83 ms  x5.84  | 5.72 ms  x5.95  |
| sha256 1 MB                                              | 4.96 ms  | 2.19 ms  x2.27  | 2.12 ms  x2.34  |
| sha256 1 KB                                              | 5.8 us   | 2.6 us  x2.27   | 2.6 us  x2.28   |
| sha256 56-char string                                    | 2.4 us   | 0.6 us  x4.29   | 0.6 us  x4.17   |
| sha256.create().update(56-char string).digest()          | 2.5 us   | 1.0 us  x2.45   | 1.1 us  x2.42   |
| sha512 1 MB                                              | 8.15 ms  | 1.38 ms  x5.91  | 1.38 ms  x5.89  |
| sha512 1 KB                                              | 9.9 us   | 2.1 us  x4.72   | 2.1 us  x4.73   |
| sha512 56-char string                                    | 3.3 us   | 0.6 us  x5.21   | 0.7 us  x5.05   |
| sha512.create().update(56-char string).digest()          | 3.3 us   | 1.2 us  x2.86   | 1.2 us  x2.74   |
| sha1 1 MB                                                | 4.32 ms  | 1.29 ms  x3.35  | 1.00 ms  x4.30  |
| sha1 1 KB                                                | 5.2 us   | 1.6 us  x3.32   | 1.3 us  x4.00   |
| sha1 56-char string                                      | 2.5 us   | 0.5 us  x5.17   | 0.5 us  x5.13   |
| sha1.create().update(56-char string).digest()            | 2.4 us   | 0.9 us  x2.65   | 1.0 us  x2.43   |
| md5 1 MB                                                 | 6.59 ms  | 1.32 ms  x4.98  | 1.15 ms  x5.74  |
| md5 1 KB                                                 | 7.5 us   | 1.6 us  x4.76   | 1.4 us  x5.42   |
| md5 56-char string                                       | 2.7 us   | 0.5 us  x5.67   | 0.5 us  x5.72   |
| md5.create().update(56-char string).digest()             | 2.7 us   | 0.9 us  x2.91   | 1.0 us  x2.75   |
| sha256.create(), 1 MB in 16 KB updates                   | 5.04 ms  | 2.18 ms  x2.31  | 2.15 ms  x2.35  |
| hmac sha256, 56-char string                              | 6.0 us   | 3.3 us  x1.81   | 3.5 us  x1.68   |
| pbkdf2 sha256, c=10000                                   | 10.47 ms | 2.83 ms  x3.70  | 2.67 ms  x3.91  |
| pbkdf2 sha512, c=10000                                   | 27.62 ms | 4.14 ms  x6.67  | 3.37 ms  x8.20  |
| scrypt N=2^14 r=8 p=1                                    | 36.06 ms | 15.76 ms  x2.29 | 15.96 ms  x2.26 |

```json
{
 "orig": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 10.980000019073486,
   "min": 10.980000019073486,
   "samples": 1,
   "batch": 1,
   "mbps": 128.34480852022014
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 34.045000076293945,
   "min": 34.045000076293945,
   "samples": 1,
   "batch": 1,
   "mbps": 128.57888060479397
  },
  "sha256 1 MB": {
   "impl": "orig",
   "name": "sha256 1 MB",
   "ms": 4.963000011444092,
   "min": 4.963000011444092,
   "samples": 1,
   "batch": 1,
   "mbps": 211.27866161235292
  },
  "sha256 1 KB": {
   "impl": "orig",
   "name": "sha256 1 KB",
   "ms": 0.005841121495327103,
   "min": 0.005841121495327103,
   "samples": 1,
   "batch": 1,
   "mbps": 175.3088
  },
  "sha256 56-char string": {
   "impl": "orig",
   "name": "sha256 56-char string",
   "ms": 0.002376990729736154,
   "min": 0.002376990729736154,
   "samples": 1,
   "batch": 1
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.002546148949713558,
   "min": 0.002546148949713558,
   "samples": 1,
   "batch": 1
  },
  "sha512 1 MB": {
   "impl": "orig",
   "name": "sha512 1 MB",
   "ms": 8.146666685740152,
   "min": 8.146666685740152,
   "samples": 1,
   "batch": 1,
   "mbps": 128.71227465773424
  },
  "sha512 1 KB": {
   "impl": "orig",
   "name": "sha512 1 KB",
   "ms": 0.009861932938856016,
   "min": 0.009861932938856016,
   "samples": 1,
   "batch": 1,
   "mbps": 103.8336
  },
  "sha512 56-char string": {
   "impl": "orig",
   "name": "sha512 56-char string",
   "ms": 0.003306995870645154,
   "min": 0.003306995870645154,
   "samples": 1,
   "batch": 1
  },
  "sha512.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha512.create().update(56-char string).digest()",
   "ms": 0.0033372267645586516,
   "min": 0.0033372267645586516,
   "samples": 1,
   "batch": 1
  },
  "sha1 1 MB": {
   "impl": "orig",
   "name": "sha1 1 MB",
   "ms": 4.322000002861023,
   "min": 4.322000002861023,
   "samples": 1,
   "batch": 1,
   "mbps": 242.6136046519845
  },
  "sha1 1 KB": {
   "impl": "orig",
   "name": "sha1 1 KB",
   "ms": 0.00518000518000518,
   "min": 0.00518000518000518,
   "samples": 1,
   "batch": 1,
   "mbps": 197.6832
  },
  "sha1 56-char string": {
   "impl": "orig",
   "name": "sha1 56-char string",
   "ms": 0.0024906600249066002,
   "min": 0.0024906600249066002,
   "samples": 1,
   "batch": 1
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.002439917042820544,
   "min": 0.002439917042820544,
   "samples": 1,
   "batch": 1
  },
  "md5 1 MB": {
   "impl": "orig",
   "name": "md5 1 MB",
   "ms": 6.586250007152557,
   "min": 6.586250007152557,
   "samples": 1,
   "batch": 1,
   "mbps": 159.20683224312225
  },
  "md5 1 KB": {
   "impl": "orig",
   "name": "md5 1 KB",
   "ms": 0.007527286413248024,
   "min": 0.007527286413248024,
   "samples": 1,
   "batch": 1,
   "mbps": 136.0384
  },
  "md5 56-char string": {
   "impl": "orig",
   "name": "md5 56-char string",
   "ms": 0.002721458701864199,
   "min": 0.002721458701864199,
   "samples": 1,
   "batch": 1
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0027188689505165853,
   "min": 0.0027188689505165853,
   "samples": 1,
   "batch": 1
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "orig",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 5.041249990463257,
   "min": 5.041249990463257,
   "samples": 1,
   "batch": 1,
   "mbps": 207.99920693947632
  },
  "hmac sha256, 56-char string": {
   "impl": "orig",
   "name": "hmac sha256, 56-char string",
   "ms": 0.005975500448162534,
   "min": 0.005975500448162534,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 10.46749997138977,
   "min": 10.46749997138977,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 27.615000009536743,
   "min": 27.615000009536743,
   "samples": 1,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "orig",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 36.06499993801117,
   "min": 36.06499993801117,
   "samples": 1,
   "batch": 1
  }
 },
 "prev": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "prev",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 1.8627272735942493,
   "min": 1.8627272735942493,
   "samples": 1,
   "batch": 1,
   "mbps": 756.5390918879982
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "prev",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 5.833750009536743,
   "min": 5.833750009536743,
   "samples": 1,
   "batch": 1,
   "mbps": 750.3694866670528
  },
  "sha256 1 MB": {
   "impl": "prev",
   "name": "sha256 1 MB",
   "ms": 2.186500000953674,
   "min": 2.186500000953674,
   "samples": 1,
   "batch": 1,
   "mbps": 479.56825956672674
  },
  "sha256 1 KB": {
   "impl": "prev",
   "name": "sha256 1 KB",
   "ms": 0.0025786487880350697,
   "min": 0.0025786487880350697,
   "samples": 1,
   "batch": 1,
   "mbps": 397.1072
  },
  "sha256 56-char string": {
   "impl": "prev",
   "name": "sha256 56-char string",
   "ms": 0.000553495322964521,
   "min": 0.000553495322964521,
   "samples": 1,
   "batch": 1
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0010378288620206527,
   "min": 0.0010378288620206527,
   "samples": 1,
   "batch": 1
  },
  "sha512 1 MB": {
   "impl": "prev",
   "name": "sha512 1 MB",
   "ms": 1.3773333311080933,
   "min": 1.3773333311080933,
   "samples": 1,
   "batch": 1,
   "mbps": 761.3088105233021
  },
  "sha512 1 KB": {
   "impl": "prev",
   "name": "sha512 1 KB",
   "ms": 0.0020905194940942823,
   "min": 0.0020905194940942823,
   "samples": 1,
   "batch": 1,
   "mbps": 489.8304
  },
  "sha512 56-char string": {
   "impl": "prev",
   "name": "sha512 56-char string",
   "ms": 0.0006347191367819739,
   "min": 0.0006347191367819739,
   "samples": 1,
   "batch": 1
  },
  "sha512.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "sha512.create().update(56-char string).digest()",
   "ms": 0.0011660447761194029,
   "min": 0.0011660447761194029,
   "samples": 1,
   "batch": 1
  },
  "sha1 1 MB": {
   "impl": "prev",
   "name": "sha1 1 MB",
   "ms": 1.291874997317791,
   "min": 1.291874997317791,
   "samples": 1,
   "batch": 1,
   "mbps": 811.6698613852487
  },
  "sha1 1 KB": {
   "impl": "prev",
   "name": "sha1 1 KB",
   "ms": 0.0015584820384945063,
   "min": 0.0015584820384945063,
   "samples": 1,
   "batch": 1,
   "mbps": 657.0495999999999
  },
  "sha1 56-char string": {
   "impl": "prev",
   "name": "sha1 56-char string",
   "ms": 0.00048214845350883536,
   "min": 0.00048214845350883536,
   "samples": 1,
   "batch": 1
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0009205983889528193,
   "min": 0.0009205983889528193,
   "samples": 1,
   "batch": 1
  },
  "md5 1 MB": {
   "impl": "prev",
   "name": "md5 1 MB",
   "ms": 1.3212499991059303,
   "min": 1.3212499991059303,
   "samples": 1,
   "batch": 1,
   "mbps": 793.6242200261535
  },
  "md5 1 KB": {
   "impl": "prev",
   "name": "md5 1 KB",
   "ms": 0.001582528881152081,
   "min": 0.001582528881152081,
   "samples": 1,
   "batch": 1,
   "mbps": 647.0656
  },
  "md5 56-char string": {
   "impl": "prev",
   "name": "md5 56-char string",
   "ms": 0.00048033046736154476,
   "min": 0.00048033046736154476,
   "samples": 1,
   "batch": 1
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "prev",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0009353661958656814,
   "min": 0.0009353661958656814,
   "samples": 1,
   "batch": 1
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "prev",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 2.18400000333786,
   "min": 2.18400000333786,
   "samples": 1,
   "batch": 1,
   "mbps": 480.1172153834413
  },
  "hmac sha256, 56-char string": {
   "impl": "prev",
   "name": "hmac sha256, 56-char string",
   "ms": 0.003301964668978042,
   "min": 0.003301964668978042,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "prev",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 2.830624997615814,
   "min": 2.830624997615814,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "prev",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 4.1400000095367435,
   "min": 4.1400000095367435,
   "samples": 1,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "prev",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 15.757499992847443,
   "min": 15.757499992847443,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 1.837727275761691,
   "min": 1.837727275761691,
   "samples": 1,
   "batch": 1,
   "mbps": 766.830866901027
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 5.719999998807907,
   "min": 5.719999998807907,
   "samples": 1,
   "batch": 1,
   "mbps": 765.2916085511013
  },
  "sha256 1 MB": {
   "impl": "fast",
   "name": "sha256 1 MB",
   "ms": 2.124500000476837,
   "min": 2.124500000476837,
   "samples": 1,
   "batch": 1,
   "mbps": 493.5636619273479
  },
  "sha256 1 KB": {
   "impl": "fast",
   "name": "sha256 1 KB",
   "ms": 0.0025637738751442124,
   "min": 0.0025637738751442124,
   "samples": 1,
   "batch": 1,
   "mbps": 399.41119999999995
  },
  "sha256 56-char string": {
   "impl": "fast",
   "name": "sha256 56-char string",
   "ms": 0.0005702554744525547,
   "min": 0.0005702554744525547,
   "samples": 1,
   "batch": 1
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0010503650018381387,
   "min": 0.0010503650018381387,
   "samples": 1,
   "batch": 1
  },
  "sha512 1 MB": {
   "impl": "fast",
   "name": "sha512 1 MB",
   "ms": 1.3836666663487753,
   "min": 1.3836666663487753,
   "samples": 1,
   "batch": 1,
   "mbps": 757.8241389358509
  },
  "sha512 1 KB": {
   "impl": "fast",
   "name": "sha512 1 KB",
   "ms": 0.002086375964948884,
   "min": 0.002086375964948884,
   "samples": 1,
   "batch": 1,
   "mbps": 490.8031999999999
  },
  "sha512 56-char string": {
   "impl": "fast",
   "name": "sha512 56-char string",
   "ms": 0.0006542147787118512,
   "min": 0.0006542147787118512,
   "samples": 1,
   "batch": 1
  },
  "sha512.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha512.create().update(56-char string).digest()",
   "ms": 0.0012184720360667724,
   "min": 0.0012184720360667724,
   "samples": 1,
   "batch": 1
  },
  "sha1 1 MB": {
   "impl": "fast",
   "name": "sha1 1 MB",
   "ms": 1.00450000166893,
   "min": 1.00450000166893,
   "samples": 1,
   "batch": 1,
   "mbps": 1043.8785448062117
  },
  "sha1 1 KB": {
   "impl": "fast",
   "name": "sha1 1 KB",
   "ms": 0.0012962602890660444,
   "min": 0.0012962602890660444,
   "samples": 1,
   "batch": 1,
   "mbps": 789.9648
  },
  "sha1 56-char string": {
   "impl": "fast",
   "name": "sha1 56-char string",
   "ms": 0.0004854840275754928,
   "min": 0.0004854840275754928,
   "samples": 1,
   "batch": 1
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.001004974624390734,
   "min": 0.001004974624390734,
   "samples": 1,
   "batch": 1
  },
  "md5 1 MB": {
   "impl": "fast",
   "name": "md5 1 MB",
   "ms": 1.1472222208976746,
   "min": 1.1472222208976746,
   "samples": 1,
   "batch": 1,
   "mbps": 914.0129792635238
  },
  "md5 1 KB": {
   "impl": "fast",
   "name": "md5 1 KB",
   "ms": 0.0013886960144424386,
   "min": 0.0013886960144424386,
   "samples": 1,
   "batch": 1,
   "mbps": 737.3824
  },
  "md5 56-char string": {
   "impl": "fast",
   "name": "md5 56-char string",
   "ms": 0.00047561294618439514,
   "min": 0.00047561294618439514,
   "samples": 1,
   "batch": 1
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.000990049997524875,
   "min": 0.000990049997524875,
   "samples": 1,
   "batch": 1
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "fast",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 2.149500000476837,
   "min": 2.149500000476837,
   "samples": 1,
   "batch": 1,
   "mbps": 487.8232145928764
  },
  "hmac sha256, 56-char string": {
   "impl": "fast",
   "name": "hmac sha256, 56-char string",
   "ms": 0.00354924578527063,
   "min": 0.00354924578527063,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 2.6749999970197678,
   "min": 2.6749999970197678,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 3.369166672229767,
   "min": 3.369166672229767,
   "samples": 1,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "fast",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 15.957499980926514,
   "min": 15.957499980926514,
   "samples": 1,
   "batch": 1
  }
 }
}
```
