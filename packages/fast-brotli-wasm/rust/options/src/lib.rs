// compress() options (the fastbrotli-options crate: built for size, see ../Cargo.toml).
//
// brotli-wasm reads them as
//   serde_json::from_str::<Options>(&JSON.stringify(options)).unwrap()
// (serde_json 1.0.79, serde 1.0.136) with
//   struct Options { #[serde(default = "default_quality")] quality: i32 }  // 11
// This is serde_json's parser for that one struct, without serde and without
// core::fmt: the same inputs accepted (a map or a sequence; other keys and
// later elements skipped), the same error (message, line, column; positions
// count bytes), and the message of the unwrap panic, built the way Rust
// formats it: the Debug form of the serde_json::Error, strings in it
// Debug-escaped as the Rust version that built brotli-wasm did. A float in the
// message is formatted by the JS side (shortest round-trip digits, as Rust's
// Display): the message holds a NUL there (Debug output never contains one) and
// the value goes to HDR[4..6].

/// the error: message (serde_json's ErrorCode text) and position (line 0: not known yet)
struct Error {
    msg: Vec<u8>,
    line: usize,
    col: usize,
}
type R<T> = Result<T, Error>;

const EOF_VALUE: &str = "EOF while parsing a value";
const EOF_LIST: &str = "EOF while parsing a list";
const EOF_OBJECT: &str = "EOF while parsing an object";
const EOF_STRING: &str = "EOF while parsing a string";
const INVALID_NUMBER: &str = "invalid number";
const OUT_OF_RANGE: &str = "number out of range";
const INVALID_ESCAPE: &str = "invalid escape";
const LONE_SURROGATE: &str = "lone leading surrogate in hex escape";
const TRAILING_CHARS: &str = "trailing characters";
const TRAILING_COMMA: &str = "trailing comma";

/// serde_json's ParserNumber
enum Number {
    U64(u64),
    I64(i64),
    F64(f64),
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
    float: f64,
}

fn push_u64(v: &mut Vec<u8>, mut x: u64) {
    let mut d = [0u8; 20];
    let mut k = d.len();
    loop {
        k -= 1;
        d[k] = b'0' + (x % 10) as u8;
        x /= 10;
        if x == 0 {
            break;
        }
    }
    v.extend_from_slice(&d[k..]);
}

// Code points brotli-wasm's Rust escapes as \u{...} in Debug output (not
// printable, or grapheme-extending, in its Unicode tables): range boundaries
// [start0, end0, start1, ...] as LEB128 deltas. Written by the package's
// tools/debug-escapes.mjs from brotli-wasm itself.
static DEBUG_ESCAPES: &[u8] = include_bytes!("debug_escapes.bin");

fn escaped(c: u32) -> bool {
    let (mut at, mut inside, mut i) = (0u32, false, 0usize);
    while i < DEBUG_ESCAPES.len() {
        let (mut v, mut s) = (0u32, 0);
        loop {
            let x = DEBUG_ESCAPES[i];
            i += 1;
            v |= ((x & 0x7f) as u32) << s;
            s += 7;
            if x < 0x80 {
                break;
            }
        }
        at += v;
        if c < at {
            break;
        }
        inside = !inside;
    }
    inside
}

/// `s` (UTF-8) as Rust's Debug prints a str: quoted, char::escape_debug
/// (`keep_nul`: a NUL is the float placeholder, left as it is)
fn push_debug(v: &mut Vec<u8>, s: &[u8], keep_nul: bool) {
    v.push(b'"');
    let mut i = 0;
    while i < s.len() {
        let b0 = s[i] as u32;
        let n = if b0 < 0x80 { 1 } else if b0 < 0xe0 { 2 } else if b0 < 0xf0 { 3 } else { 4 };
        let mut c = if n == 1 { b0 } else { b0 & (0x7f >> n) };
        for k in 1..n {
            c = c << 6 | (s[i + k] & 0x3f) as u32;
        }
        let special = match c {
            0 => b'0',
            9 => b't',
            10 => b'n',
            13 => b'r',
            0x22 | 0x5c => c as u8,
            _ => 0,
        };
        if c == 0 && keep_nul {
            v.push(0);
        } else if special != 0 {
            v.push(b'\\');
            v.push(special);
        } else if escaped(c) {
            v.extend_from_slice(b"\\u{");
            let mut k = 28;
            while k > 0 && c >> k == 0 {
                k -= 4;
            }
            loop {
                v.push(b"0123456789abcdef"[(c >> k & 15) as usize]);
                if k == 0 {
                    break;
                }
                k -= 4;
            }
            v.push(b'}');
        } else {
            v.extend_from_slice(&s[i..i + n]);
        }
        i += n;
    }
    v.push(b'"');
}

