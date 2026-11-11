import { boundWebSourceNotes } from './boundWebSourceNotes';
import {
  DEEP_WEB_EXCERPT_CHARS,
  DEEP_WEB_MAX_EXCERPTS,
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
import { describeAcquiredRange } from './describeAcquiredRange';
import { locateSourceExcerpts, type SourceText } from './locateSourceExcerpts';

type WebReadData = ReturnType<typeof WebReadResultSchema.parse>['data'];

type ReadCapture = {
  bundleId: string;
  callId: string;
  capturedAtMs: number;
  data: WebReadData;
};

type Capture = {
  citation: WebSearchCitation;
  bundleId: string;
  callId: string;
  capturedAtMs: number;
  kind: 'search_snippet' | 'page_content' | 'metadata_only' | 'file_download';
  warnings: string[];
  /** 同一 ref 的全部成功读取（按发生顺序）；只有搜索摘要时为空。 */
  reads: ReadCapture[];
};

/** Evidence 冻结的交接正文上限（多次读取拼接）；与快照读取端口的单次上限一致。 */
const EVIDENCE_TEXT_MAX_CHARS = 100_000;
/**
 * 全部来源摘录的总预算。父 Agent 的工具输出预览为 20,000 字符，标题、URL、读取范围与用途另占约 500 字/源；
 * 默认 10 个来源时每段约 500 字，来源少时每段最多 600 字，来源很多时每段不少于 300 字（超出部分由 ToolOutputStore 续读）。
 */
const EXCERPT_TOTAL_BUDGET_CHARS = 10_000;
const EXCERPT_MIN_CHARS = 300;

export function excerptWidth(sourceCount: number): number {
  const perExcerpt = Math.floor(EXCERPT_TOTAL_BUDGET_CHARS / Math.max(1, sourceCount * DEEP_WEB_MAX_EXCERPTS));
  return Math.max(EXCERPT_MIN_CHARS, Math.min(DEEP_WEB_EXCERPT_CHARS, perExcerpt));
}
const FILE_TEXT_MARKER = '\nCaptured text:\n';

function captureKindOf(data: WebReadData): Capture['kind'] {
  return data.file && !data.pdf ? 'file_download' : data.charCount === 0 ? 'metadata_only' : 'page_content';
}

/** web_file 证据正文前面是文件身份说明，真正读到的页文字在标记之后。 */
function readableText(text: string, captureKind: 'web_search_result' | 'web_page' | 'web_file'): string {
  if (captureKind !== 'web_file') return text;
  const at = text.indexOf(FILE_TEXT_MARKER);
  return at < 0 ? '' : text.slice(at + FILE_TEXT_MARKER.length);
}

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
        // 已读过正文的来源不被之后的搜索摘要覆盖。
        if (captures.get(citation.ref)?.reads.length) continue;
        captures.set(citation.ref, {
          citation,
          bundleId: result.data.evidence_store.bundle_id,
          callId: event.callId,
          capturedAtMs: event.timestamp,
          kind: 'search_snippet',
          warnings: [],
          reads: [],
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
      const previous = captures.get(citation.ref);
      const read: ReadCapture = {
        bundleId: result.data.evidence_store.bundle_id,
        callId: event.callId,
        capturedAtMs: event.timestamp,
        data: result.data,
      };
      // 同一 URL 的 ref 稳定；最终 URL 变了（重定向到别处）就是另一份取得，不跨版本拼接。
      const reads = previous?.reads.length && previous.citation.url === searchCitation.url ? [...previous.reads, read] : [read];
      // 读到过正文就是已读来源；之后一次无命中的查找（charCount=0）不把它降为只有元数据。
      const kinds = reads.map(item => captureKindOf(item.data));
      captures.set(citation.ref, {
        citation: searchCitation,
        bundleId: read.bundleId,
        callId: read.callId,
        capturedAtMs: read.capturedAtMs,
        kind: kinds.includes('page_content') ? 'page_content' : captureKindOf(result.data),
        warnings: [...new Set(reads.flatMap(item => item.data.warnings ?? []))].slice(0, 8),
        reads,
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
    const texts: SourceText[] = [];
    const fullTexts: string[] = [];
    if (capture.reads.length === 0) {
      if (capture.citation.snippet.length > 0) {
        const snapshot = await input.reader.read(capture.bundleId, selected.ref);
        if (snapshot.url !== capture.citation.url || snapshot.captureKind !== 'web_search_result')
          throw new Error('Captured source identity mismatch.');
        texts.push({ text: snapshot.text, fragment: true });
        fullTexts.push(snapshot.text);
      }
    } else {
      for (const read of capture.reads) {
        const kind = captureKindOf(read.data);
        if (kind === 'metadata_only') continue;
        const snapshot = await input.reader.read(read.bundleId, selected.ref);
        if (
          snapshot.url !== capture.citation.url ||
          snapshot.captureKind !== (read.data.file ? 'web_file' : 'web_page')
        )
          throw new Error('Captured source identity mismatch.');
        const text = readableText(snapshot.text, snapshot.captureKind);
        texts.push({
          text,
          fragment: read.data.find !== undefined,
          fromStart: read.data.find === undefined && (read.data.window?.offset ?? read.data.pdf?.pages.from ?? 0) <= 1,
        });
        if (!fullTexts.includes(text)) fullTexts.push(text);
      }
    }
    // 交接原文由程序从实际读到的正文截取；模型只给定位短语，不重新输出原文。
    const located = locateSourceExcerpts({
      texts,
      anchors: selected.anchors ?? [],
      width: excerptWidth(selection.selected.length),
    });
    const snippet = located.excerpts
      .map(excerpt => (excerpt.page !== undefined ? `[Page ${excerpt.page}] ${excerpt.text}` : excerpt.text))
      .join('\n[…]\n');
    const range = describeAcquiredRange(capture.reads.map(read => read.data));
    sources.push({
      citation: { ...capture.citation, snippet },
      source_call_id: capture.callId,
      bundle_id: capture.bundleId,
      capture_kind: capture.kind,
      truncated: range.partial,
      warnings: capture.warnings,
      purpose: selected.purpose,
      excerpts: located.excerpts.map(excerpt => ({
        located: excerpt.located,
        ...(excerpt.anchor !== undefined ? { anchor: excerpt.anchor } : {}),
        ...(excerpt.page !== undefined ? { page: excerpt.page } : {}),
      })),
      ...(located.unmatchedAnchors.length ? { unmatched_anchors: [...located.unmatchedAnchors] } : {}),
      acquired_range: range.description,
    });
    const contentText = fullTexts.join('\n\n[…]\n\n').slice(0, EVIDENCE_TEXT_MAX_CHARS);
    evidenceItems.push({
      ref: selected.ref,
      title: capture.citation.docTitle,
      snippet,
      contentText,
      capturedAtMs: capture.capturedAtMs,
      url: capture.citation.url,
      canonicalUrl: capture.citation.url,
      ...(capture.citation.siteName ? { siteName: capture.citation.siteName } : {}),
      ...(capture.citation.publishedAt ? { publishedAt: capture.citation.publishedAt } : {}),
      captureKind: capture.reads.length === 0 ? 'web_search_result' : capture.reads.some(read => read.data.file) ? 'web_file' : 'web_page',
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
