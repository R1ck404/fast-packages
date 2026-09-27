| case                                                     | orig     | fast            |
|----------------------------------------------------------|----------|-----------------|
| sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity) | 12.24 ms | 2.17 ms  x5.63  |
| sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity) | 42.61 ms | 7.30 ms  x5.84  |
| sha256 1 MB                                              | 7.85 ms  | 3.44 ms  x2.28  |
| sha256 1 KB                                              | 9.4 us   | 4.1 us  x2.31   |
| sha256 56-char string                                    | 3.9 us   | 0.9 us  x4.15   |
| sha256.create().update(56-char string).digest()          | 4.1 us   | 1.8 us  x2.32   |
| sha512 1 MB                                              | 12.93 ms | 2.45 ms  x5.28  |
| sha512 1 KB                                              | 16.0 us  | 3.2 us  x5.00   |
| sha512 56-char string                                    | 5.3 us   | 1.0 us  x5.19   |
| sha512.create().update(56-char string).digest()          | 5.4 us   | 1.9 us  x2.84   |
| sha1 1 MB                                                | 7.10 ms  | 1.74 ms  x4.08  |
| sha1 1 KB                                                | 8.4 us   | 2.2 us  x3.73   |
| sha1 56-char string                                      | 3.9 us   | 0.8 us  x4.92   |
| sha1.create().update(56-char string).digest()            | 3.9 us   | 1.6 us  x2.42   |
| md5 1 MB                                                 | 8.94 ms  | 1.47 ms  x6.09  |
| md5 1 KB                                                 | 10.5 us  | 1.9 us  x5.39   |
| md5 56-char string                                       | 4.3 us   | 0.8 us  x5.59   |
| md5.create().update(56-char string).digest()             | 4.3 us   | 1.7 us  x2.56   |
| sha256.create(), 1 MB in 16 KB updates                   | 7.79 ms  | 3.60 ms  x2.16  |
| hmac sha256, 56-char string                              | 9.5 us   | 5.9 us  x1.62   |
| pbkdf2 sha256, c=10000                                   | 19.83 ms | 4.73 ms  x4.20  |
| pbkdf2 sha512, c=10000                                   | 45.55 ms | 6.79 ms  x6.71  |
| scrypt N=2^14 r=8 p=1                                    | 56.77 ms | 19.31 ms  x2.94 |

