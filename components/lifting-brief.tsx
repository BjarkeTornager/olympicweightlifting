import { experienceLabels, type LiftingBrief } from "@/lib/lifting-brief";

export function LiftingBriefDetails({ brief }: { brief: LiftingBrief | null }) {
  if (!brief)
    return <p>No lifting brief saved. You can build one at your own pace.</p>;
  const fields = [
    ["Goal", brief.goal],
    ["Why it matters", brief.why],
    ["Experience", experienceLabels[brief.experience]],
    [
      "Availability",
      `${brief.daysPerWeek ?? "Unspecified"} days/week · ${brief.minutesPerSession ?? "unspecified"} minutes/session`,
    ],
    ["Equipment", brief.equipment],
    ["Schedule & constraints", brief.constraints],
    ["Current priority", brief.priority],
    ["Target date", brief.targetDate],
  ];
  return (
    <dl className="lifting-brief-details">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "Not specified"}</dd>
        </div>
      ))}
    </dl>
  );
}
