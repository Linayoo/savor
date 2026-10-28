import { build } from "esbuild";

// `pnpm --filter @savor/api build`: bundles the Lambda entry point and every
// dependency, including @savor/shared, into dist/index.mjs for the image
await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist/index.mjs",
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
