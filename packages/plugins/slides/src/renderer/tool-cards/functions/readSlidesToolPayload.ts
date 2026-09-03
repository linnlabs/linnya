export type SlidesToolRecord = Record<string, unknown>;

export function isSlidesToolRecord(value: unknown): value is SlidesToolRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readSlidesToolString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readSlidesToolNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
