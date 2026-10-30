import { isRecord } from '@plugin/slides/shared/valueRecord';
import { readWorkspaceDocumentMetadata } from '@plugin/backend/workspaceDocumentProjection';
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

/** standalone CLI 的只读快照；文稿/草稿与 Host 归属事实共用读事务。 */
export class StandalonePresentationSnapshotReader {
  constructor(private readonly db: Database) {}

  read(nodeId: string): StandalonePresentationSnapshot | null {
    return this.db.transaction(() => this.readSnapshot(nodeId))();
  }

  private readSnapshot(nodeId: string): StandalonePresentationSnapshot | null {
    const value = this.db
      .prepare(
        `
      SELECT p.node_id, p.current_revision_id, p.current_revision,
             p.deck_source, p.source_hash, p.deck_spec_json, p.pptx_buffer,
             p.pptx_revision_id,
             p.title, p.slide_count, p.layout, p.created_at, p.updated_at, p.author_id,
             d.node_id AS draft_node_id,
             d.last_error_kind AS draft_last_error_kind
      FROM presentation_documents p
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
      projectId: readWorkspaceDocumentMetadata(this.db, nodeId)?.projectId ?? null,
      hasCurrentDraft: currentDraft !== null,
      currentDraft,
    };
  }
}


function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
