"use client";
import {
  calendarDays,
  recipeMeta,
  type CoachVisual,
} from "@/lib/coach-visuals";
import { siteLanguage } from "@/lib/text-language";
import { CoachPicture } from "./coach-picture";

// The visual kinds Coach composes from journal numbers: trends, targets,
// headline numbers, comparisons, splits and calendars, and recipe cards with
// an AI picture of the dish when one was asked for.
// Drawn from validated data only; the iPhone app draws the same kinds
// natively. Coach's words take the reply's language (coach-turn.tsx); the
// card's own English labels are marked English inside a Danish reply.
type Kind<K extends CoachVisual["kind"]> = Extract<CoachVisual, { kind: K }>;

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const withUnit = (value: number, unit?: string) =>
  `${number.format(value)}${unit ? ` ${unit}` : ""}`;

export function LineChart({ visual }: { visual: Kind<"line_chart"> }) {
  const labels = [
    ...new Set(visual.series.flatMap((s) => s.points.map((p) => p.label))),
  ];
  const values = [
    ...visual.series.flatMap((s) => s.points.map((p) => p.value)),
    ...(visual.target == null ? [] : [visual.target]),
  ];
  const low = Math.min(...values),
    high = Math.max(...values),
    pad = (high - low) * 0.15 || Math.abs(high) * 0.05 || 1;
  const width = 320,
    height = 150,
    x = (label: string) =>
      labels.length < 2
        ? width / 2
        : (labels.indexOf(label) / (labels.length - 1)) * (width - 16) + 8,
    y = (value: number) =>
      height -
      8 -
      ((value - (low - pad)) / (high - low + 2 * pad)) * (height - 16);
  return (
    <div className="coach-line-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${visual.title}: ${visual.series.map((s) => `${s.name} from ${withUnit(s.points[0].value, visual.unit)} to ${withUnit(s.points.at(-1)!.value, visual.unit)}`).join("; ")}`}
      >
        {visual.target != null && (
          <line
            x1="0"
            x2={width}
            y1={y(visual.target)}
            y2={y(visual.target)}
            className="coach-line-target"
          />
        )}
        {visual.series.map((s, i) => (
          <polyline
            key={s.name}
            points={s.points
              .map((p) => `${x(p.label)},${y(p.value)}`)
              .join(" ")}
            className={`coach-line coach-line-${i}`}
            fill="none"
          />
        ))}
      </svg>
      <div className="coach-line-axis">
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </div>
      <ul className="coach-legend">
        {visual.series.map((s, i) => (
          <li key={s.name}>
            <span className={`coach-swatch coach-line-${i}`} />
            {s.name}{" "}
            <strong>{withUnit(s.points.at(-1)!.value, visual.unit)}</strong>
          </li>
        ))}
        {visual.target != null && (
          <li>
            <span className="coach-swatch coach-line-target" />
            <span lang={siteLanguage}>Target</span>{" "}
            <strong>{withUnit(visual.target, visual.unit)}</strong>
          </li>
        )}
      </ul>
    </div>
  );
}

