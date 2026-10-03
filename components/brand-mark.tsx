// The split-disc mark, as on the app icon and the iPhone app: Coach's
// ultramarine half and your lifted vermilion half. Decorative beside the
// "Lift Journal" wordmark, so screen readers skip it.
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="152 142 720 740"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M492,300.18 A10,10 0 0 0 481.64,290.19 A290,290 0 0 0 481.64,869.81 A10,10 0 0 0 492,859.82 Z"
        fill="var(--mark-coach)"
      />
      <path
        d="M532,164.18 A10,10 0 0 1 542.36,154.19 A290,290 0 0 1 542.36,733.81 A10,10 0 0 1 532,723.82 Z"
        fill="var(--mark-you)"
      />
    </svg>
  );
}
