"use client";
import { memo, useId } from "react";
import { ArrowRight, BarChart3, GitBranch, Table2 } from "lucide-react";
import {
  savedVisualSchema,
  type CoachVisual,
  type SavedVisual,
} from "@/lib/coach-visuals";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
function Diagram({
  visual,
}: {
  visual: Extract<CoachVisual, { kind: "diagram" }>;
}) {
  const marker = useId().replace(/:/g, "");
  // Ordered nodes provide a predictable reading path, with real labelled
  // connections. A separate text list makes the graph accessible at any size.
  const rowHeight = 100,
    width = 400;
  const positions = new Map(
    visual.nodes.map((n, i) => [n.id, 40 + i * rowHeight]),
  );
  return (
    <>
      <div
        className="coach-diagram-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${visual.title} diagram`}
      >
        <svg
          viewBox={`0 0 ${width} ${visual.nodes.length * rowHeight}`}
          width={width}
          role="img"
          aria-label={visual.title}
        >
          <defs>
            <marker
              id={marker}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8" fill="var(--coach-graph-line)" />
            </marker>
          </defs>
          {visual.edges.map((edge, i) => {
            const y1 = positions.get(edge.from)!,
              y2 = positions.get(edge.to)!;
            const adjacent = y2 === y1 + rowHeight;
            const lane = 344 + (i % 3) * 16;
            return (
              <g key={i}>
                <path
                  d={
                    adjacent
                      ? `M200 ${y1 + 32} L200 ${y2 - 32}`
                      : `M320 ${y1} H${lane} V${y2} H322`
                  }
                  fill="none"
                  stroke="var(--coach-graph-line)"
                  strokeWidth="1.8"
                  markerEnd={`url(#${marker})`}
                />
                {adjacent && edge.label && (
                  <text
                    x="214"
                    y={(y1 + y2) / 2 + 4}
                    className="coach-diagram-edge"
                  >
                    <title>{edge.label}</title>
                    {edge.label.length > 22
                      ? `${edge.label.slice(0, 21)}…`
                      : edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {visual.nodes.map((node, i) => {
            const words = node.label.split(/\s+/),
              lines: string[] = [];
            for (const word of words) {
              // Bound labels by characters as well as words, including long IDs.
              for (let start = 0; start < word.length; start += 28) {
                const part = word.slice(start, start + 28),
                  last = lines.length - 1;
                if (last >= 0 && lines[last].length + part.length < 29)
                  lines[last] += ` ${part}`;
                else lines.push(part);
              }
            }
            const y = positions.get(node.id)!;
            return (
              <g key={node.id}>
                <title>{node.label}</title>
                <rect
                  x="66"
                  y={y - 32}
                  width="254"
                  height="64"
                  rx="12"
                  fill="var(--coach-graph-node)"
                  stroke="var(--coach-graph-border)"
                />
                <circle cx="43" cy={y} r="13" fill="var(--coach-graph-node)" />
                <text
                  x="43"
                  y={y + 4}
                  textAnchor="middle"
                  className="coach-diagram-number"
                >
                  {i + 1}
                </text>
                <text
                  x="193"
                  y={y - (Math.min(lines.length, 3) - 1) * 9 + 4}
                  textAnchor="middle"
                >
                  {lines.slice(0, 3).map((line, j) => (
                    <tspan key={j} x="193" dy={j ? 18 : 0}>
                      {j === 2 && lines.length > 3
                        ? `${line.slice(0, 25)}…`
                        : line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <details
        className="coach-diagram-details"
        open={visual.edges.some(
          (e) => positions.get(e.to)! !== positions.get(e.from)! + rowHeight,
        )}
      >
        <summary>Read connections</summary>
        <ul>
          {visual.edges.map((e, i) => (
            <li key={i}>
              <span>{visual.nodes.find((n) => n.id === e.from)!.label}</span>
              <ArrowRight size={14} aria-label="leads to" />
              <span>{visual.nodes.find((n) => n.id === e.to)!.label}</span>
              {e.label && <strong>{e.label}</strong>}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

export const CoachVisuals = memo(function CoachVisuals({
  visuals,
}: {
  visuals: SavedVisual[];
}) {
  return (
    <div className="coach-visuals">
      {visuals.slice(0, 3).map((saved) => {
        // Validate history too: malformed or future visual types never break chat.
        const parsed = savedVisualSchema.safeParse(saved);
        if (!parsed.success) return null;
        const visual = parsed.data.content;
        const Icon =
          visual.kind === "table"
            ? Table2
            : visual.kind === "diagram"
              ? GitBranch
              : BarChart3;
        return (
          <figure
            className={`coach-visual coach-visual-${visual.kind}`}
            key={saved.id}
          >
            <figcaption>
              <span className="coach-visual-label">
                <Icon size={15} aria-hidden="true" />
                {visual.kind === "table"
                  ? "Comparison"
                  : visual.kind === "diagram"
                    ? "Step by step"
                    : "At a glance"}
              </span>
              <h3>{visual.title}</h3>
              {visual.caption && <p>{visual.caption}</p>}
            </figcaption>
            {visual.kind === "table" && (
              <div
                className="coach-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={visual.title}
              >
                <table>
                  <thead>
                    <tr>
                      {visual.columns.map((col, i) => (
                        <th scope="col" key={i}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visual.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) =>
                          j === 0 ? (
                            <th scope="row" key={j}>
                              {cell}
                            </th>
                          ) : (
                            <td key={j}>{cell}</td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {visual.kind === "bar_chart" && (
              <ol className="coach-bar-chart" aria-label={visual.title}>
                {visual.points.map((point, i) => (
                  <li key={i}>
                    <div>
                      <span>{point.label}</span>
                      <strong>
                        {number.format(point.value)}
                        {visual.unit && ` ${visual.unit}`}
                      </strong>
                    </div>
                    <div className="coach-bar-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${(100 * point.value) / Math.max(1, ...visual.points.map((p) => p.value))}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {visual.kind === "diagram" && <Diagram visual={visual} />}
          </figure>
        );
      })}
    </div>
  );
});
