import type { SVGProps } from "react";

// Icons drawn for this journal on a 24px grid with a 1.75px rounded stroke.
// Active navigation fills the solid parts instead of switching icon family,
// so every screen keeps one drawing style. Utility glyphs (chevrons, close,
// check) still come from Phosphor in ./icons.
export type JournalIconProps = Omit<SVGProps<SVGSVGElement>, "fill"> & {
  size?: number;
  active?: boolean;
};
type Draw = (solid: string) => React.ReactNode;

function glyph(name: string, draw: Draw) {
  function JournalIcon({ size = 24, active = false, ...props }: JournalIconProps) {
    const solid = active ? "currentColor" : "none";
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {draw(solid)}
      </svg>
    );
  }
  JournalIcon.displayName = name;
  return JournalIcon;
}

// A loaded bar seen from the side: sleeve, big bumper, small plate, collar.
export const BarbellIcon = glyph("BarbellIcon", (solid) => (
  <>
    <path d="M1.5 12h21" />
    <rect x="4" y="5" width="3.25" height="14" rx="1.1" fill={solid} />
    <rect x="16.75" y="5" width="3.25" height="14" rx="1.1" fill={solid} />
    <rect x="7.25" y="8" width="1.75" height="8" rx="0.6" />
    <rect x="15" y="8" width="1.75" height="8" rx="0.6" />
  </>
));

// Morning over the platform: the day begins at the horizon line.
export const TodayIcon = glyph("TodayIcon", (solid) => (
  <>
    <path d="M6 16.5a6 6 0 0 1 12 0" fill={solid} />
    <path d="M2.5 16.5h19" />
    <path d="M12 5v2.25M5.4 8.4l1.5 1.5M18.6 8.4l-1.5 1.5M8 20h8" />
  </>
));

// A coach's whistle, in place of a generic AI sparkle: round chamber,
// flat mouthpiece and the sound hole.
export const WhistleIcon = glyph("WhistleIcon", (solid) => (
  <>
    <path d="M9 8.25h12v3.75h-6.6A5.75 5.75 0 1 1 9 8.25Z" fill={solid} />
    <circle
      cx="9"
      cy="14"
      r="1.75"
      stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"}
    />
    <path d="M17 8.25V6.5" />
  </>
));

// A training log closed with its elastic band.
export const LogbookIcon = glyph("LogbookIcon", (solid) => (
  <>
    <rect x="4.5" y="3" width="15" height="18" rx="2" fill={solid} />
    <path d="M8 3v18" stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"} />
    <path d="M16.5 3v18" />
  </>
));

// A bowl with steam: food as a meal, not a restaurant sign.
export const BowlIcon = glyph("BowlIcon", (solid) => (
  <>
    <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" fill={solid} />
    <path d="M9.5 3.5c-1 1.1 1 2.1 0 3.25M14.5 3.5c-1 1.1 1 2.1 0 3.25" />
  </>
));

export const SleepIcon = glyph("SleepIcon", (solid) => (
  <>
    <path
      d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"
      fill={solid}
    />
    <path d="M15 4h3.5L15 8h3.5" />
  </>
));

// A running shoe in profile.
export const ShoeIcon = glyph("ShoeIcon", (solid) => (
  <>
    <path
      d="M3 17.5V9.5l3-1.5 2.5 3 3-1.5 2.5 3.5 5.5 1.75A2.5 2.5 0 0 1 21 17.5Z"
      fill={solid}
    />
    <path d="M3 20.5h18" />
    <path d="M11 11.5l1.25-.75M13 13.5l1.25-.75" />
  </>
));

// Readiness as a gauge: today's check-in against the range you know.
export const GaugeIcon = glyph("GaugeIcon", (solid) => (
  <>
    <path d="M3.5 17a8.5 8.5 0 0 1 17 0Z" fill={solid} />
    <path
      d="M12 17l3.5-5"
      stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"}
    />
    <path d="M3.5 17h17" />
  </>
));

// Logged sessions: a ruled page with ticked rows.
export const TickedLogIcon = glyph("TickedLogIcon", (solid) => (
  <>
    <rect x="4" y="3" width="16" height="18" rx="2" fill={solid} />
    <path
      d="m7.5 8.5 1.25 1.25 2.25-2.5M7.5 14.5l1.25 1.25 2.25-2.5M13.5 8.75h3M13.5 14.75h3"
      stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"}
    />
  </>
));

export const RisingBarsIcon = glyph("RisingBarsIcon", (solid) => (
  <>
    <rect x="4" y="13" width="3.5" height="7" rx="0.75" fill={solid} />
    <rect x="10.25" y="9" width="3.5" height="11" rx="0.75" fill={solid} />
    <rect x="16.5" y="4" width="3.5" height="16" rx="0.75" fill={solid} />
  </>
));

export const PhotoIcon = glyph("PhotoIcon", (solid) => (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" fill={solid} />
    <path
      d="m3.5 17 5-5 4 4 2.5-2.5 5.5 5"
      stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"}
    />
    <circle
      cx="15.5"
      cy="9.5"
      r="1.25"
      stroke={solid === "none" ? "currentColor" : "var(--nav-cut, #fff)"}
    />
  </>
));

// A kettlebell stands for the movement library.
export const KettlebellIcon = glyph("KettlebellIcon", (solid) => (
  <>
    <path d="M8.75 9.5V7.25a3.25 3.25 0 0 1 6.5 0V9.5" />
    <path
      d="M7.25 9.5h9.5l1.5 2.25a6.25 6.25 0 0 1-3.5 8.75h-5.5a6.25 6.25 0 0 1-3.5-8.75Z"
      fill={solid}
    />
  </>
));
