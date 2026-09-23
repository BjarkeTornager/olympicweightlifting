import type { Icon } from "@phosphor-icons/react";

// Each area of the journal keeps one hue, shown as a filled icon on a soft
// tile, so the same colour means the same thing on every screen.
export type Area =
  "train" | "food" | "sleep" | "cardio" | "health" | "coach" | "neutral";

export function AreaIcon({
  area,
  icon: Glyph,
  size = "md",
}: {
  area: Area;
  icon: Icon;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className="area-icon"
      data-area={area}
      data-size={size}
      aria-hidden="true"
    >
      <Glyph
        weight="fill"
        size={size === "lg" ? 26 : size === "sm" ? 16 : 20}
      />
    </span>
  );
}
