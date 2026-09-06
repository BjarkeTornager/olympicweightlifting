import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantText } from "../components/assistant-text";
test("coach answers render headings and semantic lists while escaping model HTML and links", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, {
      text: "### Today\n\n1. **Review your training**\n  * Energy 2/5 was logged today.\n2. **Log your meal**\n\n<img src=x onerror=alert(1)> [link](javascript:alert(1))",
    }),
  );
  assert.match(html, /<h3>Today<\/h3>/);
  assert.match(html, /<ol start="1">/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /coach-answer-step/);
  assert.match(html, /<strong>Review your training<\/strong>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script|href=/);
});

test("coach formatting separates adjacent paragraphs, headings and lists and renders emphasis", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, {
      text: "Your next step.\n### Recovery\n*Logged observation:* You slept well.\n- **Sleep:** 8 hours\n- Water: 2 L\n\nNext step: `check in`.",
    }),
  );
  assert.match(html, /<p>Your next step.<\/p><h3>Recovery<\/h3>/);
  assert.match(html, /<em>Logged observation:<\/em>/);
  assert.match(
    html,
    /<ul><li><strong>Sleep:<\/strong> 8 hours<\/li><li>Water: 2 L<\/li><\/ul>/,
  );
  assert.match(html, /<code>check in<\/code>/);
});