fn custom(parts: &[&[u8]]) -> Error {
    Error { msg: parts.concat(), line: 0, col: 0 }
}

impl<'a> Parser<'a> {
    fn error_at(&self, m: &[u8], k: usize) -> Error {
        let (mut line, mut col) = (1, 0);
        for &c in &self.b[..k] {
            if c == b'\n' {
                line += 1;
                col = 0;
            } else {
                col += 1;
            }
        }
        Error { msg: m.to_vec(), line, col }
    }
    /// Deserializer::error: at the current index (after the byte read)
    fn error(&self, m: &str) -> Error {
        self.error_at(m.as_bytes(), self.i)
    }
    /// peek_error
    fn peek_error(&self, m: &str) -> Error {
        self.error_at(m.as_bytes(), (self.i + 1).min(self.b.len()))
    }
    /// fix_position
    fn fix(&self, e: Error) -> Error {
        if e.line == 0 {
            self.error_at(&e.msg, self.i)
        } else {
            e
        }
    }
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn peek_digit(&self) -> bool {
        matches!(self.peek(), Some(b'0'..=b'9'))
    }
    fn whitespace(&mut self) -> Option<u8> {
        while let Some(b' ' | b'\n' | b'\t' | b'\r') = self.peek() {
            self.i += 1;
        }
        self.peek()
    }
    fn next(&mut self) -> Option<u8> {
        let c = self.peek();
        if c.is_some() {
            self.i += 1;
        }
        c
    }
    fn ident(&mut self, s: &[u8]) -> R<()> {
        for &e in s {
            match self.next() {
                None => return Err(self.error(EOF_VALUE)),
                Some(c) if c != e => return Err(self.error("expected ident")),
                _ => {}
            }
        }
        Ok(())
    }

