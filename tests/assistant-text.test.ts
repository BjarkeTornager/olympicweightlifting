import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantText } from "../components/assistant-text";
import { CoachVisuals } from "../components/coach-visuals";
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

test("Coach renders Markdown comparison tables with escaped pipes, safe inline formatting and no executable markup", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantText, {
      text: "### Your week\nHere are your entries.\n| Day | Sleep | Note |\n| --- | ---: | --- |\n| Monday | **7.5 h** | A\\|B |\n| Tuesday | 8 h | <img src=x onerror=alert(1)> |\n\nKeep checking in.",
    }),
  );
  assert.match(html, /<table>/);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 3);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 2);
  assert.match(html, /<strong>7.5 h<\/strong>/);
  assert.match(html, /A\|B/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /<p>Keep checking in.<\/p>/);
});

test("generated visuals render only controlled table, bar and graph elements, including hostile labels", () => {
  const html = renderToStaticMarkup(
    createElement(CoachVisuals, {
      visuals: [
        {
          id: crypto.randomUUID(),
          content: {
            kind: "table",
            title: "Comparison",
            columns: ["Date", "Note"],
            rows: [["Today", "<script>alert(1)</script>"]],
          },
        },
        {
          id: crypto.randomUUID(),
          content: {
            kind: "bar_chart",
            title: "Sleep",
            unit: "h",
            points: [
              { label: "Monday", value: 7.5 },
              { label: "Tuesday", value: 8 },
            ],
          },
        },
        {
          id: crypto.randomUUID(),
          content: {
            kind: "diagram",
            title: "Warm-up",
            nodes: [
              { id: "a", label: "Warm up" },
              { id: "b", label: "<img src=x>" },
            ],
            edges: [{ from: "a", to: "b", label: "Comfortable?" }],
          },
        },
      ],
    }),
  );
  assert.match(html, /<table>/);
  assert.match(html, /7.5 h/);
  assert.match(html, /<svg/);
  assert.match(html, /Comfortable\?/);
  assert.match(html, /&lt;script/);
  assert.doesNotMatch(html, /<script|<img|<iframe|foreignObject|https:\/\//);
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
