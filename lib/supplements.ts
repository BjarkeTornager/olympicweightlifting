import { z } from "zod";
import { foodDate } from "./nutrition";
import type { JournalState } from "./model";

// Supplements taken through the day: vitamins, minerals and training
// supplements, each recorded as the athlete said it. The app keeps a record;
// it does not judge doses.
export const supplementInputSchema = z
  .object({
    date: foodDate,
    name: z.string().trim().min(1).max(80),
    // As said: "1000 IU", "5 g", "2 capsules". Empty when not given.
    amount: z.string().trim().max(40).default(""),
  })
  .strict();
export const supplementSchema = supplementInputSchema.extend({
  id: z.string().uuid(),
  at: z.iso.datetime(),
});
export type Supplement = z.infer<typeof supplementSchema>;
export type SupplementInput = z.input<typeof supplementInputSchema>;

const key = (name: string) => name.trim().toLowerCase();

export function addSupplement(
  state: JournalState,
  input: SupplementInput,
  at = new Date(),
) {
  const supplement = supplementSchema.parse({
    ...supplementInputSchema.parse(input),
    id: crypto.randomUUID(),
    at: at.toISOString(),
  });
  state.health.supplements = [...(state.health.supplements ?? []), supplement];
  return supplement;
}

export function removeSupplement(state: JournalState, id: string) {
  const supplement = (state.health.supplements ?? []).find((s) => s.id === id);
  if (!supplement) throw Error("That supplement is not in your journal.");
  state.health.supplements = (state.health.supplements ?? []).filter(
    (s) => s.id !== id,
  );
  return supplement;
}

// What was taken on a date, and the athlete's usual supplements (taken on at
// least two of the previous fourteen days) not yet taken that day, so they
// can be ticked off with one tap.
export function supplementsForDay(state: JournalState, date: string) {
  const all = state.health.supplements ?? [];
  const taken = all
    .filter((s) => s.date === date)
    .sort((a, b) => a.at.localeCompare(b.at));
  // Not offsetDate from ./health, which imports this file's schema.
  const from = new Date(Date.parse(`${date}T12:00:00Z`) - 14 * 864e5)
    .toISOString()
    .slice(0, 10);
  const days = new Map<string, Set<string>>();
  const latest = new Map<string, Supplement>();
  for (const s of all) {
    if (s.date >= date || s.date < from) continue;
    const k = key(s.name);
    days.set(k, (days.get(k) ?? new Set()).add(s.date));
    const seen = latest.get(k);
    if (!seen || s.at > seen.at) latest.set(k, s);
  }
  const takenToday = new Set(taken.map((s) => key(s.name)));
  const usual = [...latest.entries()]
    .filter(([k]) => (days.get(k)?.size ?? 0) >= 2 && !takenToday.has(k))
    .map(([, s]) => ({ name: s.name, amount: s.amount }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { taken, usual };
}

export const supplementText = (s: { name: string; amount: string }) =>
  s.amount ? `${s.name} ${s.amount}` : s.name;
