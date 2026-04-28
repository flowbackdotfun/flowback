import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

const external = [
  "@solana/web3.js",
  "bs58",
  "tweetnacl",
  "ws",
  /^node:/,
];

export default defineConfig([
  {
    input: "src/index.ts",
    external,
    output: [
      {
        dir: "dist",
        format: "esm",
        entryFileNames: "index.mjs",
        sourcemap: true,
      },
      {
        dir: "dist",
        format: "cjs",
        entryFileNames: "index.cjs",
        sourcemap: true,
        exports: "named",
      },
    ],
  },
  {
    input: "src/index.ts",
    external,
    plugins: [dts({ emitDtsOnly: true })],
    output: { dir: "dist" },
  },
]);
