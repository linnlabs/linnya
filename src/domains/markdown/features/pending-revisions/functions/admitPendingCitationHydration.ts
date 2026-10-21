import type {
  CitationLinkHydrationData,
  CitationNodeHydrationData,
} from '../../normalization/runtime';
import type { PendingRevisionMetadata } from '../definitions/pendingRevision';
import { isRecord } from './pendingRevisionApplyRules';

/**
 * 读取和接受 Pending 必须使用同一份持久化来源准入规则。
 * 这里仅接纳已经保存的 metadata，不查询会话、补齐字段或重新取得来源。
 */
export function extractPendingCitationHydration(
  metadata: PendingRevisionMetadata | null,
  blockId: string
): Record<string, CitationNodeHydrationData> | null {
  const raw = metadata?.citation_hydration;
  if (!isRecord(raw)) return null;

  const hydration: Record<string, CitationNodeHydrationData> = {};
  const invalidRefs: string[] = [];

  for (const [ref, value] of Object.entries(raw)) {
    if (isCitationHydrationData(value)) {
      hydration[ref] = value;
    } else {
      invalidRefs.push(ref);
    }
  }

  if (invalidRefs.length > 0) {
    throw new Error(
      `[PendingRevisionApplyService] citation_hydration 存在非法条目: blockId=${blockId}, refs=${invalidRefs.join(',')}`
    );
  }

  return Object.keys(hydration).length > 0 ? hydration : null;
}

export function extractPendingCitationLinkHydration(
  metadata: PendingRevisionMetadata | null,
  blockId: string
): Record<string, CitationLinkHydrationData> | null {
  const raw = metadata?.citation_link_hydration;
  if (!isRecord(raw)) return null;

  const hydration: Record<string, CitationLinkHydrationData> = {};
  const invalidUrls: string[] = [];
  for (const [url, value] of Object.entries(raw)) {
    if (isCitationLinkHydrationData(value)) hydration[url] = value;
    else invalidUrls.push(url);
  }

  if (invalidUrls.length > 0) {
    throw new Error(
      `[PendingRevisionApplyService] citation_link_hydration 存在非法条目: blockId=${blockId}, urls=${invalidUrls.join(',')}`
    );
  }
  return Object.keys(hydration).length > 0 ? hydration : null;
}

function isCitationHydrationData(value: unknown): value is CitationNodeHydrationData {
  if (!isRecord(value)) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.snippet !== 'string') return false;
  if (value.docId !== undefined && typeof value.docId !== 'string') return false;
  if (value.blockId !== undefined && typeof value.blockId !== 'string') return false;
  if (value.kbId !== undefined && typeof value.kbId !== 'string') return false;
  if (
    value.sourceType !== undefined &&
    value.sourceType !== 'knowledge_base' &&
    value.sourceType !== 'web' &&
    value.sourceType !== 'manual'
  ) {
    return false;
  }
  if (value.url !== undefined && typeof value.url !== 'string') return false;
  if (value.date !== undefined && typeof value.date !== 'string') return false;
  if (value.containerTitle !== undefined && typeof value.containerTitle !== 'string') return false;
  if (
    value.authors !== undefined &&
    (!Array.isArray(value.authors) || value.authors.some(author => typeof author !== 'string'))
  ) {
    return false;
  }
  return true;
}

function isCitationLinkHydrationData(value: unknown): value is CitationLinkHydrationData {
  if (!isRecord(value) || typeof value.ref !== 'string' || value.ref.trim().length === 0) {
    return false;
  }
  return isCitationHydrationData(value.data);
}
