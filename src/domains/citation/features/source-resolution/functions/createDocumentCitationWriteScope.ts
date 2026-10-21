import type { CitationSource } from '../definitions/citationSource';
import type {
  DocumentCitationWriteScope,
  DocumentCitationWriteScopeParams,
} from '../definitions/documentCitationWriteScope';
import { isCanonicalCitationRef } from '../../reference/functions/citationRef';
import {
  createCitationRefCandidate,
  MAX_CITATION_REF_COLLISION_ATTEMPTS,
} from '../../reference/functions/createCitationRefCandidate';
import { createCitationSourceIdentity } from '../../../shared/functions/citationSourceAnchor';

function requireCanonicalRef(ref: string): void {
  if (!isCanonicalCitationRef(ref)) {
    throw new Error(`Document citation ref ${JSON.stringify(ref)} 不符合 canonical 合同。`);
  }
}

/**
 * 文档 ref 与 Conversation ref 是两个作用域：只在本次写入中建立双向来源映射。
 * 已有来源保留文档原 ref 和完整快照；新增来源避让基线、pending 与本次已经分配的 ref。
 */
export function createDocumentCitationWriteScope(
  params: DocumentCitationWriteScopeParams,
): DocumentCitationWriteScope {
  if (params.existingSources.length !== params.conversationRefs.length) {
    throw new Error('Document citation sources 与 Conversation refs 必须逐项对齐。');
  }

  const existingByAlias = new Map<string, CitationSource>();
  const sourceByIdentity = new Map<string, CitationSource>();
  const reservedSourceByIdentity = new Map<string, CitationSource>();
  const identityByDocumentRef = new Map<string, string>();
  const usedDocumentRefs = new Set<string>();
  for (const ref of params.reservedRefs) {
    requireCanonicalRef(ref);
    usedDocumentRefs.add(ref);
  }

  params.existingSources.forEach((source, index) => {
    const alias = params.conversationRefs[index];
    if (alias === undefined) throw new Error('Document citation 缺少已分配的 Conversation ref。');
    requireCanonicalRef(source.ref);
    requireCanonicalRef(alias);
    const identity = createCitationSourceIdentity(source);
    const documentOwner = identityByDocumentRef.get(source.ref);
    if (documentOwner !== undefined && documentOwner !== identity) {
      throw new Error(`Document citation ref ${source.ref} 对应了不同来源锚点。`);
    }
    const existingSource = sourceByIdentity.get(identity);
    if (existingSource && existingSource.ref !== source.ref) {
      throw new Error('Document citation 同一来源保存了不同 ref。');
    }
    const aliasOwner = existingByAlias.get(alias);
    if (aliasOwner && createCitationSourceIdentity(aliasOwner) !== identity) {
      throw new Error(`Conversation citation ref ${alias} 对应了不同来源锚点。`);
    }
    // 相同来源重复出现时保留第一份完整快照，不用后来的字段补成一个新版本。
    const snapshot = existingSource ?? source;
    sourceByIdentity.set(identity, snapshot);
    identityByDocumentRef.set(source.ref, identity);
    if (!aliasOwner) existingByAlias.set(alias, { ...snapshot, ref: alias });
    usedDocumentRefs.add(source.ref);
  });

  // baseline 与 preview 是不同文档版本，分开接纳。不能把相同 ref 的跨版本变化当成冲突，
  // 也不能合并二者的字段；当前 preview 的归属始终优先。
  const baselineIdentityByRef = new Map<string, string>();
  for (const source of params.reservedSources) {
    requireCanonicalRef(source.ref);
    const identity = createCitationSourceIdentity(source);
    const baselineOwner = baselineIdentityByRef.get(source.ref);
    if (baselineOwner !== undefined && baselineOwner !== identity) {
      throw new Error(`Baseline citation ref ${source.ref} 对应了不同来源锚点。`);
    }
    const existing = reservedSourceByIdentity.get(identity);
    if (existing && existing.ref !== source.ref) {
      throw new Error('Baseline citation 同一来源保存了不同 ref。');
    }
    if (!existing) reservedSourceByIdentity.set(identity, source);
    baselineIdentityByRef.set(source.ref, identity);
    usedDocumentRefs.add(source.ref);
  }

  return {
    resolveExistingAlias(ref) {
      return existingByAlias.get(ref);
    },
    assignDocumentSource(source) {
      requireCanonicalRef(source.ref);
      const identity = createCitationSourceIdentity(source);
      const existing = sourceByIdentity.get(identity);
      if (existing) return existing;

      const reserved = reservedSourceByIdentity.get(identity);
      const currentOwner = reserved ? identityByDocumentRef.get(reserved.ref) : undefined;
      if (reserved && (currentOwner === undefined || currentOwner === identity)) {
        // 恢复隐藏来源时复用已持久化整份快照，才能真正抵消 pending，而不是制造新别名或新版本。
        sourceByIdentity.set(identity, reserved);
        identityByDocumentRef.set(reserved.ref, identity);
        return reserved;
      }

      let ref = source.ref;
      if (usedDocumentRefs.has(ref)) {
        let availableRef: string | undefined;
        for (let attempt = 0; attempt < MAX_CITATION_REF_COLLISION_ATTEMPTS; attempt += 1) {
          const candidate = createCitationRefCandidate(identity, attempt);
          if (!usedDocumentRefs.has(candidate)) {
            availableRef = candidate;
            break;
          }
        }
        if (!availableRef) throw new Error('无法为文档分配唯一的 6 位 Citation ref（发生异常碰撞）。');
        ref = availableRef;
      }

      const assigned = ref === source.ref ? source : { ...source, ref };
      sourceByIdentity.set(identity, assigned);
      identityByDocumentRef.set(ref, identity);
      usedDocumentRefs.add(ref);
      return assigned;
    },
  };
}
