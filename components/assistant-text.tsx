import type { ReactNode } from "react";
function Inline({ text }: { text: string }) {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <span key={i}>{part.slice(1, -1)}</span>
      ) : (
        part
      ),
    );
}
// A small, escaped-text renderer. No raw HTML, scripts, image URLs or model links.
function block(text: string, key: number | string): ReactNode {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() && !/^\s*[-*_]{3,}\s*$/.test(line));
  if (!lines.length) return null;
  const first = lines[0].trim(),
    heading = first.match(/^#{1,6}\s+(.+)/),
    numbered = first.match(/^(\d+)[.)]\s+(.+)/);
  if (heading || numbered)
    return (
      <section
        className={numbered ? "coach-answer-step" : "coach-answer-section"}
        key={key}
      >
        <h3>
          {numbered && (
            <span className="answer-step-number" aria-hidden="true">
              {numbered[1]}
            </span>
          )}
          <Inline text={heading?.[1] ?? numbered![2]} />
        </h3>
        {lines.length > 1 && block(lines.slice(1).join("\n"), `${key}-body`)}
      </section>
    );
  if (/^[-*]\s+/.test(first)) {
    const items: string[] = [];
    for (const line of lines) {
      const bullet = line.trim().match(/^[-*]\s+(.+)/);
      if (bullet) items.push(bullet[1]);
      else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
    }
    return (
      <ul key={key}>
        {items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p key={key}>
      <Inline text={lines.join("\n")} />
    </p>
  );
}
export function AssistantText({ text }: { text: string }) {
  return (
    <div className="assistant-response">
      {text
        .split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/)
        .map((value, index) => block(value, index))}
    </div>
  );
}
