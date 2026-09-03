import type {
  ToolModelInputAttachmentSelection,
  ToolModelInputDeclaration,
} from '../definitions/toolModelInput';

export type ToolModelInputDeclarationValidation =
  | {
      readonly ok: true;
      readonly declaration: ToolModelInputDeclaration;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

const DECLARATION_KEYS = new Set(['attachments']);
const SELECTION_KEYS = new Set(['id', 'uri', 'label']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function readTrimmedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return undefined;
  }
  return value === value.trim() ? value : undefined;
}

function parseSelection(
  value: unknown,
  index: number,
): ToolModelInputDeclarationValidation | ToolModelInputAttachmentSelection {
  if (!isRecord(value) || !hasOnlyKeys(value, SELECTION_KEYS)) {
    return { ok: false, reason: `modelInput.attachments[${index}] 必须是 strict selection。` };
  }

  const id = readTrimmedString(value.id, 200);
  if (!id) {
    return { ok: false, reason: `modelInput.attachments[${index}].id 必须是非空身份。` };
  }
  const uri = readTrimmedString(value.uri, 500);
  if (!uri) {
    return { ok: false, reason: `modelInput.attachments[${index}].uri 必须是非空资源 URI。` };
  }

  if (value.label !== undefined) {
    const label = readTrimmedString(value.label, 200);
    if (!label) {
      return { ok: false, reason: `modelInput.attachments[${index}].label 必须是非空安全标签。` };
    }
    return Object.freeze({ id, uri, label });
  }

  return Object.freeze({ id, uri });
}

/**
 * 只校验 framework 拥有的声明形状。
 * URI scheme、资源授权与图片完整性必须留给 host resolver，避免 host 存储语义反向进入 linnkit。
 */
export function parseToolModelInputDeclaration(
  value: unknown,
): ToolModelInputDeclarationValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, DECLARATION_KEYS)) {
    return { ok: false, reason: 'modelInput 必须是只包含 attachments 的 strict 对象。' };
  }
  if (!Array.isArray(value.attachments) || value.attachments.length === 0) {
    return { ok: false, reason: 'modelInput.attachments 必须是非空数组。' };
  }

  const selections: ToolModelInputAttachmentSelection[] = [];
  const selectionIds = new Set<string>();
  for (let index = 0; index < value.attachments.length; index += 1) {
    const parsed = parseSelection(value.attachments[index], index);
    if ('ok' in parsed) {
      return parsed;
    }
    if (selectionIds.has(parsed.id)) {
      return { ok: false, reason: `modelInput attachment selection id 重复: ${parsed.id}` };
    }
    selectionIds.add(parsed.id);
    selections.push(parsed);
  }

  return {
    ok: true,
    declaration: Object.freeze({ attachments: Object.freeze(selections) }),
  };
}
