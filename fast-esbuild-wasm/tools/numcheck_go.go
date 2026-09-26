//go:build ignore

// Companion of tools/numcheck.mjs, which builds this file inside the esbuild
// module (via "go build -overlay", without modifying the esbuild tree) for
// GOOS=js GOARCH=wasm, runs it with node and compares every line with the JS
// port. Output lines are space-separated tokens; floats are hex bit patterns.
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"

	"github.com/evanw/esbuild/internal/js_ast"
)

var out *bufio.Writer

func fb(f float64) string {
	return strconv.FormatUint(math.Float64bits(f), 16)
}

type rng struct{ s uint64 }

func (r *rng) next() uint64 {
	r.s += 0x9E3779B97F4A7C15
	z := r.s
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}
func (r *rng) float() float64 { return float64(r.next()>>11) / (1 << 53) }
func (r *rng) intn(n int) int  { return int(r.next() % uint64(n)) }

var interesting = []float64{
	0, math.Copysign(0, -1), 1, -1, 0.5, -0.5, 1.5, -1.5, 2, -2, 3, -3, 10, -10, 0.1, -0.1, 1.0 / 3,
	math.Pi, math.E, 100, 1000, 1e6, 1e15, 1e16, 1e21, 1e22, 1e100, 1e300, -1e300, 1e-7, 1e-300,
	5e-324, -5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, -1.7976931348623157e308,
	2147483647, 2147483648, -2147483648, -2147483649, 2147483648.5, -2147483648.5, 2147483647.5,
	4294967295, 4294967296, 4294967297, 4294967295.5, -4294967295.5, 4294967296.5,
	9007199254740991, 9007199254740992, 9007199254740994, -9007199254740992,
	9223372036854775807, 9223372036854775808, -9223372036854775808, 18446744073709551616,
	31, 32, 33, 63, 64, -31, -32, 0.9999999999999999, 1.0000000000000002, 123456789, -123456789,
	0.7071067811865476, 1.4142135623730951, 709.782712893384, -745.1332191019411, 1024, -1074,
	math.Inf(1), math.Inf(-1), math.NaN(),
}

func randomFloat(r *rng) float64 {
	switch r.intn(8) {
	case 0:
		return math.Float64frombits(r.next()) // any bit pattern
	case 1:
		return float64(r.intn(201) - 100)
	case 2:
		return (r.float() - 0.5) * 2000
	case 3:
		return float64(int64(r.next()>>23) - (1 << 40))
	case 4:
		return (r.float() - 0.5) * math.Pow(2, float64(r.intn(140)-70))
	case 5:
		return interesting[r.intn(len(interesting))]
	case 6:
		return float64(int32(r.next()))
	default:
		return float64(uint32(r.next())) + float64(r.intn(3))*0.5
	}
}

var binOps = []js_ast.OpCode{
	js_ast.BinOpAdd, js_ast.BinOpSub, js_ast.BinOpMul, js_ast.BinOpDiv, js_ast.BinOpRem, js_ast.BinOpPow,
	js_ast.BinOpShl, js_ast.BinOpShr, js_ast.BinOpUShr, js_ast.BinOpBitwiseAnd, js_ast.BinOpBitwiseOr,
	js_ast.BinOpBitwiseXor, js_ast.BinOpLt, js_ast.BinOpGt, js_ast.BinOpLe, js_ast.BinOpGe,
	js_ast.BinOpLooseEq, js_ast.BinOpStrictEq, js_ast.BinOpLooseNe, js_ast.BinOpStrictNe,
}

func fold(op js_ast.OpCode, a float64, b float64) {
	e := &js_ast.EBinary{Op: op, Left: js_ast.Expr{Data: &js_ast.ENumber{Value: a}}, Right: js_ast.Expr{Data: &js_ast.ENumber{Value: b}}}
	result := js_ast.FoldBinaryOperator(logger0, e)
	switch r := result.Data.(type) {
	case *js_ast.ENumber:
		fmt.Fprintf(out, "fold %d %s %s n %s\n", op, fb(a), fb(b), fb(r.Value))
	case *js_ast.EBoolean:
		fmt.Fprintf(out, "fold %d %s %s b %v\n", op, fb(a), fb(b), r.Value)
	default:
		fmt.Fprintf(out, "fold %d %s %s none\n", op, fb(a), fb(b))
	}
	if op == js_ast.BinOpShl || op == js_ast.BinOpUShr {
		if !math.IsInf(a, 0) && !math.IsInf(b, 0) && !math.IsInf(float64(js_ast.ToInt32(a)), 0) {
			fmt.Fprintf(out, "should %d %s %s %v\n", op, fb(a), fb(b), js_ast.ShouldFoldBinaryOperatorWhenMinifying(e))
		}
	}
}

