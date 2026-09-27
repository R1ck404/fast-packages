//go:build ignore

// Companion of tools/runtimecheck.mjs: prints runtime.Source() for every
// combination of the compat features that runtime.go looks at, as JSON.
package main

import (
	"encoding/json"
	"os"
	"strconv"

	"github.com/evanw/esbuild/internal/compat"
	"github.com/evanw/esbuild/internal/runtime"
)

func main() {
	features := []compat.JSFeature{compat.ForOf, compat.ConstAndLet, compat.ObjectAccessors, compat.ObjectExtensions}
	type result struct {
		Features       string
		Index          uint32
		KeyPathText    string
		KeyPathNS      string
		PrettyAbs      string
		PrettyRel      string
		IdentifierName string
		Contents       string
	}
	var results []result
	for mask := 0; mask < 16; mask++ {
		var f compat.JSFeature
		for i, feature := range features {
			if mask&(1<<i) != 0 {
				f |= feature
			}
		}
		s := runtime.Source(f)
		results = append(results, result{
			Features:       strconv.FormatUint(uint64(f), 10),
			Index:          s.Index,
			KeyPathText:    s.KeyPath.Text,
			KeyPathNS:      s.KeyPath.Namespace,
			PrettyAbs:      s.PrettyPaths.Abs,
			PrettyRel:      s.PrettyPaths.Rel,
			IdentifierName: s.IdentifierName,
			Contents:       s.Contents,
		})
	}
	json.NewEncoder(os.Stdout).Encode(results)
}
