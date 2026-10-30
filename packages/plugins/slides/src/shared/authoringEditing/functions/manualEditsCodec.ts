import { readInsertedObjects } from './readInsertedObjects';
import { readSlidesTextStylePatch } from './readSlidesTextStylePatch';
import { SLIDES_TEXT_STYLE_FIELDS } from '../definitions/editableText';
import { isEditableTextContent } from './editableText';
import type {
  SlidesManualEdits,
  SlidesManualSlideEdits,
  SlidesManualTargetEdit,
  SlidesManualTargetKind,
  SlidesManualTranslation,
  SlidesManualVisualSize,
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
  if (value.version !== 1 && value.version !== 2) {
    return { error: 'manualEdits.version 必须是 1 或 2。' };
  }
  if (!Array.isArray(value.slides)) return { error: 'manualEdits.slides 必须是数组。' };

  const slideKeys = new Set<string>();
  const slides: SlidesManualSlideEdits[] = [];
  for (const [slideIndex, rawSlide] of value.slides.entries()) {
    const parsed = parseSlideEdits(rawSlide, slideIndex, value.version);
    if ('error' in parsed) return parsed;
    if (slideKeys.has(parsed.value.slideKey)) {
      return { error: `manualEdits.slides 中 slideKey \"${parsed.value.slideKey}\" 重复。` };
    }
    slideKeys.add(parsed.value.slideKey);
    slides.push(parsed.value);
  }
  return { value: { version: 2, slides } };
}

function parseSlideEdits(
  value: unknown,
  slideIndex: number,
  version: 1 | 2,
): { readonly value: SlidesManualSlideEdits } | { readonly error: string } {
  const path = `manualEdits.slides[${slideIndex}]`;
  if (!isRecord(value) || !hasOnlyKeys(value, ['slideKey', 'targets', 'additions', 'paintOrder'])) {
    return { error: `${path} 必须是只含 slideKey / targets / additions 的对象。` };
  }
  if (!isSlidesAuthoringKey(value.slideKey)) {
    return { error: `${path}.slideKey 不是有效的作者 key。` };
  }
  if (!Array.isArray(value.targets)) return { error: `${path}.targets 必须是数组。` };

  const editKeys = new Set<string>();
  const targets: SlidesManualTargetEdit[] = [];
  for (const [targetIndex, rawTarget] of value.targets.entries()) {
    const parsed = parseTargetEdit(rawTarget, `${path}.targets[${targetIndex}]`, version);
    if ('error' in parsed) return parsed;
    if (editKeys.has(parsed.value.editKey)) {
      return { error: `${path}.targets 中 editKey \"${parsed.value.editKey}\" 重复。` };
    }
    editKeys.add(parsed.value.editKey);
    targets.push(parsed.value);
  }
  const order = value.paintOrder;
  if (order !== undefined && (!Array.isArray(order) || !order.every(isSlidesAuthoringKey) || new Set(order).size !== order.length)) return { error: `${path}.paintOrder 必须是唯一作者 key 数组。` };
  const additions = value.additions === undefined ? undefined : readInsertedObjects(value.additions);
  if (additions && 'error' in additions) return additions;
  return { value: { slideKey: value.slideKey, targets, ...(Array.isArray(order) && order.every(isSlidesAuthoringKey) ? { paintOrder: order } : {}), ...(additions ? { additions: additions.value } : {}) } };
}