func unary(x float64) {
	fmt.Fprintf(out, "toint32 %s %d\n", fb(x), js_ast.ToInt32(x))
	fmt.Fprintf(out, "touint32 %s %d\n", fb(x), js_ast.ToUint32(x))
	for _, radix := range []int{10, 2, 16, 36} {
		s, ok := js_ast.TryToStringOnNumberSafely(x, radix)
		if s == "" {
			s = "-"
		}
		fmt.Fprintf(out, "tostr %s %d %s %v\n", fb(x), radix, s, ok)
	}
	fmt.Fprintf(out, "log %s %s\n", fb(x), fb(math.Log(x)))
	fmt.Fprintf(out, "log10 %s %s\n", fb(x), fb(math.Log10(x)))
	fmt.Fprintf(out, "exp %s %s\n", fb(x), fb(math.Exp(x)))
	fr, ex := math.Frexp(x)
	fmt.Fprintf(out, "frexp %s %s %d\n", fb(x), fb(fr), ex)
	ip, fp := math.Modf(x)
	fmt.Fprintf(out, "modf %s %s %s\n", fb(x), fb(ip), fb(fp))
	for _, e := range []int{-1100, -1074, -1023, -1, 0, 1, 52, 1023, 1024, 2100} {
		fmt.Fprintf(out, "ldexp %s %d %s\n", fb(x), e, fb(math.Ldexp(x, e)))
	}
}

var logger0 = js_ast.Expr{}.Loc

func main() {
	out = bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()

	fmt.Fprintf(out, "invln10 %s\n", fb(1/math.Ln10))

	r := &rng{s: 12345}

	// Unary checks
	for _, x := range interesting {
		unary(x)
	}
	for i := 0; i < 20000; i++ {
		unary(randomFloat(r))
	}

	// Binary operators on interesting pairs
	for _, a := range interesting {
		for _, b := range interesting {
			for _, op := range binOps {
				fold(op, a, b)
			}
		}
	}

	// Binary operators on random pairs
	for i := 0; i < 20000; i++ {
		a, b := randomFloat(r), randomFloat(r)
		for _, op := range binOps {
			fold(op, a, b)
		}
	}

	// Extra coverage for "**" and "%", where Go's algorithms differ from V8's
	for i := 0; i < 150000; i++ {
		var a, b float64
		switch r.intn(6) {
		case 0:
			a, b = r.float()*10, (r.float()-0.5)*40
		case 1:
			a, b = r.float()*2, (r.float()-0.5)*2000
		case 2:
			a, b = float64(r.intn(100)), float64(r.intn(60)-30)
		case 3:
			a, b = -float64(r.intn(100))-r.float(), float64(r.intn(60)-30)
		case 4:
			a, b = randomFloat(r), randomFloat(r)
		default:
			a, b = (r.float()-0.5)*1e6, r.float()*3
		}
		fold(js_ast.BinOpPow, a, b)
		fold(js_ast.BinOpRem, a, b)
		fold(js_ast.BinOpRem, b*1e10, a)
	}

	// StringToEquivalentNumberValue
	strs := []string{"", "-", "0", "-0", "00", "01", "1", "-1", "+1", " 1", "1 ", "1e3", "1.5", "2147483647",
		"2147483648", "-2147483648", "-2147483649", "4294967296", "4294967295", "99999999999", "-99999999999",
		"123", "-123", "--1", "0x10", "12345678901234567890"}
	for i := 0; i < 20000; i++ {
		n := r.intn(13) + 1
		b := []byte{}
		if r.intn(3) == 0 {
			b = append(b, '-')
		}
		for j := 0; j < n; j++ {
			b = append(b, byte('0'+r.intn(10)))
		}
		strs = append(strs, string(b))
	}
	for _, s := range strs {
		v, ok := js_ast.StringToEquivalentNumberValue([]uint16(toUTF16(s)))
		q := s
		if q == "" {
			q = "<empty>"
		}
		fmt.Fprintf(out, "strnum %q %s %v\n", q, fb(v), ok)
	}
}

func toUTF16(s string) []uint16 {
	result := make([]uint16, len(s))
	for i := 0; i < len(s); i++ {
		result[i] = uint16(s[i])
	}
	return result
}
