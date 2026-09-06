import { build } from "esbuild";
await build({
  entryPoints: ["scripts/migrate.ts"],
  outfile: ".deployment/migrate.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["pg-native"],
  logLevel: "warning",
});
