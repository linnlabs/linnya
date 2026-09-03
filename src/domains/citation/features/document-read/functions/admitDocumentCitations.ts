import { createHash } from 'node:crypto';
import { isCanonicalCitationRef } from '../../reference/functions/citationRef';
import {
  createCitationRefCandidate,
  MAX_CITATION_REF_COLLISION_ATTEMPTS,
} from '../../reference/functions/createCitationRefCandidate';
import { createCitationSourceIdentity } from '../../../shared/functions/citationSourceAnchor';
import type {
  DocumentCitationDiagnostic,
  DocumentCitationNodeSnapshot,
  DocumentCitationProjection,
  DocumentCitationSource,
} from '../definitions/documentCitationProjection';

interface StructuredNode {
  readonly type?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
}

interface RawCitationNode {
  readonly occurrence: number;
  readonly attrs: Readonly<Record<string, unknown>>;
}

interface InvalidCitation {
  readonly kind: 'invalid';
  readonly occurrence: number;
  readonly citationId?: string;
  readonly reason: string;
}

interface ManualCitation {
  readonly kind: 'manual';
  readonly occurrence: number;
  readonly citationId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly excerpts: readonly string[];
}

interface KnowledgeCitation {
  readonly kind: 'knowledge_base';
  readonly occurrence: number;
  readonly citationId: string;
  readonly sourceKey: string;
  readonly ref?: string;
  readonly docId: string;
  readonly blockId: string;
  readonly kbId?: string;
  readonly title: string;
  readonly excerpts: readonly string[];
}

interface WebCitation {
  readonly kind: 'web';
  readonly occurrence: number;
  readonly citationId: string;
  readonly sourceKey: string;
  readonly ref?: string;
  readonly url: string;
  readonly title: string;
  readonly excerpts: readonly string[];
  readonly authors: readonly string[];
  readonly publishedAt?: string;
  readonly containerTitle?: string;
}

