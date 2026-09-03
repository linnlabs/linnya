import { z } from 'zod';

export type SerializableJsonValue =
  | string
  | number
  | boolean
  | null
  | SerializableJsonValue[]
  | { [key: string]: SerializableJsonValue };

export const SerializableJsonValue: z.ZodType<SerializableJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(SerializableJsonValue),
    z.record(SerializableJsonValue),
  ]),
);

export const SerializableJsonRecord = z.record(SerializableJsonValue);
export type SerializableJsonRecord = z.infer<typeof SerializableJsonRecord>;

export function toSerializableJsonValue(value: unknown): SerializableJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: SerializableJsonValue[] = [];
    for (const item of value) {
      const serialized = toSerializableJsonValue(item);
      if (serialized !== undefined) {
        items.push(serialized);
      }
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const record: Record<string, SerializableJsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      const serialized = toSerializableJsonValue(child);
      if (serialized !== undefined) {
        record[key] = serialized;
      }
    }
    return record;
  }
  return undefined;
}

export function toSerializableJsonRecord(value: unknown): SerializableJsonRecord | undefined {
  const serialized = toSerializableJsonValue(value);
  if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
    return undefined;
  }
  return serialized;
}
