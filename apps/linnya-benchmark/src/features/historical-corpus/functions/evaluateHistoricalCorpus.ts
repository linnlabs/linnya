import { createHash } from 'node:crypto';
import type {
  CorpusIssue,
  HistoricalCandidate,
  HistoricalCorpusDocument,
  HistoricalCorpusManifest,
} from '../definitions/historicalCorpus';

export type LoadedCorpusFile = { readonly bytes: Uint8Array } | { readonly error: string };
export type LoadedCorpusFiles = Readonly<
  Record<'original' | 'projection' | 'evidence', LoadedCorpusFile>
>;
export interface LoadedHistoricalCandidate {
  readonly source: HistoricalCandidate;
  readonly files?: LoadedCorpusFiles;
}

export function hashCorpusBytes(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function evaluateHistoricalCorpus(
  manifest: HistoricalCorpusManifest,
  loaded: readonly LoadedHistoricalCandidate[]
): { documents: HistoricalCorpusDocument[]; issues: CorpusIssue[] } {
  const issues: CorpusIssue[] = [];
  const documents: HistoricalCorpusDocument[] = [];
  const categories = new Set<string>();
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const { source, files } of loaded) {
    const url = new URL(source.url).href;
    if (ids.has(source.id) || urls.has(url)) {
      issues.push({
        sourceId: source.id,
        code: 'duplicate_identity',
        detail: 'Source id or URL occurs more than once',
      });
      continue;
    }
    ids.add(source.id);
    urls.add(url);
    if (source.status === 'pending') {
      issues.push({ sourceId: source.id, code: 'pending_version', detail: source.reason });
      continue;
    }
    if (Date.parse(source.availableAt) >= Date.parse(manifest.cutoffExclusive)) {
      issues.push({ sourceId: source.id, code: 'not_before_cutoff', detail: source.availableAt });
      continue;
    }
    if (!files) throw new Error('Verified candidate was not loaded');
    const expected = {
      original: source.original,
      projection: source.projection,
      evidence: source.verification.evidence,
    };
    let valid = true;
    for (const name of ['original', 'projection', 'evidence'] as const) {
      const file = files[name];
      if ('error' in file) {
        issues.push({
          sourceId: source.id,
          code: 'invalid_file',
          detail: `${name}: ${file.error}`,
        });
        valid = false;
      } else if (file.bytes.byteLength === 0) {
        issues.push({ sourceId: source.id, code: 'invalid_file', detail: `${name}: Empty file` });
        valid = false;
      } else if (hashCorpusBytes(file.bytes) !== expected[name].sha256) {
        issues.push({ sourceId: source.id, code: 'hash_mismatch', detail: name });
        valid = false;
      }
    }
    if (!valid || !('bytes' in files.projection)) continue;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(files.projection.bytes);
      if (!text.trim()) throw new Error('Projection is empty');
    } catch {
      issues.push({
        sourceId: source.id,
        code: 'invalid_projection',
        detail: 'Expected nonempty UTF-8 text',
      });
      continue;
    }
    // 仅显式投影作者需要的字段，证明与核查记录不能随对象展开混进检索语料。
    documents.push({
      id: source.id,
      url,
      title: source.title,
      availableAt: source.availableAt,
      originalSha256: source.original.sha256,
      projectionSha256: source.projection.sha256,
      text,
    });
    source.categories.forEach(category => categories.add(category));
  }
  for (const category of manifest.requiredCategories) {
    if (!categories.has(category)) issues.push({ code: 'missing_category', detail: category });
  }
  return { documents, issues };
}
