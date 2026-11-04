import { build } from "esbuild";

// `pnpm --filter @savor/api build`: bundles each Lambda entry point and every
// dependency, including @savor/shared, for the image: dist/index.mjs for the
// API, dist/letters.mjs for the letters job
await build({
  entryPoints: { index: "src/lambda.ts", letters: "src/letters/lambda.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // pg loads its optional native binding only when asked to
  external: ["pg-native"],
  // CommonJS dependencies like pg call require() for Node's built-in modules
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
