import type { CitationSourceAnchor } from '../definitions/citationSourceAnchor';

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Citation source anchor 缺少 ${field}。`);
  return normalized;
}

function requireHttpUrl(value: string): string {
  const normalized = requireText(value, 'canonical URL');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Web citation source anchor 的 URL 不合法。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Web citation source anchor 只允许 HTTP(S) canonical URL。');
  }
  return normalized;
}

/** 在 ref 分配和来源冲突检查前统一接纳锚点，禁止各 producer 复制身份规则。 */
export function admitCitationSourceAnchor(anchor: CitationSourceAnchor): CitationSourceAnchor {
  if (anchor.sourceType === 'knowledge_base') {
    return {
      sourceType: 'knowledge_base',
      docId: requireText(anchor.docId, 'docId'),
      blockId: requireText(anchor.blockId, 'blockId'),
    };
  }
  return {
    sourceType: 'web',
    url: requireHttpUrl(anchor.url),
  };
}

/**
 * JSON tuple 保留来源命名空间与字段边界，避免 `a:b + c` 一类字符串拼接歧义。
 * 该值是持久化 claim 的业务键；变更格式等同于一次显式的数据迁移。
 */
export function createCitationSourceIdentity(anchor: CitationSourceAnchor): string {
  const admitted = admitCitationSourceAnchor(anchor);
  return admitted.sourceType === 'knowledge_base'
    ? JSON.stringify(['knowledge_base', admitted.docId, admitted.blockId])
    : JSON.stringify(['web', admitted.url]);
}
