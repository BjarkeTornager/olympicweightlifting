export const simpleRoutine = {
  name: "Lower body accessories",
  exercises: [
    {
      exerciseId: "seated_leg_curl",
      sets: Array.from({ length: 3 }, () => ({ weight: 35, reps: 12 })),
    },
    {
      exerciseId: "standing_calf_raise",
      sets: Array.from({ length: 3 }, () => ({ weight: 20, reps: 15 })),
    },
  ],
};
export const mixedProgram = {
  name: "Strength and movement",
  weeks: 6,
  notes: "A flexible weekly plan. Loads are starting suggestions.",
  days: [
    {
      name: "Monday · Lower",
      exercises: [
        {
          exerciseId: "seated_leg_curl",
          sets: 3,
          reps: 10,
          repsMax: 12,
          weight: 35,
          restSeconds: 90,
          targetRpe: 7,
          notes: "Controlled reps.",
        },
        {
          exerciseId: "custom:Landmine squat",
          sets: 3,
          reps: 8,
          weight: null,
          notes: "Choose a comfortable load.",
        },
      ],
    },
    {
      name: "Wednesday · Run",
      exercises: [],
      cardio: [
        {
          activity: "running",
          durationSeconds: 1800,
          notes: "Easy conversational effort.",
        },
      ],
    },
    {
      name: "Friday · Recovery",
      exercises: [],
      notes: "Rest or gentle mobility.",
    },
  ],
};