    // ---- numbers (parse_integer .. f64_from_parts, without float_roundtrip)
    fn integer(&mut self, positive: bool) -> R<Number> {
        let sig = match self.next() {
            None => return Err(self.error(EOF_VALUE)),
            Some(b'0') => {
                if self.peek_digit() {
                    return Err(self.peek_error(INVALID_NUMBER));
                }
                0
            }
            Some(c @ b'1'..=b'9') => {
                let mut sig = (c - b'0') as u64;
                while self.peek_digit() {
                    let d = (self.b[self.i] - b'0') as u64;
                    match sig.checked_mul(10).and_then(|x| x.checked_add(d)) {
                        Some(next) => {
                            self.i += 1;
                            sig = next;
                        }
                        None => return Ok(Number::F64(self.long_integer(positive, sig)?)),
                    }
                }
                sig
            }
            _ => return Err(self.error(INVALID_NUMBER)),
        };
        Ok(match self.peek() {
            Some(b'.') => Number::F64(self.decimal(positive, sig, 0)?),
            Some(b'e' | b'E') => Number::F64(self.exponent(positive, sig, 0)?),
            _ if positive => Number::U64(sig),
            _ => {
                let neg = (sig as i64).wrapping_neg();
                // -0 and i64 underflow become floats
                if neg >= 0 {
                    Number::F64(-(sig as f64))
                } else {
                    Number::I64(neg)
                }
            }
        })
    }
    fn long_integer(&mut self, positive: bool, sig: u64) -> R<f64> {
        let mut exp = 0;
        while self.peek_digit() {
            self.i += 1;
            exp += 1;
        }
        match self.peek() {
            Some(b'.') => self.decimal(positive, sig, exp),
            _ => self.after_digits(positive, sig, exp),
        }
    }
    fn decimal(&mut self, positive: bool, mut sig: u64, mut exp: i32) -> R<f64> {
        self.i += 1;
        while self.peek_digit() {
            let d = (self.b[self.i] - b'0') as u64;
            match sig.checked_mul(10).and_then(|x| x.checked_add(d)) {
                Some(next) => {
                    self.i += 1;
                    sig = next;
                    exp -= 1;
                }
                None => {
                    // parse_decimal_overflow
                    while self.peek_digit() {
                        self.i += 1;
                    }
                    return self.after_digits(positive, sig, exp);
                }
            }
        }
        if exp == 0 {
            return Err(self.peek_error(if self.i < self.b.len() { INVALID_NUMBER } else { EOF_VALUE }));
        }
        self.after_digits(positive, sig, exp)
    }
    fn after_digits(&mut self, positive: bool, sig: u64, exp: i32) -> R<f64> {
        match self.peek() {
            Some(b'e' | b'E') => self.exponent(positive, sig, exp),
            _ => self.from_parts(positive, sig, exp),
        }
    }
    fn exponent(&mut self, positive: bool, sig: u64, start: i32) -> R<f64> {
        self.i += 1;
        let positive_exp = match self.peek() {
            Some(b'+') => {
                self.i += 1;
                true
            }
            Some(b'-') => {
                self.i += 1;
                false
            }
            _ => true,
        };
        let mut exp = match self.next() {
            None => return Err(self.error(EOF_VALUE)),
            Some(c @ b'0'..=b'9') => (c - b'0') as i32,
            _ => return Err(self.error(INVALID_NUMBER)),
        };
        while self.peek_digit() {
            let d = (self.b[self.i] - b'0') as i32;
            self.i += 1;
            match exp.checked_mul(10).and_then(|x| x.checked_add(d)) {
                Some(next) => exp = next,
                None => {
                    // parse_exponent_overflow
                    if sig != 0 && positive_exp {
                        return Err(self.error(OUT_OF_RANGE));
                    }
                    while self.peek_digit() {
                        self.i += 1;
                    }
                    return Ok(if positive { 0.0 } else { -0.0 });
                }
            }
        }
        let exp = if positive_exp { start.saturating_add(exp) } else { start.saturating_sub(exp) };
        self.from_parts(positive, sig, exp)
    }
    fn from_parts(&mut self, positive: bool, sig: u64, mut exp: i32) -> R<f64> {
        let mut f = sig as f64;
        loop {
            let a = exp.wrapping_abs() as u32;
            if a <= 308 {
                let pow = POW10[a as usize];
                if exp >= 0 {
                    f *= pow;
                    if f.is_infinite() {
                        return Err(self.error(OUT_OF_RANGE));
                    }
                } else {
                    f /= pow;
                }
                break;
            }
            if f == 0.0 {
                break;
            }
            if exp >= 0 {
                return Err(self.error(OUT_OF_RANGE));
            }
            f /= 1e308;
            exp += 308;
        }
        Ok(if positive { f } else { -f })
    }

