// `impl` is esbuild-wasm or @r1ck404/fast-esbuild-wasm (which accepts wasmURL and ignores it).
import * as esbuild from "impl";

export async function load({ wasmURL }) {
  await esbuild.initialize({ wasmURL });
  return { version: esbuild.version, transform: esbuild.transform, build: esbuild.build };
}
