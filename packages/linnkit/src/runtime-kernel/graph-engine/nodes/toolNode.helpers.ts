export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseJsonSafe(input: unknown): unknown {
  if (typeof input !== 'string' || input.length === 0) {
    return null;
  }
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}
