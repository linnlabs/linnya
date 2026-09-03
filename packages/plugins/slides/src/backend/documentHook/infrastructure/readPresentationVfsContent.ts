import type {
  DocumentTypeBackendReadParams,
  DocumentTypeBackendReadResult,
} from '@plugin/backend/documentTypeBackendHook';

const PRESENTATION_STRUCTURE_VIEW_KIND = 'presentation_structure';

interface PresentationRow {
  readonly current_revision_id: string;
  readonly current_revision: number;
  readonly deck_source: string;
  readonly title: string;
  readonly slide_count: number;
}

interface PresentationDraftRow {
  readonly deck_source: string;
  readonly source_hash: string;
  readonly base_revision_id: string;
  readonly base_revision: number;
  readonly last_error_summary: string | null;
  readonly last_error_kind: string | null;
  readonly updated_at: number;
}

interface CurrentPresentationSource {
  readonly row: PresentationRow;
  readonly source: string;
  readonly sourceOrigin: 'compiled' | 'draft';
  readonly sourceKey: string;
  readonly draft: PresentationDraftRow | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPresentationRow(value: unknown): value is PresentationRow {
  return isRecord(value) &&
    typeof value.current_revision_id === 'string' &&
    typeof value.current_revision === 'number' &&
    typeof value.deck_source === 'string' &&
    typeof value.title === 'string' &&
    typeof value.slide_count === 'number';
}

function isPresentationDraftRow(value: unknown): value is PresentationDraftRow {
  return isRecord(value) &&
    typeof value.deck_source === 'string' &&
    typeof value.source_hash === 'string' &&
    typeof value.base_revision_id === 'string' &&
    typeof value.base_revision === 'number' &&
    isNullableString(value.last_error_summary) &&
    isNullableString(value.last_error_kind) &&
    typeof value.updated_at === 'number';
}

function readPresentationRow(
  db: DocumentTypeBackendReadParams['db'],
  nodeId: string,
): PresentationRow | null {
  const row = db.prepare(`
    SELECT current_revision_id, current_revision, deck_source, title, slide_count
    FROM presentation_documents
    WHERE node_id = ?
  `).get(nodeId);
  if (row === undefined) return null;
  if (!isPresentationRow(row)) {
    throw new Error(`Slides 版本记录结构异常：${nodeId}`);
  }
  return row;
}

function readPresentationDraftRow(
  db: DocumentTypeBackendReadParams['db'],
  nodeId: string,
  currentRevisionId: string,
  currentRevision: number,
): PresentationDraftRow | null {
  const row = db.prepare(`
    SELECT deck_source, source_hash, base_revision_id, base_revision, last_error_summary, last_error_kind, updated_at
    FROM presentation_drafts
    WHERE node_id = ?
      AND base_revision_id = ?
      AND base_revision = ?
    LIMIT 1
  `).get(nodeId, currentRevisionId, currentRevision);
  if (row == null) return null;
  if (!isPresentationDraftRow(row)) {
    throw new Error(`Slides 草稿记录结构异常：${nodeId}`);
  }
  return row;
}

function readCurrentPresentationSource(
  db: DocumentTypeBackendReadParams['db'],
  nodeId: string,
): CurrentPresentationSource | null {
  const row = readPresentationRow(db, nodeId);
  if (!row) return null;

  const draft = readPresentationDraftRow(
    db,
    nodeId,
    row.current_revision_id,
    row.current_revision,
  );
  if (draft) {
    return {
      row,
      source: draft.deck_source,
      sourceOrigin: 'draft',
      sourceKey: `draft:${draft.source_hash}`,
      draft,
    };
  }

  return {
    row,
    source: row.deck_source,
    sourceOrigin: 'compiled',
    sourceKey: `compiled:${row.current_revision_id}`,
    draft: null,
  };
}

function buildPresentationDraftStatus(draft: PresentationDraftRow): Record<string, unknown> {
  return {
    baseVersionId: draft.base_revision_id,
    baseVersionNumber: draft.base_revision,
    ...(draft.last_error_kind ? { errorKind: draft.last_error_kind } : {}),
    ...(draft.last_error_summary ? { errorSummary: draft.last_error_summary } : {}),
    updatedAt: draft.updated_at,
  };
}

function buildPresentationReadMetadata(current: CurrentPresentationSource): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    versionNumber: current.row.current_revision,
    versionId: current.row.current_revision_id,
    title: current.row.title,
    slideCount: current.row.slide_count,
    totalLines: splitSourceLines(current.source).length,
    sourceOrigin: current.sourceOrigin,
    sourceKey: current.sourceKey,
  };
  if (current.draft) {
    metadata.draftStatus = buildPresentationDraftStatus(current.draft);
  }
  return metadata;
}

function buildPresentationStructureMarkdown(params: {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly current: CurrentPresentationSource;
}): string {
  return [
    `# ${params.current.row.title || params.nodeName}`,
    '',
    `- node_id: ${params.nodeId}`,
    `- version: ${params.current.row.current_revision}`,
    `- slide_count: ${params.current.row.slide_count}`,
    '- source_available: yes',
    `- source_origin: ${params.current.sourceOrigin}`,
  ].join('\n');
}

function splitSourceLines(source: string): string[] {
  return source.length === 0 ? [''] : source.split('\n');
}

export function readPresentationVfsContent(
  params: DocumentTypeBackendReadParams,
): DocumentTypeBackendReadResult | null {
  // 默认 VFS 读取只投影已经持久化的源码事实。语法与结构属于显式派生能力，
  // 不能反过来阻断错误草稿的读取，否则 AI 将无法看到并修复编译错误。
  const current = readCurrentPresentationSource(params.db, params.nodeId);
  if (!current) return null;
  if (params.viewKind === PRESENTATION_STRUCTURE_VIEW_KIND) {
    return {
      contentType: 'text/markdown',
      text: buildPresentationStructureMarkdown({
        nodeId: params.nodeId,
        nodeName: params.nodeName,
        current,
      }),
      metadata: buildPresentationReadMetadata(current),
    };
  }
  return {
    contentType: 'text/plain',
    text: current.source,
    metadata: buildPresentationReadMetadata(current),
  };
}