function parseTargetEdit(
  value: unknown,
  path: string,
  version: 1 | 2,
): { readonly value: SlidesManualTargetEdit } | { readonly error: string } {
  if (!isRecord(value)) return { error: `${path} 必须是对象。` };
  if (!isSlidesAuthoringKey(value.editKey)) {
    return { error: `${path}.editKey 不是有效的作者 key。` };
  }
  if (!isTargetKind(value.kind)) return { error: `${path}.kind 不是支持的作者对象类型。` };
  const editKey = value.editKey;
  const kind = value.kind;

  if (version === 1) return parseV1TargetEdit(value, kind, editKey, path);

  if (value.deleted === true) {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'deleted'])) {
      return { error: `${path} 删除目标时不能同时保留其他人工值。` };
    }
    return { value: { kind, editKey, deleted: true } };
  }
  if (value.deleted !== undefined) return { error: `${path}.deleted 只能是 true。` };

  if (value.kind === 'text') {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'content', 'width', ...SLIDES_TEXT_STYLE_FIELDS, 'translation'])) {
      return { error: `${path} 含有 text 人工编辑不支持的字段。` };
    }
    if (value.content !== undefined && !isEditableTextContent(value.content)) {
      return { error: `${path}.content 必须是字符串或文字 run 数组。` };
    }
    if (value.width !== undefined && (!isPositiveFiniteNumber(value.width))) return { error: `${path}.width 必须是正数。` };
    const patch = readSlidesTextStylePatch(value);
    if ('error' in patch) return { error: `${path}: ${patch.error}` };
    const translation = parseOptionalTranslation(value.translation, `${path}.translation`);
    if ('error' in translation) return translation;
    if (
      value.content === undefined && value.width === undefined
      && Object.keys(patch.value).length === 0
      && translation.value === undefined
    ) {
      return { error: `${path} 至少需要一个文本人工值。` };
    }
    return {
      value: {
        kind: 'text',
        editKey: value.editKey,
        content: value.content,
        ...patch.value,
        ...(value.width !== undefined ? { width: value.width } : {}),
        translation: translation.value,
      },
    };
  }

  if (value.kind === 'frame') {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation', 'backgroundColor'])) {
      return { error: `${path} 含有 frame 人工编辑不支持的字段。` };
    }
    const translation = parseOptionalTranslation(value.translation, `${path}.translation`);
    if ('error' in translation) return translation;
    if (value.backgroundColor !== undefined && !isHexColor(value.backgroundColor)) {
      return { error: `${path}.backgroundColor 必须是 #RRGGBB。` };
    }
    if (translation.value === undefined && value.backgroundColor === undefined) {
      return { error: `${path} 至少需要 translation 或 backgroundColor。` };
    }
    return {
      value: {
        kind: 'frame',
        editKey: value.editKey,
        translation: translation.value,
        backgroundColor: value.backgroundColor,
      },
    };
  }

  if (value.kind === 'shape') {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation', 'fillColor', 'visualSize', 'content'])) {
      return { error: `${path} 含有 shape 人工编辑不支持的字段。` };
    }
    const translation = parseOptionalTranslation(value.translation, `${path}.translation`);
    if ('error' in translation) return translation;
    if (value.content !== undefined && typeof value.content !== 'string') {
      return { error: `${path}.content 必须是字符串。` };
    }
    if (value.fillColor !== undefined && !isHexColor(value.fillColor)) {
      return { error: `${path}.fillColor 必须是 #RRGGBB。` };
    }
    const visualSize = parseOptionalVisualSize(value.visualSize, `${path}.visualSize`);
    if ('error' in visualSize) return visualSize;
    if (translation.value === undefined && value.fillColor === undefined && visualSize.value === undefined && value.content === undefined) {
      return { error: `${path} 至少需要一个 shape 人工值。` };
    }
    return {
      value: {
        kind: 'shape',
        editKey: value.editKey,
        translation: translation.value,
        content: value.content,
        fillColor: value.fillColor,
        visualSize: visualSize.value,
      },
    };
  }

  if (value.kind === 'image') {
    if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation', 'visualSize', 'assetId', 'fit'])) {
      return { error: `${path} 含有 image 人工编辑不支持的字段。` };
    }
    if (value.assetId !== undefined && (typeof value.assetId !== 'string' || !value.assetId)) return { error: `${path}.assetId 无效。` };
    if (value.fit !== undefined && value.fit !== 'contain' && value.fit !== 'cover') return { error: `${path}.fit 无效。` };
    const translation = parseOptionalTranslation(value.translation, `${path}.translation`);
    if ('error' in translation) return translation;
    const visualSize = parseOptionalVisualSize(value.visualSize, `${path}.visualSize`);
    if ('error' in visualSize) return visualSize;
    if (translation.value === undefined && visualSize.value === undefined && value.assetId === undefined && value.fit === undefined) {
      return { error: `${path} 至少需要 translation 或 visualSize。` };
    }
    return {
      value: {
        kind: 'image',
        ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
        ...(value.fit === 'contain' || value.fit === 'cover' ? { fit: value.fit } : {}),
        editKey: value.editKey,
        translation: translation.value,
        visualSize: visualSize.value,
      },
    };
  }

  if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation'])) {
    return { error: `${path} 含有 ${value.kind} 人工编辑不支持的字段。` };
  }
  const translation = parseRequiredTranslation(value.translation, `${path}.translation`);
  if ('error' in translation) return translation;
  return { value: { kind: value.kind, editKey: value.editKey, translation: translation.value } };
}

function parseV1TargetEdit(
  value: Record<string, unknown>,
  kind: SlidesManualTargetKind,
  editKey: string,
  path: string,
): { readonly value: SlidesManualTargetEdit } | { readonly error: string } {
  if (kind === 'text') {
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
        editKey,
        content: value.content,
        translation: translation.value,
      },
    };
  }
  if (!hasOnlyKeys(value, ['kind', 'editKey', 'translation'])) {
    return { error: `${path} 含有 ${kind} 人工编辑不支持的字段。` };
  }
  const translation = parseRequiredTranslation(value.translation, `${path}.translation`);
  if ('error' in translation) return translation;
  if (kind === 'frame') return { value: { kind, editKey, translation: translation.value } };
  if (kind === 'shape') return { value: { kind, editKey, translation: translation.value } };
  if (kind === 'image') return { value: { kind, editKey, translation: translation.value } };
  return { value: { kind, editKey, translation: translation.value } };
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

function parseOptionalVisualSize(
  value: unknown,
  path: string,
): { readonly value: SlidesManualVisualSize | undefined } | { readonly error: string } {
  if (value === undefined) return { value: undefined };
  if (!isRecord(value) || !hasOnlyKeys(value, ['width', 'height'])) {
    return { error: `${path} 必须是只含 width / height 的对象。` };
  }
  if (!isPositiveFiniteNumber(value.width) || !isPositiveFiniteNumber(value.height)) {
    return { error: `${path}.width / height 必须是有限正数。` };
  }
  return { value: { width: value.width, height: value.height } };
}



function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/u.test(value);
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