```json
{
 "orig": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 12.237500011920929,
   "min": 12.237500011920929,
   "samples": 1,
   "batch": 1,
   "mbps": 115.15636352418625
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "orig",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 42.610000014305115,
   "min": 42.610000014305115,
   "samples": 1,
   "batch": 1,
   "mbps": 102.73334894462305
  },
  "sha256 1 MB": {
   "impl": "orig",
   "name": "sha256 1 MB",
   "ms": 7.853333314259847,
   "min": 7.853333314259847,
   "samples": 1,
   "batch": 1,
   "mbps": 133.51986450085178
  },
  "sha256 1 KB": {
   "impl": "orig",
   "name": "sha256 1 KB",
   "ms": 0.009396430246703441,
   "min": 0.009396430246703441,
   "samples": 1,
   "batch": 1,
   "mbps": 108.97755563707302
  },
  "sha256 56-char string": {
   "impl": "orig",
   "name": "sha256 56-char string",
   "ms": 0.003929273084479371,
   "min": 0.003929273084479371,
   "samples": 1,
   "batch": 1
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0041245617653124355,
   "min": 0.0041245617653124355,
   "samples": 1,
   "batch": 1
  },
  "sha512 1 MB": {
   "impl": "orig",
   "name": "sha512 1 MB",
   "ms": 12.930000007152557,
   "min": 12.930000007152557,
   "samples": 1,
   "batch": 1,
   "mbps": 81.09636499767622
  },
  "sha512 1 KB": {
   "impl": "orig",
   "name": "sha512 1 KB",
   "ms": 0.015956937791438003,
   "min": 0.015956937791438003,
   "samples": 1,
   "batch": 1,
   "mbps": 64.17271367376306
  },
  "sha512 56-char string": {
   "impl": "orig",
   "name": "sha512 56-char string",
   "ms": 0.005307203411298283,
   "min": 0.005307203411298283,
   "samples": 1,
   "batch": 1
  },
  "sha512.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha512.create().update(56-char string).digest()",
   "ms": 0.005400917925278518,
   "min": 0.005400917925278518,
   "samples": 1,
   "batch": 1
  },
  "sha1 1 MB": {
   "impl": "orig",
   "name": "sha1 1 MB",
   "ms": 7.099999984105428,
   "min": 7.099999984105428,
   "samples": 1,
   "batch": 1,
   "mbps": 147.68676089400253
  },
  "sha1 1 KB": {
   "impl": "orig",
   "name": "sha1 1 KB",
   "ms": 0.008366792135186795,
   "min": 0.008366792135186795,
   "samples": 1,
   "batch": 1,
   "mbps": 122.38860287846009
  },
  "sha1 56-char string": {
   "impl": "orig",
   "name": "sha1 56-char string",
   "ms": 0.003891807744697412,
   "min": 0.003891807744697412,
   "samples": 1,
   "batch": 1
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.003878975950349108,
   "min": 0.003878975950349108,
   "samples": 1,
   "batch": 1
  },
  "md5 1 MB": {
   "impl": "orig",
   "name": "md5 1 MB",
   "ms": 8.943333347638449,
   "min": 8.943333347638449,
   "samples": 1,
   "batch": 1,
   "mbps": 117.24666399434658
  },
  "md5 1 KB": {
   "impl": "orig",
   "name": "md5 1 KB",
   "ms": 0.01048767697954903,
   "min": 0.01048767697954903,
   "samples": 1,
   "batch": 1,
   "mbps": 97.63839999999999
  },
  "md5 56-char string": {
   "impl": "orig",
   "name": "md5 56-char string",
   "ms": 0.004278990158322636,
   "min": 0.004278990158322636,
   "samples": 1,
   "batch": 1
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "orig",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0043308791684712,
   "min": 0.0043308791684712,
   "samples": 1,
   "batch": 1
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "orig",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 7.785000006357829,
   "min": 7.785000006357829,
   "samples": 1,
   "batch": 1,
   "mbps": 134.69184317837536
  },
  "hmac sha256, 56-char string": {
   "impl": "orig",
   "name": "hmac sha256, 56-char string",
   "ms": 0.009505703422053232,
   "min": 0.009505703422053232,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 19.8299999833107,
   "min": 19.8299999833107,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "orig",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 45.55499994754791,
   "min": 45.55499994754791,
   "samples": 1,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "orig",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 56.77499997615814,
   "min": 56.77499997615814,
   "samples": 1,
   "batch": 1
  }
 },
 "fast": {
  "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 react-dom-19.3.0.tgz (1.4 MB, lockfile integrity)",
   "ms": 2.1735000014305115,
   "min": 2.1735000014305115,
   "samples": 1,
   "batch": 1,
   "mbps": 648.3671493317246
  },
  "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)": {
   "impl": "fast",
   "name": "sha512 typescript-5.9.3.tgz (4.4 MB, lockfile integrity)",
   "ms": 7.299999992052714,
   "min": 7.299999992052714,
   "samples": 1,
   "batch": 1,
   "mbps": 599.6531513377555
  },
  "sha256 1 MB": {
   "impl": "fast",
   "name": "sha256 1 MB",
   "ms": 3.4424999952316284,
   "min": 3.4424999952316284,
   "samples": 1,
   "batch": 1,
   "mbps": 304.59724079954475
  },
  "sha256 1 KB": {
   "impl": "fast",
   "name": "sha256 1 KB",
   "ms": 0.004067520846044336,
   "min": 0.004067520846044336,
   "samples": 1,
   "batch": 1,
   "mbps": 251.75039999999996
  },
  "sha256 56-char string": {
   "impl": "fast",
   "name": "sha256 56-char string",
   "ms": 0.0009459842966606754,
   "min": 0.0009459842966606754,
   "samples": 1,
   "batch": 1
  },
  "sha256.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha256.create().update(56-char string).digest()",
   "ms": 0.0017780938833570413,
   "min": 0.0017780938833570413,
   "samples": 1,
   "batch": 1
  },
  "sha512 1 MB": {
   "impl": "fast",
   "name": "sha512 1 MB",
   "ms": 2.4483333296246,
   "min": 2.4483333296246,
   "samples": 1,
   "batch": 1,
   "mbps": 428.2815527250029
  },
  "sha512 1 KB": {
   "impl": "fast",
   "name": "sha512 1 KB",
   "ms": 0.003188267176789415,
   "min": 0.003188267176789415,
   "samples": 1,
   "batch": 1,
   "mbps": 321.1776
  },
  "sha512 56-char string": {
   "impl": "fast",
   "name": "sha512 56-char string",
   "ms": 0.0010232272587741738,
   "min": 0.0010232272587741738,
   "samples": 1,
   "batch": 1
  },
  "sha512.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha512.create().update(56-char string).digest()",
   "ms": 0.0018995156235160034,
   "min": 0.0018995156235160034,
   "samples": 1,
   "batch": 1
  },
  "sha1 1 MB": {
   "impl": "fast",
   "name": "sha1 1 MB",
   "ms": 1.740416665871938,
   "min": 1.740416665871938,
   "samples": 1,
   "batch": 1,
   "mbps": 602.4856119581399
  },
  "sha1 1 KB": {
   "impl": "fast",
   "name": "sha1 1 KB",
   "ms": 0.00224517287831163,
   "min": 0.00224517287831163,
   "samples": 1,
   "batch": 1,
   "mbps": 456.08959999999996
  },
  "sha1 56-char string": {
   "impl": "fast",
   "name": "sha1 56-char string",
   "ms": 0.0007907638779060573,
   "min": 0.0007907638779060573,
   "samples": 1,
   "batch": 1
  },
  "sha1.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "sha1.create().update(56-char string).digest()",
   "ms": 0.0016014092401313155,
   "min": 0.0016014092401313155,
   "samples": 1,
   "batch": 1
  },
  "md5 1 MB": {
   "impl": "fast",
   "name": "md5 1 MB",
   "ms": 1.468571424484253,
   "min": 1.468571424484253,
   "samples": 1,
   "batch": 1,
   "mbps": 714.0108969287952
  },
  "md5 1 KB": {
   "impl": "fast",
   "name": "md5 1 KB",
   "ms": 0.0019460932178651357,
   "min": 0.0019460932178651357,
   "samples": 1,
   "batch": 1,
   "mbps": 526.1823999999999
  },
  "md5 56-char string": {
   "impl": "fast",
   "name": "md5 56-char string",
   "ms": 0.000765345170671973,
   "min": 0.000765345170671973,
   "samples": 1,
   "batch": 1
  },
  "md5.create().update(56-char string).digest()": {
   "impl": "fast",
   "name": "md5.create().update(56-char string).digest()",
   "ms": 0.0016909029421711193,
   "min": 0.0016909029421711193,
   "samples": 1,
   "batch": 1
  },
  "sha256.create(), 1 MB in 16 KB updates": {
   "impl": "fast",
   "name": "sha256.create(), 1 MB in 16 KB updates",
   "ms": 3.6041666666666665,
   "min": 3.6041666666666665,
   "samples": 1,
   "batch": 1,
   "mbps": 290.9343815028902
  },
  "hmac sha256, 56-char string": {
   "impl": "fast",
   "name": "hmac sha256, 56-char string",
   "ms": 0.005863130127559094,
   "min": 0.005863130127559094,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha256, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha256, c=10000",
   "ms": 4.7259999990463255,
   "min": 4.7259999990463255,
   "samples": 1,
   "batch": 1
  },
  "pbkdf2 sha512, c=10000": {
   "impl": "fast",
   "name": "pbkdf2 sha512, c=10000",
   "ms": 6.785000006357829,
   "min": 6.785000006357829,
   "samples": 1,
   "batch": 1
  },
  "scrypt N=2^14 r=8 p=1": {
   "impl": "fast",
   "name": "scrypt N=2^14 r=8 p=1",
   "ms": 19.30750000476837,
   "min": 19.30750000476837,
   "samples": 1,
   "batch": 1
  }
 }
}
```
