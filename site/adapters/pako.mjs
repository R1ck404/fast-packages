// The same calls for both builds: `impl` is pako or @r1ck404/fast-pako.
import * as impl from "impl";

export async function load() {
  return {
    deflate: impl.deflate,
    deflateRaw: impl.deflateRaw,
    gzip: impl.gzip,
    inflate: impl.inflate,
    inflateRaw: impl.inflateRaw,
    ungzip: impl.ungzip,
  };
}
