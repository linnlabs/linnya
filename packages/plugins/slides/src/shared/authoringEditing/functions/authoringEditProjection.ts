import { isEditableTextContent, isAuthorTextStyle } from './editableText';
import type {
  SlidesAuthoringEditCapability,
  SlidesAuthoringEditProjection,
  SlidesAuthoringFillEditProjection,
  SlidesAuthoringTextEditProjection,
} from '../definitions/authoringEditProjection';

export function isSlidesAuthoringEditProjection(
  value: unknown,
): value is SlidesAuthoringEditProjection {
  if (!isRecord(value) || !hasOnlyKeys(value, ['capabilities', 'text', 'fill'])) {
    return false;
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability)) {
    return false;
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) return false;

  const text = value.text;
  if (text !== undefined && !isTextProjection(text)) return false;
  const fill = value.fill;
  if (fill !== undefined && !isFillProjection(fill)) return false;
  const canSetText = value.capabilities.includes('set_text_content');
  const canSetTextStyle = value.capabilities.includes('set_text_style');
  const canSetFill = value.capabilities.includes('set_fill_color');
  if (canSetText !== (text?.kind === 'plain_text' || (text?.kind === 'rich_text' && text.content !== undefined))) return false;
  // 改字和改样式是独立能力；Shape 字符串可改字，但尚未开放文字样式。
  if (canSetTextStyle && text?.kind !== 'plain_text') return false;
  if (canSetFill !== (fill !== undefined)) return false;
  return value.capabilities.includes('translate');
}

function isCapability(value: unknown): value is SlidesAuthoringEditCapability {
  return value === 'translate'
    || value === 'set_text_content'
    || value === 'set_text_style'
    || value === 'set_fill_color'
    || value === 'set_visual_size'
    || value === 'delete';
}

function isTextProjection(value: unknown): value is SlidesAuthoringTextEditProjection {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'plain_text') {
    return hasOnlyKeys(value, ['kind', 'content', 'fontSizePt', 'color', 'baseStyle'])
      && typeof value.content === 'string'
      && (value.baseStyle === undefined || isAuthorTextStyle(value.baseStyle))
      && (value.fontSizePt === undefined || isFontSize(value.fontSizePt))
      && (value.color === undefined || isHexColor(value.color));
  }
  return value.kind === 'rich_text' && hasOnlyKeys(value, ['kind', 'content', 'baseStyle'])
    && (value.content === undefined || (Array.isArray(value.content) && isEditableTextContent(value.content)))
    && (value.baseStyle === undefined || isAuthorTextStyle(value.baseStyle));
}

function isFillProjection(value: unknown): value is SlidesAuthoringFillEditProjection {
  if (!isRecord(value) || value.kind === undefined) return false;
  if (value.kind === 'solid') {
    return hasOnlyKeys(value, ['kind', 'color']) && isHexColor(value.color);
  }
  return value.kind === 'non_solid' && hasOnlyKeys(value, ['kind']);
}

function isFontSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 400;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}
