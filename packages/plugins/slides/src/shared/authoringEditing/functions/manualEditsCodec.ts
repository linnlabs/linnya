import type {
  SlidesManualEdits,
  SlidesManualSlideEdits,
  SlidesManualTargetEdit,
  SlidesManualTargetKind,
  SlidesManualTranslation,
} from '../definitions/manualEdits';
import { isSlidesAuthoringKey } from './authoringIdentity';

export type SlidesManualEditsParseResult =
  | { readonly value: SlidesManualEdits }
  | { readonly error: string };

const TARGET_KINDS: readonly SlidesManualTargetKind[] = [
  'text',
  'frame',
  'shape',
  'image',
  'table',
  'chart',
  'svgGraphic',
  'formula',
];

export function parseSlidesManualEdits(value: unknown): SlidesManualEditsParseResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'slides'])) {
    return { error: 'manualEdits 必须是只含 version / slides 的对象。' };
  }
  if (value.version !== 1) return { error: 'manualEdits.version 必须是 1。' };
  if (!Array.isArray(value.slides)) return { error: 'manualEdits.slides 必须是数组。' };

  const slideKeys = new Set<string>();
  const slides: SlidesManualSlideEdits[] = [];
  for (const [slideIndex, rawSlide] of value.slides.entries()) {
    const parsed = parseSlideEdits(rawSlide, slideIndex);
    if ('error' in parsed) return parsed;
    if (slideKeys.has(parsed.value.slideKey)) {
      return { error: `manualEdits.slides 中 slideKey \"${parsed.value.slideKey}\" 重复。` };
    }
    slideKeys.add(parsed.value.slideKey);
    slides.push(parsed.value);
  }
  return { value: { version: 1, slides } };
}

function parseSlideEdits(
  value: unknown,
  slideIndex: number,
): { readonly value: SlidesManualSlideEdits } | { readonly error: string } {
  const path = `manualEdits.slides[${slideIndex}]`;
  if (!isRecord(value) || !hasOnlyKeys(value, ['slideKey', 'targets'])) {
    return { error: `${path} 必须是只含 slideKey / targets 的对象。` };
  }
  if (!isSlidesAuthoringKey(value.slideKey)) {
    return { error: `${path}.slideKey 不是有效的作者 key。` };
  }
  if (!Array.isArray(value.targets)) return { error: `${path}.targets 必须是数组。` };

  const editKeys = new Set<string>();
  const targets: SlidesManualTargetEdit[] = [];
  for (const [targetIndex, rawTarget] of value.targets.entries()) {
    const parsed = parseTargetEdit(rawTarget, `${path}.targets[${targetIndex}]`);
    if ('error' in parsed) return parsed;
    if (editKeys.has(parsed.value.editKey)) {
      return { error: `${path}.targets 中 editKey \"${parsed.value.editKey}\" 重复。` };
    }
    editKeys.add(parsed.value.editKey);
    targets.push(parsed.value);
  }
  return { value: { slideKey: value.slideKey, targets } };
}

function parseTargetEdit(
  value: unknown,
  path: string,
): { readonly value: SlidesManualTargetEdit } | { readonly error: string } {
  if (!isRecord(value)) return { error: `${path} 必须是对象。` };
  if (!isSlidesAuthoringKey(value.editKey)) {
    return { error: `${path}.editKey 不是有效的作者 key。` };
  }
  if (!isTargetKind(value.kind)) return { error: `${path}.kind 不是支持的作者对象类型。` };

  if (value.kind === 'text') {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'content', 'translation'])) {
      return { error: `${path} 含有 text 人工编辑不支持的字段。` };
    }
    if (value.content !== undefined && typeof value.content !== 'string') {
      return { error: `${path}.content 必须是字符串。` };
    }
    const translation = parseOptionalTranslation(value.translation, `${path}.translation`);
    if ('error' in translation) return translation;
    if (value.content === undefined && translation.value === undefined) {
      return { error: `${path} 至少需要 content 或 translation。` };
    }
    return {
      value: {
        kind: 'text',
        editKey: value.editKey,
        content: value.content,
        translation: translation.value,
      },
    };
  }

  if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation'])) {
    return { error: `${path} 含有 ${value.kind} 人工编辑不支持的字段。` };
  }
  const translation = parseRequiredTranslation(value.translation, `${path}.translation`);
  if ('error' in translation) return translation;
  if (value.kind === 'frame') {
    return { value: { kind: 'frame', editKey: value.editKey, translation: translation.value } };
  }
  return { value: { kind: value.kind, editKey: value.editKey, translation: translation.value } };
}

function parseOptionalTranslation(
  value: unknown,
  path: string,
): { readonly value: SlidesManualTranslation | undefined } | { readonly error: string } {
  if (value === undefined) return { value: undefined };
  return parseRequiredTranslation(value, path);
}

function parseRequiredTranslation(
  value: unknown,
  path: string,
): { readonly value: SlidesManualTranslation } | { readonly error: string } {
  if (!isRecord(value) || !hasOnlyKeys(value, ['dx', 'dy'])) {
    return { error: `${path} 必须是只含 dx / dy 的对象。` };
  }
  if (!Number.isFinite(value.dx) || !Number.isFinite(value.dy)) {
    return { error: `${path}.dx / dy 必须是有限数字。` };
  }
  if (typeof value.dx !== 'number' || typeof value.dy !== 'number') {
    return { error: `${path}.dx / dy 必须是有限数字。` };
  }
  return { value: { dx: value.dx, dy: value.dy } };
}

function isTargetKind(value: unknown): value is SlidesManualTargetKind {
  return typeof value === 'string' && TARGET_KINDS.some(kind => kind === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

