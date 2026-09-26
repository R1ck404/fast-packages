| case                                                  | acorn               | fast                       |
|-------------------------------------------------------|---------------------|----------------------------|
| parseExpressionAt x8 template expressions (locations) | 141.2 µs (1.7 MB/s) | 377.0 µs (0.6 MB/s)  x0.37 |
| parse+onComment+locations zod-schemas.js (51KB esm)   | 27.67 ms (1.9 MB/s) | 10.19 ms (5.0 MB/s)  x2.72 |

```json
{
 "acorn": {
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "acorn",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.1412311111111118,
   "min": 0.12121444444444478,
   "samples": 101,
   "batch": 90,
   "mbps": 1.6639393271863214
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 27.665399999999863,
   "min": 14.960799999999836,
   "samples": 54,
   "batch": 1,
   "mbps": 1.8570488769365434
  }
 },
 "fast": {
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "fast",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.376991071428571,
   "min": 0.2013464285714284,
   "samples": 140,
   "batch": 28,
   "mbps": 0.623356938161666
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 10.189650000000029,
   "min": 4.27789999999959,
   "samples": 108,
   "batch": 1,
   "mbps": 5.04197887071684
  }
 }
}
```
