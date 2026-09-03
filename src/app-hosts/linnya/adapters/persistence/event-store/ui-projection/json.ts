import type { SerializableJsonRecord, SerializableJsonValue } from 'linnkit/contracts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readSerializableRecord(value: unknown): SerializableJsonRecord | null {
  return isRecord(value) ? (value as SerializableJsonRecord) : null;
}

export function readRecordField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function stableStringifyJson(value: SerializableJsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: SerializableJsonValue): SerializableJsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, SerializableJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function toSerializableValue(value: unknown): SerializableJsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toSerializableValue);
  }
  if (isRecord(value)) {
    const output: Record<string, SerializableJsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        output[key] = toSerializableValue(child);
      }
    }
    return output;
  }
  return String(value);
}

export function compactRecord(
  value: Record<string, SerializableJsonValue | undefined>,
): Record<string, SerializableJsonValue> {
  const output: Record<string, SerializableJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }
  return output;
}