    // ---- strings
    fn end_of_run(&mut self) -> R<u8> {
        while let Some(c) = self.peek() {
            if c == b'"' || c == b'\\' || c < 0x20 {
                return Ok(c);
            }
            self.i += 1;
        }
        Err(self.error(EOF_STRING))
    }
    fn hex(&mut self) -> R<u32> {
        if self.i + 4 > self.b.len() {
            self.i = self.b.len();
            return Err(self.error(EOF_STRING));
        }
        let mut v = 0;
        for _ in 0..4 {
            let c = self.b[self.i];
            self.i += 1;
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                b'A'..=b'F' => c - b'A' + 10,
                _ => return Err(self.error(INVALID_ESCAPE)),
            };
            v = v * 16 + d as u32;
        }
        Ok(v)
    }
    fn simple_escape(c: u8) -> Option<u8> {
        Some(match c {
            b'"' | b'\\' | b'/' => c,
            b'b' => 8,
            b'f' => 12,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            _ => return None,
        })
    }
    /// parse_str (validating), after the opening quote: the UTF-8 bytes
    fn string(&mut self) -> R<Vec<u8>> {
        let mut s = Vec::new();
        loop {
            let start = self.i;
            let c = self.end_of_run()?;
            s.extend_from_slice(&self.b[start..self.i]);
            self.i += 1;
            if c == b'"' {
                return Ok(s);
            }
            if c != b'\\' {
                return Err(self.error("control character (\\u0000-\\u001F) found while parsing a string"));
            }
            let e = match self.next() {
                None => return Err(self.error(EOF_STRING)),
                Some(e) => e,
            };
            if e != b'u' {
                match Self::simple_escape(e) {
                    Some(x) => s.push(x),
                    None => return Err(self.error(INVALID_ESCAPE)),
                }
                continue;
            }
            let mut u = self.hex()?;
            if (0xdc00..=0xdfff).contains(&u) {
                return Err(self.error(LONE_SURROGATE));
            }
            if (0xd800..=0xdbff).contains(&u) {
                for x in [b'\\', b'u'] {
                    match self.next() {
                        None => return Err(self.error(EOF_STRING)),
                        Some(c) if c != x => return Err(self.error("unexpected end of hex escape")),
                        _ => {}
                    }
                }
                let u2 = self.hex()?;
                if !(0xdc00..=0xdfff).contains(&u2) {
                    return Err(self.error(LONE_SURROGATE));
                }
                u = (((u - 0xd800) << 10) | (u2 - 0xdc00)) + 0x10000;
            }
            let mut buf = [0u8; 4];
            s.extend_from_slice(char::from_u32(u).unwrap_or('\0').encode_utf8(&mut buf).as_bytes());
        }
    }
    fn ignore_string(&mut self) -> R<()> {
        loop {
            match self.end_of_run()? {
                b'"' => {
                    self.i += 1;
                    return Ok(());
                }
                b'\\' => {}
                _ => return Err(self.error("control character (\\u0000-\\u001F) found while parsing a string")),
            }
            self.i += 1;
            match self.next() {
                None => return Err(self.error(EOF_STRING)),
                Some(b'u') => {
                    self.hex()?;
                }
                Some(e) => {
                    if Self::simple_escape(e).is_none() {
                        return Err(self.error(INVALID_ESCAPE));
                    }
                }
            }
        }
    }

    // ---- values
    /// the invalid-type message for a float: its Display is formatted by the JS side
    fn float_type(&mut self, f: f64, exp: &[u8]) -> Error {
        self.float = f;
        custom(&[b"invalid type: floating point `\0`, expected ", exp])
    }
    /// peek_invalid_type
    fn invalid_type(&mut self, exp: &[u8]) -> R<Error> {
        let mut what = Vec::new();
        match self.peek() {
            Some(b'n') => {
                self.i += 1;
                self.ident(b"ull")?;
                what.extend_from_slice(b"null");
            }
            Some(b't') => {
                self.i += 1;
                self.ident(b"rue")?;
                what.extend_from_slice(b"boolean `true`");
            }
            Some(b'f') => {
                self.i += 1;
                self.ident(b"alse")?;
                what.extend_from_slice(b"boolean `false`");
            }
            Some(c @ (b'-' | b'0'..=b'9')) => {
                if c == b'-' {
                    self.i += 1;
                }
                match self.integer(c != b'-')? {
                    Number::F64(f) => {
                        let e = self.float_type(f, exp);
                        return Ok(self.fix(e));
                    }
                    Number::U64(x) => {
                        what.extend_from_slice(b"integer `");
                        push_u64(&mut what, x);
                        what.push(b'`');
                    }
                    Number::I64(x) => {
                        what.extend_from_slice(b"integer `-");
                        push_u64(&mut what, x.unsigned_abs());
                        what.push(b'`');
                    }
                }
            }
            Some(b'"') => {
                self.i += 1;
                let s = self.string()?;
                what.extend_from_slice(b"string ");
                push_debug(&mut what, &s, false);
            }
            Some(b'[') => what.extend_from_slice(b"sequence"),
            Some(b'{') => what.extend_from_slice(b"map"),
            _ => return Ok(self.peek_error("expected value")),
        }
        let e = custom(&[b"invalid type: ", &what, b", expected ", exp]);
        Ok(self.fix(e))
    }
    /// i32::deserialize (deserialize_number)
    fn i32(&mut self) -> R<i32> {
        let c = match self.whitespace() {
            None => return Err(self.peek_error(EOF_VALUE)),
            Some(c) => c,
        };
        let e = match c {
            b'-' | b'0'..=b'9' => {
                if c == b'-' {
                    self.i += 1;
                }
                let (neg, x) = match self.integer(c != b'-')? {
                    Number::F64(f) => {
                        let e = self.float_type(f, b"i32");
                        return Err(self.fix(e));
                    }
                    Number::U64(x) => (false, x),
                    Number::I64(x) => (true, x.unsigned_abs()),
                };
                if x <= i32::MAX as u64 || (neg && x == 1 << 31) {
                    return Ok(if neg { (x as i64).wrapping_neg() as i32 } else { x as i32 });
                }
                let mut v = b"invalid value: integer `".to_vec();
                if neg {
                    v.push(b'-');
                }
                push_u64(&mut v, x);
                v.extend_from_slice(b"`, expected i32");
                Error { msg: v, line: 0, col: 0 }
            }
            _ => self.invalid_type(b"i32")?,
        };
        Err(self.fix(e))
    }
    /// deserialize_ignored_any (ignore_value, iterative)
    fn ignore_value(&mut self) -> R<()> {
        let mut stack = Vec::new();
        let mut enclosing: Option<u8> = None;
        loop {
            let c = match self.whitespace() {
                None => return Err(self.peek_error(EOF_VALUE)),
                Some(c) => c,
            };
            let frame = match c {
                b'n' => {
                    self.i += 1;
                    self.ident(b"ull")?;
                    None
                }
                b't' => {
                    self.i += 1;
                    self.ident(b"rue")?;
                    None
                }
                b'f' => {
                    self.i += 1;
                    self.ident(b"alse")?;
                    None
                }
                b'-' | b'0'..=b'9' => {
                    if c == b'-' {
                        self.i += 1;
                    }
                    self.ignore_number()?;
                    None
                }
                b'"' => {
                    self.i += 1;
                    self.ignore_string()?;
                    None
                }
                b'[' | b'{' => {
                    stack.extend(enclosing.take());
                    self.i += 1;
                    Some(c)
                }
                _ => return Err(self.peek_error("expected value")),
            };
            let (mut accept_comma, mut frame) = match frame {
                Some(f) => (false, f),
                None => match enclosing.take().or_else(|| stack.pop()) {
                    Some(f) => (true, f),
                    None => return Ok(()),
                },
            };
            loop {
                match self.whitespace() {
                    Some(b',') if accept_comma => {
                        self.i += 1;
                        break;
                    }
                    Some(b']') if frame == b'[' => {}
                    Some(b'}') if frame == b'{' => {}
                    Some(_) => {
                        if accept_comma {
                            return Err(self.peek_error(if frame == b'[' { "expected `,` or `]`" } else { "expected `,` or `}`" }));
                        }
                        break;
                    }
                    None => return Err(self.peek_error(if frame == b'[' { EOF_LIST } else { EOF_OBJECT })),
                }
                self.i += 1;
                frame = match stack.pop() {
                    Some(f) => f,
                    None => return Ok(()),
                };
                accept_comma = true;
            }
            if frame == b'{' {
                match self.whitespace() {
                    Some(b'"') => self.i += 1,
                    Some(_) => return Err(self.peek_error("key must be a string")),
                    None => return Err(self.peek_error(EOF_OBJECT)),
                }
                self.ignore_string()?;
                match self.whitespace() {
                    Some(b':') => self.i += 1,
                    Some(_) => return Err(self.peek_error("expected `:`")),
                    None => return Err(self.peek_error(EOF_OBJECT)),
                }
            }
            enclosing = Some(frame);
        }
    }
    /// ignore_integer / ignore_decimal / ignore_exponent
    fn ignore_number(&mut self) -> R<()> {
        match self.next() {
            Some(b'0') => {
                if self.peek_digit() {
                    return Err(self.peek_error(INVALID_NUMBER));
                }
            }
            Some(b'1'..=b'9') => {
                while self.peek_digit() {
                    self.i += 1;
                }
            }
            _ => return Err(self.error(INVALID_NUMBER)),
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            if !self.peek_digit() {
                return Err(self.peek_error(INVALID_NUMBER));
            }
            while self.peek_digit() {
                self.i += 1;
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.i += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.i += 1;
            }
            if !matches!(self.next(), Some(b'0'..=b'9')) {
                return Err(self.error(INVALID_NUMBER));
            }
            while self.peek_digit() {
                self.i += 1;
            }
        }
        Ok(())
    }
    /// the derived visit_seq / visit_map
    fn visit(&mut self, seq: bool) -> R<i32> {
        if seq {
            return match self.whitespace() {
                Some(b']') => Ok(11),
                None => Err(self.peek_error(EOF_LIST)),
                Some(_) => self.i32(), // the first element; the rest is left to end_seq
            };
        }
        let mut q = None;
        let mut first = true;
        loop {
            let mut p = self.whitespace();
            match p {
                Some(b'}') => break,
                Some(b',') if !first => {
                    self.i += 1;
                    p = self.whitespace();
                }
                None => return Err(self.peek_error(EOF_OBJECT)),
                Some(_) if !first => return Err(self.peek_error("expected `,` or `}`")),
                Some(_) => {}
            }
            first = false;
            match p {
                Some(b'"') => {}
                Some(b'}') => return Err(self.peek_error(TRAILING_COMMA)),
                Some(_) => return Err(self.peek_error("key must be a string")),
                None => return Err(self.peek_error(EOF_VALUE)),
            }
            self.i += 1;
            let is_quality = self.string()? == b"quality";
            if is_quality && q.is_some() {
                return Err(custom(&[b"duplicate field `quality`"]));
            }
            match self.whitespace() {
                Some(b':') => self.i += 1,
                Some(_) => return Err(self.peek_error("expected `:`")),
                None => return Err(self.peek_error(EOF_OBJECT)),
            }
            if is_quality {
                q = Some(self.i32()?);
            } else {
                self.ignore_value()?;
            }
        }
        Ok(q.unwrap_or(11))
    }
    /// Options::deserialize (deserialize_struct), then Deserializer::end
    fn options(&mut self) -> R<i32> {
        let c = match self.whitespace() {
            None => return Err(self.peek_error(EOF_VALUE)),
            Some(c) => c,
        };
        if c != b'[' && c != b'{' {
            let e = self.invalid_type(b"struct Options")?;
            return Err(self.fix(e));
        }
        self.i += 1;
        let seq = c == b'[';
        let r = self.visit(seq);
        // end_seq / end_map run after errors too (they move the position custom errors get)
        let end = match self.whitespace() {
            Some(x) if x == if seq { b']' } else { b'}' } => {
                self.i += 1;
                Ok(())
            }
            Some(b',') => {
                if seq {
                    self.i += 1;
                    let trailing_comma = self.whitespace() == Some(b']');
                    Err(self.peek_error(if trailing_comma { TRAILING_COMMA } else { TRAILING_CHARS }))
                } else {
                    Err(self.peek_error(TRAILING_COMMA))
                }
            }
            Some(_) => Err(self.peek_error(TRAILING_CHARS)),
            None => Err(self.peek_error(if seq { EOF_LIST } else { EOF_OBJECT })),
        };
        let q = match (r, end) {
            (Ok(q), Ok(())) => q,
            (Err(e), _) | (_, Err(e)) => return Err(self.fix(e)),
        };
        if self.whitespace().is_some() {
            return Err(self.peek_error(TRAILING_CHARS));
        }
        Ok(q)
    }
}

