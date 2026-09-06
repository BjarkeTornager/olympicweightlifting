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
