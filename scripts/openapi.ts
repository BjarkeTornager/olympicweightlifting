import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nativeFixtures } from "../lib/native-fixtures";
import { fixturesPath, openApiPath, openApiText } from "../lib/native-openapi";

mkdirSync(dirname(openApiPath), { recursive: true });
writeFileSync(openApiPath, openApiText());
console.log(`Wrote ${openApiPath}`);
mkdirSync(fixturesPath, { recursive: true });
for (const [name, value] of Object.entries(nativeFixtures()))
  writeFileSync(
    join(fixturesPath, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
console.log(`Wrote fixtures to ${fixturesPath}`);