/// serde_json's POW10 (without float_roundtrip)
static POW10: [f64; 309] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9,
    1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
    1e20, 1e21, 1e22, 1e23, 1e24, 1e25, 1e26, 1e27, 1e28, 1e29,
    1e30, 1e31, 1e32, 1e33, 1e34, 1e35, 1e36, 1e37, 1e38, 1e39,
    1e40, 1e41, 1e42, 1e43, 1e44, 1e45, 1e46, 1e47, 1e48, 1e49,
    1e50, 1e51, 1e52, 1e53, 1e54, 1e55, 1e56, 1e57, 1e58, 1e59,
    1e60, 1e61, 1e62, 1e63, 1e64, 1e65, 1e66, 1e67, 1e68, 1e69,
    1e70, 1e71, 1e72, 1e73, 1e74, 1e75, 1e76, 1e77, 1e78, 1e79,
    1e80, 1e81, 1e82, 1e83, 1e84, 1e85, 1e86, 1e87, 1e88, 1e89,
    1e90, 1e91, 1e92, 1e93, 1e94, 1e95, 1e96, 1e97, 1e98, 1e99,
    1e100, 1e101, 1e102, 1e103, 1e104, 1e105, 1e106, 1e107, 1e108, 1e109,
    1e110, 1e111, 1e112, 1e113, 1e114, 1e115, 1e116, 1e117, 1e118, 1e119,
    1e120, 1e121, 1e122, 1e123, 1e124, 1e125, 1e126, 1e127, 1e128, 1e129,
    1e130, 1e131, 1e132, 1e133, 1e134, 1e135, 1e136, 1e137, 1e138, 1e139,
    1e140, 1e141, 1e142, 1e143, 1e144, 1e145, 1e146, 1e147, 1e148, 1e149,
    1e150, 1e151, 1e152, 1e153, 1e154, 1e155, 1e156, 1e157, 1e158, 1e159,
    1e160, 1e161, 1e162, 1e163, 1e164, 1e165, 1e166, 1e167, 1e168, 1e169,
    1e170, 1e171, 1e172, 1e173, 1e174, 1e175, 1e176, 1e177, 1e178, 1e179,
    1e180, 1e181, 1e182, 1e183, 1e184, 1e185, 1e186, 1e187, 1e188, 1e189,
    1e190, 1e191, 1e192, 1e193, 1e194, 1e195, 1e196, 1e197, 1e198, 1e199,
    1e200, 1e201, 1e202, 1e203, 1e204, 1e205, 1e206, 1e207, 1e208, 1e209,
    1e210, 1e211, 1e212, 1e213, 1e214, 1e215, 1e216, 1e217, 1e218, 1e219,
    1e220, 1e221, 1e222, 1e223, 1e224, 1e225, 1e226, 1e227, 1e228, 1e229,
    1e230, 1e231, 1e232, 1e233, 1e234, 1e235, 1e236, 1e237, 1e238, 1e239,
    1e240, 1e241, 1e242, 1e243, 1e244, 1e245, 1e246, 1e247, 1e248, 1e249,
    1e250, 1e251, 1e252, 1e253, 1e254, 1e255, 1e256, 1e257, 1e258, 1e259,
    1e260, 1e261, 1e262, 1e263, 1e264, 1e265, 1e266, 1e267, 1e268, 1e269,
    1e270, 1e271, 1e272, 1e273, 1e274, 1e275, 1e276, 1e277, 1e278, 1e279,
    1e280, 1e281, 1e282, 1e283, 1e284, 1e285, 1e286, 1e287, 1e288, 1e289,
    1e290, 1e291, 1e292, 1e293, 1e294, 1e295, 1e296, 1e297, 1e298, 1e299,
    1e300, 1e301, 1e302, 1e303, 1e304, 1e305, 1e306, 1e307, 1e308,
];

/// The quality, or the message of the unwrap panic and, when the message
/// holds a float (in place of its NUL), the float.
pub fn parse_options(json: &[u8]) -> Result<i32, (Vec<u8>, Option<f64>)> {
    let mut parser = Parser { b: json, i: 0, float: f64::NAN };
    match parser.options() {
        Ok(q) => Ok(q),
        Err(e) => {
            let mut m = b"called `Result::unwrap()` on an `Err` value: Error(".to_vec();
            push_debug(&mut m, &e.msg, true);
            m.extend_from_slice(b", line: ");
            push_u64(&mut m, e.line as u64);
            m.extend_from_slice(b", column: ");
            push_u64(&mut m, e.col as u64);
            m.push(b')');
            Err((m, if parser.float.is_nan() { None } else { Some(parser.float) }))
        }
    }
}
