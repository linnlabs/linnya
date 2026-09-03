import { CitationRefSchema } from '@app/schemas';

/** 判断字符串是否符合 Citation 在协议层使用的 canonical ref 合同。 */
export function isCanonicalCitationRef(value: unknown): value is string {
  return CitationRefSchema.safeParse(value).success;
}

/**
 * 接纳工具入参中的三种 Citation ref 外观，并归一为内部使用的裸 ref。
 * Markdown 正文解析仍由 document-read feature 负责，避免把文档语法混进本函数。
 */
export function normalizeCitationRef(raw: string): string | undefined {
  const trimmed = raw.trim();
  const candidate = trimmed.startsWith('[@') && trimmed.endsWith(']')
    ? trimmed.slice(2, -1)
    : trimmed.startsWith('@')
      ? trimmed.slice(1)
      : trimmed;
  const parsed = CitationRefSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** 把 canonical ref 投影为面向用户和 Agent 的 Markdown 展示形式。 */
export function formatCitationRef(ref: string): string {
  return `[@${CitationRefSchema.parse(ref)}]`;
}
