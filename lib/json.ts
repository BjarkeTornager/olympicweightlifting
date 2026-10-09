// PostgreSQL JSONB normalises object-key order. Equality and mutation hashes must
// not depend on the order in which a browser or a backup wrote those keys.
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, sort(item)]),
      );
    return input;
  };
  return JSON.stringify(sort(value));
}

// Whether two JSON values are the same as stored, in any object-key order and
// with keys holding undefined left out, as JSON leaves them. The same answer
// as comparing canonicalJson strings, without building them.
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  let keys = 0;
  for (const key of Object.keys(x)) {
    if (x[key] === undefined) continue;
    keys++;
    if (!jsonEqual(x[key], y[key])) return false;
  }
  for (const key of Object.keys(y)) if (y[key] !== undefined) keys--;
  return keys === 0;
}
