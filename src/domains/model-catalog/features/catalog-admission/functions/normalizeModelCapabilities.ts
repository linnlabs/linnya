export function normalizeModelCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const capability = item.trim();
    if (capability.length === 0) return null;
    if (seen.has(capability)) continue;
    seen.add(capability);
    normalized.push(capability);
  }
  return normalized.length > 0 ? normalized : null;
}
