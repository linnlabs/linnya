import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { PresentationViewSourceRecord } from '../definitions/presentationRepository';
import { mapPresentationRenderSourceRow, readPresentationRenderSourceRow } from './presentationDocumentRecordCodec';

export function readPresentationViewSource(db: Database, nodeId: string): PresentationViewSourceRecord | null {
    // 单条关联查询同时捕获 current 与其有效 draft，之后构建不再回读 latest。
    const row: unknown = db.prepare(`
      SELECT p.node_id, p.current_revision_id, p.current_revision, p.source_hash,
             p.deck_source, p.deck_spec_json, p.title,
             d.source_hash AS draft_source_hash, d.updated_at AS draft_updated_at,
             d.last_error_summary, d.last_error_kind
      FROM presentation_documents p LEFT JOIN presentation_drafts d
        ON d.node_id = p.node_id AND d.base_revision_id = p.current_revision_id
        AND d.base_revision = p.current_revision
      WHERE p.node_id = ?
    `).get(nodeId);
    if (row === undefined) return null;
    const source = mapPresentationRenderSourceRow(readPresentationRenderSourceRow(row));
    const state = z.object({ source_hash: z.string(), draft_source_hash: z.string().nullable(),
      draft_updated_at: z.number().nullable(), last_error_summary: z.string().nullable(),
      last_error_kind: z.string().nullable() }).parse(row);
    const base = { presentationId: nodeId, versionId: source.currentRevisionId,
      versionNumber: source.currentRevision, sourceHash: state.source_hash };
    if (state.draft_source_hash !== null) {
      if (state.draft_updated_at === null) throw new Error('Slides draft timestamp is missing');
      return { ...source, draftSourceHash: state.draft_source_hash,
        buildState: { ...base, state: 'draft', draftStatus: {
          baseVersionId: source.currentRevisionId, baseVersionNumber: source.currentRevision,
          updatedAt: state.draft_updated_at,
          ...(state.last_error_summary !== null ? { errorSummary: state.last_error_summary } : {}),
          ...(state.last_error_kind !== null ? { errorKind: state.last_error_kind } : {}),
        } } };
    }
    return { ...source, buildState: { ...base, state: 'ready' } };
}
