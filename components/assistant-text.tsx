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
// Only text and semantic formatting. Model HTML, images and URLs stay inert.
function blocks(lines: string[]): ReactNode[] {
  const result: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
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
