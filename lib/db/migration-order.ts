import { existsSync, readdirSync, readFileSync } from "node:fs";

// drizzle's migrator reads the newest migration a database has applied, then
// applies only journal entries with a later `when` and skips older ones
// without an error. Two branches that each add a migration go wrong when the
// one merged second is renumbered by hand: it keeps its older `when`, and a
// database that already has the other branch's migration never gets it. So
// each entry must be newer than the one before, and its snapshot must follow
// that one's. The branch merged second regenerates its migration on top of
// the other: delete its SQL, snapshot and journal entry, then run
// npx drizzle-kit generate --name <name>.
export function migrationOrderProblems(folder = "drizzle") {
  const journal = JSON.parse(
    readFileSync(`${folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { idx: number; when: number; tag: string }[] };
  const problems: string[] = [];
  let previous: { tag: string; when: number; id?: string } | undefined;
  journal.entries.forEach((entry, position) => {
    const number = String(position).padStart(4, "0");
    if (entry.idx !== position || !entry.tag.startsWith(`${number}_`))
      problems.push(`${entry.tag} is listed as migration ${position}.`);
    if (!existsSync(`${folder}/${entry.tag}.sql`))
      problems.push(`${entry.tag}.sql is missing.`);
    const snapshotPath = `${folder}/meta/${number}_snapshot.json`;
    const snapshot = existsSync(snapshotPath)
      ? (JSON.parse(readFileSync(snapshotPath, "utf8")) as {
          id: string;
          prevId: string;
        })
      : undefined;
    if (!snapshot) problems.push(`${number}_snapshot.json is missing.`);
    if (previous && entry.when <= previous.when)
      problems.push(
        `${entry.tag} is older than ${previous.tag}, so a database that has ${previous.tag} would skip it.`,
      );
    if (previous?.id && snapshot && snapshot.prevId !== previous.id)
      problems.push(
        `${entry.tag}'s snapshot doesn't follow ${previous.tag}'s, so it wasn't generated on top of it.`,
      );
    previous = { tag: entry.tag, when: entry.when, id: snapshot?.id };
  });
  const listed = new Set(journal.entries.map((entry) => `${entry.tag}.sql`));
  for (const file of readdirSync(folder))
    if (file.endsWith(".sql") && !listed.has(file))
      problems.push(`${file} isn't in the journal, so it never runs.`);
  return problems;
}
