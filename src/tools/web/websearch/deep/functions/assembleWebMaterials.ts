import { boundWebSourceNotes } from './boundWebSourceNotes';
import {
  ShallowWebSearchResultSchema,
  WebReadResultSchema,
  DeepWebMaterialsSchema,
  type AssembleWebSourcesArgs,
  type DeepWebMaterials,
  type WebSearchCitation,
} from '@app/schemas';
import type { WebEvidenceWriter } from '../../../shared/ports/webEvidenceWriter';
import type { WebEvidenceCaptureItem } from '../../../shared/definitions/webEvidenceCapture';
import type {
  WebSearchAcquisition,
  WebSearchSnapshotReader,
} from '../ports/webSearchSnapshotReader';

type Capture = {
  citation: WebSearchCitation;
  bundleId: string;
  callId: string;
  capturedAtMs: number;
  kind: 'search_snippet' | 'page_content' | 'metadata_only' | 'file_download';
  truncated: boolean;
  warnings: string[];
};

/** 仅接纳本 child 的正式结果；ref 相同也不能跨读取版本拼接正文。 */
export async function assembleWebMaterials(input: {
  selection: AssembleWebSourcesArgs;
  acquisitions: readonly WebSearchAcquisition[];
  reader: WebSearchSnapshotReader;
  topK: number;
  writer: WebEvidenceWriter;
  query: string;
}): Promise<DeepWebMaterials> {
  const { selection, truncated: notesTruncated } = boundWebSourceNotes(input.selection);
  const captures = new Map<string, Capture>();
  const failures: DeepWebMaterials['failures'] = [];
  const evidenceItems: WebEvidenceCaptureItem[] = [];
  let searchCount = 0;
  let readCount = 0;
  let candidateCount = 0;
  for (const event of input.acquisitions) {
    if (event.toolName === 'search_web') searchCount++;
    else readCount++;
    if (event.status !== 'success') {
      failures.push({
        tool: event.toolName,
        call_id: event.callId,
        error: event.observation.slice(0, 1000),
      });
      continue;
    }
    if (event.toolName === 'search_web') {
      const result = ShallowWebSearchResultSchema.parse({
        data: event.data,
        observation: event.observation,
      });
      candidateCount += result.data.resultCount;
      for (const citation of result.data.citations.citations) {
        captures.set(citation.ref, {
          citation,
          bundleId: result.data.evidence_store.bundle_id,
          callId: event.callId,
          capturedAtMs: event.timestamp,
          kind: 'search_snippet',
          truncated: false,
          warnings: [],
        });
      }
    } else {
      const result = WebReadResultSchema.parse({
        data: event.data,
        observation: event.observation,
      });
      const citation = result.data.citations.citations[0];
      // WebRead 可有 author，搜索公共引用不扩大字段；结构化采集限制另保留。
      const searchCitation: WebSearchCitation = {
        sourceType: 'web',
        ref: citation.ref,
        index: citation.index,
        url: citation.url,
        docTitle: citation.docTitle,
        snippet: citation.snippet,
        ...(citation.siteName ? { siteName: citation.siteName } : {}),
        ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
      };
      captures.set(citation.ref, {
        citation: searchCitation,
        bundleId: result.data.evidence_store.bundle_id,
        callId: event.callId,
        capturedAtMs: event.timestamp,
        kind: result.data.file ? 'file_download' : result.data.charCount === 0 ? 'metadata_only' : 'page_content',
        truncated: result.data.truncated,
        warnings: result.data.warnings ?? [],
      });
    }
  }
  if (searchCount === 0) throw new Error('Search before assembling sources.');
  if (candidateCount > 0 && readCount === 0)
    throw new Error(
      'Read promising sources with web_read before assembly; search snippets alone are insufficient.'
    );
  if (selection.selected.length > input.topK)
    throw new Error(`Select at most ${input.topK} sources.`);
  const sources: DeepWebMaterials['sources'] = [];
  const refs = new Set<string>();
  for (const selected of selection.selected) {
    if (refs.has(selected.ref)) throw new Error(`Duplicate selected ref: ${selected.ref}`);
    refs.add(selected.ref);
    const capture = captures.get(selected.ref);
    if (!capture) throw new Error(`Ref ${selected.ref} was not acquired in this child run.`);
    const snapshot =
      capture.kind === 'metadata_only' ||
      (capture.kind === 'search_snippet' && capture.citation.snippet.length === 0)
        ? {
            text: '',
            url: capture.citation.url,
            captureKind:
              capture.kind === 'search_snippet'
                ? ('web_search_result' as const)
                : ('web_page' as const),
          }
        : await input.reader.read(capture.bundleId, selected.ref);
    if (
      snapshot.url !== capture.citation.url ||
      snapshot.captureKind !==
        (capture.kind === 'search_snippet' ? 'web_search_result' : capture.kind === 'file_download' ? 'web_file' : 'web_page')
    )
      throw new Error('Captured source identity mismatch.');
    // 短摘要由真实快照自动截取，模型只提交 ref 与资料用途，不重新输出大段原文。
    const snippet = snapshot.text.slice(0, 800);
    sources.push({
      citation: { ...capture.citation, snippet },
      source_call_id: capture.callId,
      bundle_id: capture.bundleId,
      capture_kind: capture.kind,
      truncated: capture.truncated,
      warnings: capture.warnings,
      purpose: selected.purpose,
    });
    evidenceItems.push({
      ref: selected.ref,
      title: capture.citation.docTitle,
      snippet,
      contentText: snapshot.text,
      capturedAtMs: capture.capturedAtMs,
      url: snapshot.url,
      canonicalUrl: snapshot.url,
      ...(capture.citation.siteName ? { siteName: capture.citation.siteName } : {}),
      ...(capture.citation.publishedAt ? { publishedAt: capture.citation.publishedAt } : {}),
      captureKind: snapshot.captureKind,
    });
  }
  if (sources.length === 0 && selection.gaps.length === 0)
    throw new Error('An empty selection must explain the gap.');
  const saved = await input.writer.save({ query: input.query, items: evidenceItems });
  return DeepWebMaterialsSchema.parse({
    evidence_store: { bundle_id: saved.bundleId },
    summary: selection.summary,
    ...(notesTruncated ? { notes_truncated: true } : {}),
    sources,
    gaps: selection.gaps,
    conflicts: selection.conflicts,
    failures,
    search_count: searchCount,
    read_attempt_count: readCount,
  });
}
