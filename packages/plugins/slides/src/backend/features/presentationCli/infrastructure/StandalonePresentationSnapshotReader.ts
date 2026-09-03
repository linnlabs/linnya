import type { Database } from 'better-sqlite3';
import type { PresentationDocumentRecord } from '../../../persistence/definitions/presentationRepository.js';
import {
  mapPresentationDocumentRow,
  readPresentationDocumentRow,
} from '../../../persistence/functions/presentationDocumentRecordCodec.js';

export interface StandalonePresentationSnapshot {
  readonly document: PresentationDocumentRecord;
  readonly projectId: string | null;
  readonly hasCurrentDraft: boolean;
  readonly currentDraft: {
    readonly lastErrorKind: string | null;
  } | null;
}

/** standalone CLI 的单查询只读投影，不装配 mutation repository 或 workspace service。 */
export class StandalonePresentationSnapshotReader {
  constructor(private readonly db: Database) {}

  read(nodeId: string): StandalonePresentationSnapshot | null {
    const value = this.db
      .prepare(
        `
      SELECT p.node_id, p.current_revision_id, p.current_revision,
             p.deck_source, p.source_hash, p.deck_spec_json, p.pptx_buffer,
             p.title, p.slide_count, p.layout, p.created_at, p.updated_at, p.author_id,
             w.project_id,
             d.node_id AS draft_node_id,
             d.last_error_kind AS draft_last_error_kind
      FROM presentation_documents p
      LEFT JOIN workspace_nodes w
        ON w.id = p.node_id AND w.deleted_at IS NULL
      LEFT JOIN presentation_drafts d
        ON d.node_id = p.node_id
       AND d.base_revision_id = p.current_revision_id
       AND d.base_revision = p.current_revision
      WHERE p.node_id = ?
    `
      )
      .get(nodeId);
    if (value === undefined) {
      return null;
    }
    if (
      !isRecord(value) ||
      !isNullableString(value.project_id) ||
      !isNullableString(value.draft_node_id) ||
      !isNullableString(value.draft_last_error_kind)
    ) {
      throw new Error(`Presentation workspace projection is invalid: ${nodeId}`);
    }
    const currentDraft = value.draft_node_id
      ? { lastErrorKind: value.draft_last_error_kind }
      : null;
    return {
      document: mapPresentationDocumentRow(readPresentationDocumentRow(value)),
      projectId: value.project_id,
      hasCurrentDraft: currentDraft !== null,
      currentDraft,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
