/**
 * Parse a `Cookie` request header (`"a=1; b=x%20y"`) into a name -> value object.
 * Values are URL-decoded; if decoding fails the raw value is kept. When a name appears
 * twice, the first one wins. Accepts null/undefined and returns `{}`.
 * (The result has no prototype, so a cookie named `__proto__` is harmless.)
 */
export function parseCookie(
  header: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
