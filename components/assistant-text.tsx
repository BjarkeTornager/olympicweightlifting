import type { ReactNode } from "react";
function Inline({ text }: { text: string }) {
  return text
    .split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("*") && part.endsWith("*") ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
const listItem = /^(\s*)(?:(\d+)[.)]|[-*])\s+(.+)/;
function tableCells(line: string) {
  const cells: string[] = [];
  let current = "",
    code = false;
  const value = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && value[i + 1] === "|") {
      current += "|";
      i++;
    } else if (c === "|" && !code) {
      cells.push(current.trim());
      current = "";
    } else {
      if (c === "`") code = !code;
      current += c;
    }
  }
  cells.push(current.trim());
  return cells;
}
function tableAt(lines: string[], i: number) {
  if (!lines[i]?.includes("|") || !lines[i + 1]) return false;
  const header = tableCells(lines[i]),
    separator = tableCells(lines[i + 1]);
  return (
    header.length >= 2 &&
    header.length <= 8 &&
    header.length === separator.length &&
    separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}
// Only text and semantic formatting. Model HTML, images and URLs stay inert.
function blocks(lines: string[]): ReactNode[] {
  const result: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (tableAt(lines, i)) {
      const start = i,
        header = tableCells(line),
        rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && rows.length < 80) {
        const cells = tableCells(lines[i]);
        if (cells.length !== header.length) break;
        rows.push(cells);
        i++;
      }
      result.push(
        <div
          className="coach-table-scroll"
          key={start}
          tabIndex={0}
          role="region"
          aria-label="Coach comparison"
        >
          <table>
            <thead>
              <tr>
                {header.map((cell, j) => (
                  <th scope="col" key={j}>
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j}>
                  {row.map((cell, k) =>
                    k === 0 ? (
                      <th scope="row" key={k}>
                        <Inline text={cell} />
                      </th>
                    ) : (
                      <td key={k}>
                        <Inline text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (!line.trim() || /^\s*[-*_]{3,}\s*$/.test(line)) {
      i++;
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+)/);
    if (heading) {
      result.push(
        <h3 key={i}>
          <Inline text={heading[1]} />
        </h3>,
      );
      i++;
      continue;
    }
    const list = line.match(listItem);
    if (list) {
      const start = i,
        indent = list[1].length,
        ordered = Boolean(list[2]);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(listItem);
        if (!item || item[1].length !== indent || Boolean(item[2]) !== ordered)
          break;
        const key = i,
          children: string[] = [];
        i++;
        while (
          i < lines.length &&
          lines[i].trim() &&
          /^\s/.test(lines[i]) &&
          (lines[i].match(/^\s*/)?.[0].length ?? 0) > indent
        ) {
          children.push(lines[i]);
          i++;
        }
        items.push(
          <li key={key}>
            <Inline text={item[3]} />
            {blocks(children)}
          </li>,
        );
        // Blank lines between list items do not create separate boxed sections.
        while (i < lines.length && !lines[i].trim()) i++;
      }
      result.push(
        ordered ? (
          <ol key={start} start={Number(list[2])}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    const start = i,
      paragraph = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !listItem.test(lines[i]) &&
      !tableAt(lines, i) &&
      !/^\s*#{1,6}\s|^\s*[-*_]{3,}\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    result.push(
      <p key={start}>
        <Inline text={paragraph.join(" ")} />
      </p>,
    );
  }
  return result;
}
export function AssistantText({ text }: { text: string }) {
  return <div className="assistant-response">{blocks(text.split("\n"))}</div>;
}
