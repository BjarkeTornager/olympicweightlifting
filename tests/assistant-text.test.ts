import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantText } from "../components/assistant-text";
test("coach answers render headings and separate priorities while escaping model HTML and links", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, {
      text: "### Today\n\n1. **Review your training**\n  * Energy 2/5 was logged today.\n2. **Log your meal**\n\n<img src=x onerror=alert(1)> [link](javascript:alert(1))",
    }),
  );
  assert.match(html, /<h3>Today<\/h3>/);
  assert.equal((html.match(/class="coach-answer-step"/g) ?? []).length, 2);
  assert.match(html, /<strong>Review your training<\/strong>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script|href=/);
});
