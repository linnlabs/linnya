import type {
  SlidesAuthoringEditCapability,
  SlidesAuthoringEditProjection,
  SlidesAuthoringTextEditProjection,
} from '../definitions/authoringEditProjection';

export function isSlidesAuthoringEditProjection(
  value: unknown,
): value is SlidesAuthoringEditProjection {
  if (!isRecord(value) || !hasOnlyKeys(value, ['capabilities', 'text'])) {
    return false;
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability)) {
    return false;
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) return false;

  const text = value.text;
  if (text !== undefined && !isTextProjection(text)) return false;
  const canSetText = value.capabilities.includes('set_text_content');
  if (canSetText !== (text?.kind === 'plain_text')) return false;
  return value.capabilities.includes('translate');
}

function isCapability(value: unknown): value is SlidesAuthoringEditCapability {
  return value === 'translate' || value === 'set_text_content';
}

function isTextProjection(value: unknown): value is SlidesAuthoringTextEditProjection {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'plain_text') {
    return hasOnlyKeys(value, ['kind', 'content']) && typeof value.content === 'string';
  }
  return value.kind === 'rich_text' && hasOnlyKeys(value, ['kind']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}
