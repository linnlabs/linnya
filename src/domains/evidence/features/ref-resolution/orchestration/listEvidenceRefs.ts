import type { EvidenceSourceType } from '../../../definitions/evidence';
import type { EvidenceBundleRepositoryPort } from '../../bundle-store/ports/evidenceBundleRepository';
import { parseEvidenceBundleItems } from '../functions/parseEvidenceBundleItems';

export type EvidenceRefListItem = {
  ref_id: string;
  source_type: EvidenceSourceType;
  title: string;
  doc_id?: string;
  block_id?: string;
  url?: string;
  occurrences: number;
};

export interface ListEvidenceRefsResult {
  total: number;
  refs: EvidenceRefListItem[];
}

/**
 * 列出指定 Evidence instance 中已物化的稳定 ref。
 *
 * 损坏或尚未完整写入的 bundle 不会伪造 ref；它们由按 ref 解析的
 * incomplete/conflict 合同负责呈现，列表视图只暴露已完整接纳的项。
 */
export interface ListEvidenceRefsParams {
  conversationId: string;
  instanceId: string;
  offset: number;
  limit: number;
}

export async function listEvidenceRefsWithRepository(
  params: ListEvidenceRefsParams,
  repository: EvidenceBundleRepositoryPort,
): Promise<ListEvidenceRefsResult> {
  const snapshots = await repository.listBundleSnapshots({
    conversationId: params.conversationId,
    preferredInstanceId: params.instanceId,
    scope: 'instance',
  });

  const byRef = new Map<string, EvidenceRefListItem>();
  for (const snapshot of snapshots) {
    if (snapshot.storageIdentity.kind === 'other_file' || snapshot.status === 'unreadable') continue;
    for (const entry of parseEvidenceBundleItems(snapshot.content)) {
      if (entry.status !== 'complete') continue;
      const item = entry.item;
      const existing = byRef.get(item.ref);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      byRef.set(item.ref, {
        ref_id: item.ref,
        source_type: item.source_type,
        title: item.title,
        ...(item.source_type === 'knowledge_base'
          ? { doc_id: item.doc_id, block_id: item.block_id }
          : { url: item.url }),
        occurrences: 1,
      });
    }
  }

  const allRefs = Array.from(byRef.values()).sort((a, b) => a.ref_id.localeCompare(b.ref_id));
  return {
    total: allRefs.length,
    refs: allRefs.slice(params.offset, params.offset + params.limit),
  };
}
