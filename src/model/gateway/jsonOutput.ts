/**
 * Kriya Omnitask — JSON output parsing shared by the gateway and the certification probes.
 */

/** Parses the first JSON object in a model reply (tolerates ```json fences). Null if none. */
export function parseJsonObject(content: string): Record<string, any> | null {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
