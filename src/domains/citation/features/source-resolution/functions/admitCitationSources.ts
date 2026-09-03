import type { CitationSource } from '../definitions/citationSource';
import { isCanonicalCitationRef } from '../../reference/functions/citationRef';
import { createCitationSourceIdentity } from '../../../shared/functions/citationSourceAnchor';

function readRequiredText(value: string, field: string, ref: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Citation ${ref} 缺少 ${field}。`);
  }
  return normalized;
}

function readHttpUrl(value: string, ref: string): string {
  const normalized = readRequiredText(value, 'canonical URL', ref);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Web citation ${ref} 的 URL 不合法。`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Web citation ${ref} 只允许 HTTP(S) canonical URL。`);
  }
  return normalized;
}

function admitSource(source: CitationSource): CitationSource {
  if (!isCanonicalCitationRef(source.ref)) {
    throw new Error(`Citation ref ${JSON.stringify(source.ref)} 不符合 6 位 canonical ref 合同。`);
  }
  const title = readRequiredText(source.title, 'title', source.ref);

  if (source.sourceType === 'knowledge_base') {
    return {
      sourceType: source.sourceType,
      ref: source.ref,
      docId: readRequiredText(source.docId, 'docId', source.ref),
      blockId: readRequiredText(source.blockId, 'blockId', source.ref),
      title,
      snippet: source.snippet,
      ...(source.kbId?.trim() ? { kbId: source.kbId.trim() } : {}),
    };
  }

  return {
    sourceType: source.sourceType,
    ref: source.ref,
    url: readHttpUrl(source.url, source.ref),
    title,
    snippet: source.snippet,
    ...(source.authors && source.authors.length > 0
      ? { authors: source.authors.map(author => author.trim()).filter(Boolean) }
      : {}),
    ...(source.publishedAt?.trim() ? { publishedAt: source.publishedAt.trim() } : {}),
    ...(source.containerTitle?.trim() ? { containerTitle: source.containerTitle.trim() } : {}),
  };
}

/**
 * 接纳一批跨来源 Citation 事实。
 *
 * - 请求 ref 必须全部命中，禁止调用方使用无法追溯的引用；
 * - 同 ref 指向不同来源锚点时 fail-fast；
 * - 同锚点重复候选保留 resolver 给出的第一条快照；
 * - 输出顺序与 Markdown 中 ref 首次出现顺序一致。
 */
export function admitCitationSources(params: {
  readonly requestedRefs: readonly string[];
  readonly candidates: readonly CitationSource[];
}): Readonly<Record<string, CitationSource>> {
  const requestedRefs: string[] = [];
  const requestedSet = new Set<string>();
  for (const ref of params.requestedRefs) {
    if (!isCanonicalCitationRef(ref)) {
      throw new Error(`Citation ref ${JSON.stringify(ref)} 不符合 6 位 canonical ref 合同。`);
    }
    if (requestedSet.has(ref)) continue;
    requestedSet.add(ref);
    requestedRefs.push(ref);
  }

  const admittedByRef = new Map<string, CitationSource>();
  for (const rawCandidate of params.candidates) {
    const candidate = admitSource(rawCandidate);
    if (!requestedSet.has(candidate.ref)) {
      throw new Error(`Citation source resolver 返回了未请求的 ref ${candidate.ref}。`);
    }
    const existing = admittedByRef.get(candidate.ref);
    if (!existing) {
      admittedByRef.set(candidate.ref, candidate);
      continue;
    }
    if (createCitationSourceIdentity(existing) !== createCitationSourceIdentity(candidate)) {
      throw new Error(`Citation ref ${candidate.ref} 对应了不同来源锚点。`);
    }
  }

  const missingRefs = requestedRefs.filter(ref => !admittedByRef.has(ref));
  if (missingRefs.length > 0) {
    throw new Error(`无法验证引用：${missingRefs.map(ref => `[@${ref}]`).join(', ')}。`);
  }

  return Object.fromEntries(
    requestedRefs.map(ref => {
      const source = admittedByRef.get(ref);
      if (!source) {
        throw new Error(`Citation admission 内部缺少已验证来源 ${ref}。`);
      }
      return [ref, source];
    })
  );
}