type ParsedCitation = InvalidCitation | ManualCitation | KnowledgeCitation | WebCitation;
type RangedCitation = KnowledgeCitation | WebCitation;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(
  attrs: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = attrs[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringList(attrs: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = attrs[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readExcerpts(attrs: Readonly<Record<string, unknown>>): readonly string[] {
  const excerpts: string[] = [];
  const seen = new Set<string>();
  const rawSnippet = attrs['snippet'];
  const candidates = [
    typeof rawSnippet === 'string' && rawSnippet.trim().length > 0 ? rawSnippet : undefined,
    ...readStringList(attrs, 'snippets'),
  ];
  for (const excerpt of candidates) {
    if (!excerpt || seen.has(excerpt)) continue;
    seen.add(excerpt);
    excerpts.push(excerpt);
  }
  return excerpts;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function collectDocumentCitationNodeSnapshots(
  node: unknown
): readonly DocumentCitationNodeSnapshot[] {
  const result: DocumentCitationNodeSnapshot[] = [];

  const visit = (value: unknown): void => {
    if (!isRecord(value)) return;
    const nodeValue: StructuredNode = value;
    if (nodeValue.type === 'citationNode') {
      result.push({ attrs: isRecord(nodeValue.attrs) ? nodeValue.attrs : {} });
    }
    if (Array.isArray(nodeValue.content)) {
      nodeValue.content.forEach(visit);
    }
  };

  visit(node);
  return result;
}

function parseCitation(node: RawCitationNode): ParsedCitation {
  const citationId = readNonEmptyString(node.attrs, 'citationId');
  if (!citationId) {
    return {
      kind: 'invalid',
      occurrence: node.occurrence,
      reason: 'CitationNode 缺少 citationId。',
    };
  }

  const sourceType = readNonEmptyString(node.attrs, 'sourceType');
  const sourceId = readNonEmptyString(node.attrs, 'sourceId');
  const title = readNonEmptyString(node.attrs, 'title') ?? '';
  const excerpts = readExcerpts(node.attrs);
  const rawRef = readNonEmptyString(node.attrs, 'ref');
  if (rawRef && !isCanonicalCitationRef(rawRef)) {
    return {
      kind: 'invalid',
      occurrence: node.occurrence,
      citationId,
      reason: `CitationNode ${createSafeMarkerIdentity(citationId)} 的 ref 不符合 6 位 canonical ref 合同。`,
    };
  }

  if (sourceType === 'manual') {
    if (!sourceId) {
      return {
        kind: 'invalid',
        occurrence: node.occurrence,
        citationId,
        reason: `Manual CitationNode ${createSafeMarkerIdentity(citationId)} 缺少 sourceId。`,
      };
    }
    return {
      kind: 'manual',
      occurrence: node.occurrence,
      citationId,
      sourceId,
      title,
      excerpts,
    };
  }

  if (sourceType === 'knowledge_base') {
    const blockId = readNonEmptyString(node.attrs, 'blockId');
    if (!sourceId || !blockId || !title) {
      return {
        kind: 'invalid',
        occurrence: node.occurrence,
        citationId,
        reason: `Knowledge CitationNode ${createSafeMarkerIdentity(citationId)} 缺少 docId/sourceId、blockId 或 title。`,
      };
    }
    const kbId = readNonEmptyString(node.attrs, 'kbId');
    return {
      kind: 'knowledge_base',
      occurrence: node.occurrence,
      citationId,
      sourceKey: createCitationSourceIdentity({
        sourceType: 'knowledge_base',
        docId: sourceId,
        blockId,
      }),
      ...(rawRef ? { ref: rawRef } : {}),
      docId: sourceId,
      blockId,
      ...(kbId ? { kbId } : {}),
      title,
      excerpts,
    };
  }

  if (sourceType === 'web') {
    const url = readNonEmptyString(node.attrs, 'url');
    if (!sourceId || !url || sourceId !== url || !isHttpUrl(url) || !title) {
      return {
        kind: 'invalid',
        occurrence: node.occurrence,
        citationId,
        reason: `Web CitationNode ${createSafeMarkerIdentity(citationId)} 必须包含 title，并使用一致的 HTTP(S) canonical sourceId 与 url。`,
      };
    }
    const authors = readStringList(node.attrs, 'authors');
    const publishedAt = readNonEmptyString(node.attrs, 'date');
    const containerTitle = readNonEmptyString(node.attrs, 'containerTitle');
    return {
      kind: 'web',
      occurrence: node.occurrence,
      citationId,
      sourceKey: createCitationSourceIdentity({ sourceType: 'web', url }),
      ...(rawRef ? { ref: rawRef } : {}),
      url,
      title,
      excerpts,
      authors,
      ...(publishedAt ? { publishedAt } : {}),
      ...(containerTitle ? { containerTitle } : {}),
    };
  }

  return {
    kind: 'invalid',
    occurrence: node.occurrence,
    citationId,
    reason: `CitationNode ${createSafeMarkerIdentity(citationId)} 使用了不受支持的 sourceType。`,
  };
}

function citationIdentityFingerprint(citation: ParsedCitation): string {
  if (citation.kind === 'invalid') return `invalid:${citation.reason}`;
  if (citation.kind === 'manual') return `manual:${citation.sourceId}`;
  return `${citation.sourceKey}:${citation.ref ?? ''}`;
}

function assertCitationIdConsistency(citations: readonly ParsedCitation[]): void {
  const fingerprintByCitationId = new Map<string, string>();
  for (const citation of citations) {
    if (!('citationId' in citation) || !citation.citationId) continue;
    const fingerprint = citationIdentityFingerprint(citation);
    const existing = fingerprintByCitationId.get(citation.citationId);
    if (existing && existing !== fingerprint) {
      throw new Error(
        `CitationNode ${createSafeMarkerIdentity(citation.citationId)} 在同一文档中对应了冲突的来源事实。`
      );
    }
    fingerprintByCitationId.set(citation.citationId, fingerprint);
  }
}

function reservePersistedRefs(citations: readonly RangedCitation[]): {
  readonly refBySourceKey: ReadonlyMap<string, string>;
  readonly usedRefs: Set<string>;
} {
  const sourceKeyByRef = new Map<string, string>();
  const refBySourceKey = new Map<string, string>();
  const usedRefs = new Set<string>();

  for (const citation of citations) {
    if (!citation.ref) continue;
    const existingSourceKey = sourceKeyByRef.get(citation.ref);
    if (existingSourceKey && existingSourceKey !== citation.sourceKey) {
      throw new Error(`Citation ref ${citation.ref} 在同一文档中对应了不同来源。`);
    }
    const existingRef = refBySourceKey.get(citation.sourceKey);
    if (existingRef && existingRef !== citation.ref) {
      throw new Error(
        `同一 Citation 来源在文档中保存了不同 ref：${existingRef} / ${citation.ref}。`
      );
    }
    sourceKeyByRef.set(citation.ref, citation.sourceKey);
    refBySourceKey.set(citation.sourceKey, citation.ref);
    usedRefs.add(citation.ref);
  }

  return { refBySourceKey, usedRefs };
}

/**
 * 文档读取不属于 Conversation 生产链；仅在合法 CitationNode 没有持久化 ref 时，
 * 依据结构化来源身份为这一次文档投影分配确定性别名。
 */
function createDocumentCitationRef(sourceIdentity: string, usedRefs: Set<string>): string {
  for (let attempt = 0; attempt < MAX_CITATION_REF_COLLISION_ATTEMPTS; attempt += 1) {
    const ref = createCitationRefCandidate(sourceIdentity, attempt);
    if (!usedRefs.has(ref)) {
      usedRefs.add(ref);
      return ref;
    }
  }

  throw new Error('无法为文档 Citation 投影生成唯一的引用 ref（发生异常碰撞）。');
}

function appendUnique(target: string[], values: readonly string[]): void {
  const seen = new Set(target);
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}

function createSafeMarkerIdentity(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 10);
}

/**
 * 从持久化 CitationNode 接纳一份可供文档阅读使用的引用事实。
 * 可见 `[1]` 从不参与身份恢复；无精确来源锚点的节点只产生显式诊断。
 */
export function admitDocumentCitations(contentJson: unknown): DocumentCitationProjection {
  return admitDocumentCitationNodeSnapshots(collectDocumentCitationNodeSnapshots(contentJson));
}

export function admitDocumentCitationNodeSnapshots(
  snapshots: readonly DocumentCitationNodeSnapshot[]
): DocumentCitationProjection {
  const parsed = snapshots.map((snapshot, index) =>
    parseCitation({ occurrence: index + 1, attrs: snapshot.attrs })
  );
  assertCitationIdConsistency(parsed);

  const ranged = parsed.filter(
    (citation): citation is RangedCitation =>
      citation.kind === 'knowledge_base' || citation.kind === 'web'
  );
  const { refBySourceKey: persistedRefs, usedRefs } = reservePersistedRefs(ranged);
  const assignedRefBySourceKey = new Map(persistedRefs);
  const sourceByKey = new Map<string, DocumentCitationSource>();
  const projectedTextByCitationId = new Map<string, string>();
  const diagnostics: DocumentCitationDiagnostic[] = [];

  for (const citation of parsed) {
    if (citation.kind === 'invalid') {
      const marker = citation.citationId
        ? `【invalid citation:${createSafeMarkerIdentity(citation.citationId)}】`
        : '【invalid citation:unknown】';
      if (citation.citationId) projectedTextByCitationId.set(citation.citationId, marker);
      diagnostics.push({
        code: 'invalid_citation',
        message: citation.reason,
        bodyToken: marker,
        ...(citation.citationId ? { citationId: citation.citationId } : {}),
      });
      continue;
    }

    if (citation.kind === 'manual') {
      projectedTextByCitationId.set(
        citation.citationId,
        `【manual citation:${createSafeMarkerIdentity(citation.citationId)}】`
      );
      if (!sourceByKey.has(`manual:${citation.citationId}`)) {
        const bodyToken = `【manual citation:${createSafeMarkerIdentity(citation.citationId)}】`;
        sourceByKey.set(`manual:${citation.citationId}`, {
          sourceType: 'manual',
          firstOccurrence: citation.occurrence,
          citationIds: [citation.citationId],
          bodyToken,
          citationId: citation.citationId,
          sourceId: citation.sourceId,
          title: citation.title,
          excerpts: citation.excerpts,
        });
        diagnostics.push({
          code: 'manual_source',
          citationId: citation.citationId,
          bodyToken,
          message: `Manual citation ${createSafeMarkerIdentity(citation.citationId)} 没有可注册的 RAG ref。`,
        });
      }
      continue;
    }

    let ref = assignedRefBySourceKey.get(citation.sourceKey);
    if (!ref) {
      ref = createDocumentCitationRef(citation.sourceKey, usedRefs);
      assignedRefBySourceKey.set(citation.sourceKey, ref);
    }
    projectedTextByCitationId.set(citation.citationId, `[@${ref}]`);

    const existing = sourceByKey.get(citation.sourceKey);
    if (existing) {
      if (existing.sourceType === 'manual') {
        throw new Error('Citation 来源类型与来源键发生内部合同冲突。');
      }
      const citationIds = [...existing.citationIds];
      appendUnique(citationIds, [citation.citationId]);
      const excerpts = [...existing.excerpts];
      appendUnique(excerpts, citation.excerpts);
      sourceByKey.set(citation.sourceKey, { ...existing, citationIds, excerpts });
      continue;
    }

    if (citation.kind === 'knowledge_base') {
      sourceByKey.set(citation.sourceKey, {
        sourceType: 'knowledge_base',
        firstOccurrence: citation.occurrence,
        citationIds: [citation.citationId],
        bodyToken: `[@${ref}]`,
        ref,
        docId: citation.docId,
        blockId: citation.blockId,
        ...(citation.kbId ? { kbId: citation.kbId } : {}),
        title: citation.title,
        excerpts: citation.excerpts,
      });
    } else {
      sourceByKey.set(citation.sourceKey, {
        sourceType: 'web',
        firstOccurrence: citation.occurrence,
        citationIds: [citation.citationId],
        bodyToken: `[@${ref}]`,
        ref,
        url: citation.url,
        title: citation.title,
        excerpts: citation.excerpts,
        authors: citation.authors,
        ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
        ...(citation.containerTitle ? { containerTitle: citation.containerTitle } : {}),
      });
    }
  }

  const sources = [...sourceByKey.values()].sort(
    (left, right) => left.firstOccurrence - right.firstOccurrence
  );
  for (const source of sources) {
    if (source.excerpts.length > 0 || source.sourceType === 'manual') continue;
    diagnostics.push({
      code: 'excerpt_unavailable',
      ref: source.ref,
      bodyToken: source.bodyToken,
      message: `Citation [@${source.ref}] 没有持久化的来源摘录。`,
    });
  }

  return {
    sources,
    diagnostics,
    getBodyTokenForCitationId(citationId: string): string {
      return (
        projectedTextByCitationId.get(citationId) ??
        `【invalid citation:${createSafeMarkerIdentity(citationId)}】`
      );
    },
  };
}
