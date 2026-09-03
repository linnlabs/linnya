import { sliceTextByUnitsZhEn } from '../../../../../shared/utils/textUnits';
import type {
  CompleteEvidenceCandidate,
  ResolvedEvidenceItem,
} from '../definitions/evidenceResolution';

export function materializeResolvedEvidenceItem(params: {
  readonly candidate: CompleteEvidenceCandidate;
  readonly bundleId: string;
  readonly instanceId: string;
  readonly maxUnits: number;
  readonly maxChars: number;
  readonly includeFullTextWhenTruncated?: boolean;
}): ResolvedEvidenceItem {
  const { candidate } = params;
  let preview = '';
  let truncated = false;
  if (params.maxUnits > 0 || params.maxChars > 0) {
    const previewByUnits = sliceTextByUnitsZhEn(candidate.content_text, params.maxUnits);
    preview =
      previewByUnits.length > params.maxChars && params.maxChars > 0
        ? previewByUnits.slice(0, params.maxChars)
        : previewByUnits;
    truncated = preview.length !== candidate.content_text.length;
  }

  return {
    ref: candidate.ref,
    bundle_id: params.bundleId,
    instance_id: params.instanceId,
    source_type: candidate.source_type,
    title: candidate.title,
    snippet: candidate.snippet,
    ...(candidate.source_type === 'knowledge_base'
      ? {
          doc_id: candidate.doc_id,
          block_id: candidate.block_id,
          capture_kind: candidate.capture_kind,
          ...(candidate.doc_name ? { doc_name: candidate.doc_name } : {}),
        }
      : {
          url: candidate.url,
          ...(candidate.site_name ? { site_name: candidate.site_name } : {}),
          ...(candidate.published_at ? { published_at: candidate.published_at } : {}),
          capture_kind: candidate.capture_kind,
        }),
    text: preview,
    text_truncated: truncated,
    ...(truncated && params.includeFullTextWhenTruncated === true
      ? { text_full: candidate.content_text }
      : {}),
  };
}
