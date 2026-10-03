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
// Run by hand in the container through railway ssh (docs/restate-setup.md).
await build({
  entryPoints: ["scripts/restate-register.ts"],
  outfile: ".deployment/restate-register.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "warning",
});