export function Progress({ visual }: { visual: Kind<"progress"> }) {
  return (
    <ol className="coach-bar-chart">
      {visual.targets.map((t) => (
        <li key={t.label}>
          <div>
            <span>
              {t.label}
              {/* A target that isn't one of the athlete's own. */}
              {t.suggested && <small> · Suggested by Coach</small>}
            </span>
            <strong>
              {number.format(t.value)} / {withUnit(t.target, t.unit)}
            </strong>
          </div>
          <div
            className="coach-bar-track"
            role="progressbar"
            aria-label={t.label}
            aria-valuenow={t.value}
            aria-valuemax={t.target}
          >
            <span
              style={{ width: `${Math.min(100, (100 * t.value) / t.target)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Stats({ visual }: { visual: Kind<"stats"> }) {
  return (
    <dl className="coach-stats">
      {visual.stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd>
            <strong>{s.value}</strong>
            {s.unit && <span> {s.unit}</span>}
            {s.change && (
              <small className={`coach-trend coach-trend-${s.trend ?? "flat"}`}>
                {s.trend === "up" ? "↑ " : s.trend === "down" ? "↓ " : ""}
                {s.change}
              </small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Comparison({ visual }: { visual: Kind<"comparison"> }) {
  return (
    <div
      className="coach-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={visual.title}
    >
      <table>
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">{visual.beforeLabel}</th>
            <th scope="col">{visual.afterLabel}</th>
            <th scope="col" lang={siteLanguage}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {visual.comparisons.map((c) => {
            const change = c.after - c.before;
            const good =
              c.higherIsBetter == null || change === 0
                ? undefined
                : c.higherIsBetter === change > 0;
            return (
              <tr key={c.label}>
                <th scope="row">{c.label}</th>
                <td>{withUnit(c.before, c.unit)}</td>
                <td>{withUnit(c.after, c.unit)}</td>
                <td
                  className={
                    good === undefined ? "" : good ? "coach-good" : "coach-bad"
                  }
                >
                  {change > 0 ? "+" : ""}
                  {withUnit(change, c.unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Split({ visual }: { visual: Kind<"split"> }) {
  const total = visual.parts.reduce((sum, p) => sum + p.value, 0);
  // Coach should send amounts; when they are already shares, the share alone
  // says it (the title and caption give the context).
  const percentages = visual.unit.includes("%");
  return (
    <div className="coach-split">
      <div className="coach-split-bar" aria-hidden="true">
        {visual.parts.map((p, i) => (
          <span
            key={p.label}
            className={`coach-part-${i}`}
            style={{ width: `${(100 * p.value) / total}%` }}
          />
        ))}
      </div>
      <ul className="coach-legend">
        {visual.parts.map((p, i) => (
          <li key={p.label}>
            <span className={`coach-swatch coach-part-${i}`} />
            {p.label}{" "}
            {percentages ? (
              <strong>{Math.round((100 * p.value) / total)}%</strong>
            ) : (
              <>
                <strong>{withUnit(p.value, visual.unit)}</strong>{" "}
                <small>{Math.round((100 * p.value) / total)}%</small>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Calendar({ visual }: { visual: Kind<"calendar"> }) {
  const { offset, days } = calendarDays(visual.days);
  return (
    <div className="coach-calendar">
      <ol aria-label={visual.title}>
        {Array.from({ length: offset }, (_, i) => (
          <li
            key={`blank-${i}`}
            aria-hidden="true"
            className="coach-day-blank"
          />
        ))}
        {days.map((d) => (
          <li
            key={d.date}
            className={`coach-day coach-day-${d.level ?? "none"}`}
            title={`${d.date}${d.label ? `: ${d.label}` : ""}`}
          >
            <span>{Number(d.date.slice(8))}</span>
            <span className="sr-only">
              {d.label ?? (d.level == null ? "no record" : `level ${d.level}`)}
            </span>
          </li>
        ))}
      </ol>
      {visual.legend && (
        <p className="coach-calendar-legend">{visual.legend}</p>
      )}
    </div>
  );
}

const nutrients = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const;

export function RecipeCard({
  visual,
  accountId,
}: {
  visual: Kind<"recipe">;
  accountId: string;
}) {
  const nutrition = nutrients.flatMap((n) => {
    const value = visual.nutrition?.[n.key];
    return value === undefined ? [] : [{ ...n, value }];
  });
  return (
    <div className="coach-recipe">
      {visual.pictureId && (
        <CoachPicture
          id={visual.pictureId}
          accountId={accountId}
          title={visual.title}
        />
      )}
      <p className="coach-recipe-meta" lang={siteLanguage}>
        {recipeMeta(visual)}
      </p>
      <div>
        <h4 lang={siteLanguage}>Ingredients</h4>
        <ul className="coach-recipe-ingredients">
          {visual.ingredients.map((ingredient, i) => (
            <li key={i}>
              <span>{ingredient.amount}</span>
              {ingredient.item}
            </li>
          ))}
        </ul>
      </div>
      {visual.steps?.length ? (
        <div>
          <h4 lang={siteLanguage}>Method</h4>
          <ol className="coach-recipe-steps">
            {visual.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {nutrition.length > 0 && (
        <div lang={siteLanguage}>
          <h4>Estimate per serving</h4>
          <dl className="coach-recipe-nutrition">
            {nutrition.map((n) => (
              <div key={n.key}>
                <dt>{n.label}</dt>
                <dd>{withUnit(n.value, n.unit)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
