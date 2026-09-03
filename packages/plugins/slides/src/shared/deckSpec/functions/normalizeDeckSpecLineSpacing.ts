import { parseTextLineSpacingInput } from '../../textLayout/definitions/lineSpacing';

/**
 * 只服务持久化 DeckSpec admission：把历史 number 行距递归提升为当前明确合同。
 * 归一化在进入 DeckSpec 类型世界之前完成，业务层永远看不到双语义 number。
 */
export function normalizeDeckSpecLineSpacingInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeDeckSpecLineSpacingInput);
  }
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'lineSpacing') {
      normalized[key] = normalizeDeckSpecLineSpacingInput(entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    const lineSpacing = parseTextLineSpacingInput(entry);
    if (!lineSpacing) {
      throw new Error('Stored Slides deck spec contains invalid text lineSpacing.');
    }
    normalized[key] = lineSpacing;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

