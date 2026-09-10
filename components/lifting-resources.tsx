import {
  liftingResources,
  liftingTopics,
  type LiftingTopic,
} from "@/lib/lifting-resources";
import { ArrowUpRight, Utensils, Play } from "./ui/icons";
import { Button } from "./ui/button";

export function LiftingResources({ go }: { go: (route: string) => void }) {
  return (
    <>
      <section
        className="lifting-discover"
        aria-label="Technique and nutrition coaching"
      >
        <div className="panel">
          <Play size={24} aria-hidden="true" />
          <span className="eyebrow">TECHNIQUE · EXPERIMENTAL</span>
          <h2>See what to work on next.</h2>
          <p>
            Show Coach a short part of your lift. Get feedback on what went well
            and one clear thing to improve. No question needed.
          </p>
          <Button variant="secondary" onClick={() => go("coach/lifting/video")}>
            Review lifting video
          </Button>
          <p className="fine-print">
            Visual feedback from sampled frames. No bar-speed or joint-angle
            measurements.
          </p>
        </div>
        <div className="panel">
          <Utensils size={24} aria-hidden="true" />
          <span className="eyebrow">NUTRITION FOR LIFTING</span>
          <h2>Fuel the session. Support recovery.</h2>
          <p>
            Connect your meals and preferences with your training. Get practical
            ideas for before and after lifting.
          </p>
          <Button
            variant="secondary"
            onClick={() => go("coach/lifting/nutrition")}
          >
            Plan food around training
          </Button>
          <p className="fine-print">
            Suggestions fit what you share. Missing food logs aren’t treated as
            missed meals.
          </p>
        </div>
      </section>
      <section
        className="panel lifting-sources"
        aria-labelledby="lifting-sources-title"
      >
        <h2 id="lifting-sources-title">Learn from trusted sources</h2>
        <p className="muted">
          Coaching practice, federation education and sports nutrition research.
          Explore the reasoning behind the guidance.
        </p>
        {(Object.keys(liftingTopics) as LiftingTopic[]).map((topic) => (
          <details key={topic}>
            <summary>{liftingTopics[topic]}</summary>
            <ul>
              {liftingResources
                .filter((source) => source.topic === topic)
                .map((source) => (
                  <li key={source.id}>
                    <span className="fine-print">
                      {source.publisher} · {source.kind}
                    </span>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}{" "}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                    <p>{source.summary}</p>
                  </li>
                ))}
            </ul>
          </details>
        ))}
        <p className="fine-print">
          Reviewed 10 September 2026. A curated reading list; these
          organisations do not endorse the app.
        </p>
      </section>
    </>
  );
}
