import { normalizeCitationRef } from '../../../../citation';
import type {
  KnowledgeEvidenceCaptureKind,
  WebEvidenceCaptureKind,
} from '../../../definitions/evidence';
import type {
  EvidenceBundleScanEntry,
  CompleteEvidenceCandidate,
} from '../definitions/evidenceResolution';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(record: UnknownRecord, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : '';
}

function parseKnowledgeEvidenceCandidate(raw: UnknownRecord): EvidenceBundleScanEntry | undefined {
  const ref = normalizeCitationRef(readTrimmedString(raw, 'ref_id'));
  if (!ref) return undefined;

  const docId = readTrimmedString(raw, 'doc_id');
  if (!docId) return { status: 'incomplete', ref, reason: 'missing_doc_id' };

  const blockId = readTrimmedString(raw, 'block_id');
  if (!blockId) return { status: 'incomplete', ref, reason: 'missing_block_id' };

  const contentText = typeof raw['content_text'] === 'string' ? raw['content_text'] : '';
  if (!contentText) return { status: 'incomplete', ref, reason: 'missing_content_text' };

  const captureKindRaw = readTrimmedString(raw, 'capture_kind');
  const captureKind: KnowledgeEvidenceCaptureKind =
    captureKindRaw === 'knowledge_search_result' || captureKindRaw === 'knowledge_document_preview'
      ? captureKindRaw
      : 'knowledge_document_chunk';
  const docName = readTrimmedString(raw, 'doc_name') || undefined;
  const candidate: CompleteEvidenceCandidate = {
    ref,
    source_type: 'knowledge_base',
    title: readTrimmedString(raw, 'title') || docName || docId,
    snippet:
      typeof raw['snippet'] === 'string' && raw['snippet'].length > 0
        ? raw['snippet']
        : contentText,
    content_text: contentText,
    capture_kind: captureKind,
    doc_id: docId,
    block_id: blockId,
    ...(docName ? { doc_name: docName } : {}),
  };
  return { status: 'complete', item: candidate };
}

function parseWebEvidenceCandidate(raw: UnknownRecord): EvidenceBundleScanEntry | undefined {
  const ref = normalizeCitationRef(readTrimmedString(raw, 'ref_id'));
  if (!ref) return undefined;

  const url = readTrimmedString(raw, 'normalized_url') || readTrimmedString(raw, 'url');
  if (!url) return { status: 'incomplete', ref, reason: 'missing_url' };

  const contentText = typeof raw['content_text'] === 'string' ? raw['content_text'] : '';
  if (!contentText) return { status: 'incomplete', ref, reason: 'missing_content_text' };

  const captureKindRaw = readTrimmedString(raw, 'capture_kind');
  const captureKind: WebEvidenceCaptureKind =
    captureKindRaw === 'web_page' ? 'web_page' : 'web_search_result';
  const siteName = readTrimmedString(raw, 'site_name') || undefined;
  const publishedAt = readTrimmedString(raw, 'published_at') || undefined;
  const candidate: CompleteEvidenceCandidate = {
    ref,
    source_type: 'web',
    title: readTrimmedString(raw, 'title') || url,
    snippet:
      typeof raw['snippet'] === 'string' && raw['snippet'].length > 0
        ? raw['snippet']
        : contentText,
    content_text: contentText,
    url,
    ...(siteName ? { site_name: siteName } : {}),
    ...(publishedAt ? { published_at: publishedAt } : {}),
    capture_kind: captureKind,
  };
  return { status: 'complete', item: candidate };
}

/**
 * 接纳 live 与历史 Evidence bundle wire。
 * 历史 assemble_evidence 没有 capture_kind，按完整 Knowledge block 处理。
 */
export function parseEvidenceBundleItems(bundle: unknown): readonly EvidenceBundleScanEntry[] {
  if (!isRecord(bundle) || bundle['version'] !== 1) return [];
  const kind = bundle['kind'];
  if (kind !== 'assemble_evidence' && kind !== 'knowledge_evidence' && kind !== 'web_evidence') {
    return [];
  }
  const items = bundle['items'];
  if (!Array.isArray(items)) return [];

  const entries: EvidenceBundleScanEntry[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const entry =
      kind === 'web_evidence'
        ? parseWebEvidenceCandidate(raw)
        : parseKnowledgeEvidenceCandidate(raw);
    if (entry) entries.push(entry);
  }
  return entries;
}
