| case                                                  | acorn               | fast                       |
|-------------------------------------------------------|---------------------|----------------------------|
| parseExpressionAt x8 template expressions (locations) | 173.4 µs (1.4 MB/s) | 72.9 µs (3.2 MB/s)  x2.38  |
| parse+onComment+locations zod-schemas.js (51KB esm)   | 13.41 ms (3.8 MB/s) | 4.49 ms (11.5 MB/s)  x2.99 |

```json
{
 "acorn": {
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "acorn",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.1733927272727256,
   "min": 0.12268909090909222,
   "samples": 134,
   "batch": 55,
   "mbps": 1.3553048256192064
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "acorn",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 13.408200000000306,
   "min": 11.993199999999888,
   "samples": 103,
   "batch": 1,
   "mbps": 3.8316850882295035
  }
 },
 "fast": {
  "parseExpressionAt x8 template expressions (locations)": {
   "impl": "fast",
   "name": "parseExpressionAt x8 template expressions (locations)",
   "ms": 0.07294359999999961,
   "min": 0.06741480000000047,
   "samples": 79,
   "batch": 250,
   "mbps": 3.221667151059192
  },
  "parse+onComment+locations zod-schemas.js (51KB esm)": {
   "impl": "fast",
   "name": "parse+onComment+locations zod-schemas.js (51KB esm)",
   "ms": 4.485349999999926,
   "min": 4.014650000000074,
   "samples": 155,
   "batch": 2,
   "mbps": 11.454178603676601
  }
 }
}
```
