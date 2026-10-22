/** Stable JSON encoding, independent of object insertion order and database JSONB ordering. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error('Non-JSON snapshot value');
  return text;
}
