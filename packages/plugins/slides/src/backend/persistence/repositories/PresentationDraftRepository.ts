import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { saveWorkspaceNodeTextSnapshot } from '@plugin/backend/workspaceRuntime';
import { SLIDES_PLUGIN_ID } from '@plugin/slides/shared/pluginMeta';
import { PresentationDraftStaleBaseError } from '../definitions/presentationRepository';
import type {
  PresentationDraftErrorKind,
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationDocumentRecord,
} from '../definitions/presentationRepository';
import type { PresentationBuildFailureCode } from '../../features/presentationBuildFailure';

interface DraftRow {
  node_id: string;
  deck_source: string;
  source_hash: string;
  base_revision_id: string;
  base_revision: number;
  last_error_summary: string | null;
  last_error_kind: PresentationDraftErrorKind | null;
  created_at: number;
  updated_at: number;
}

interface CurrentRevisionRow {
  current_revision_id: string;
  current_revision: number;
}

export class PresentationDraftRepository implements PresentationDraftRepositoryPort {
  constructor(private readonly db: Database) {}

  upsert(
    nodeId: string,
    source: string,
    baseDocument: PresentationDocumentRecord,
    errorSummary: string,
    errorKind: PresentationBuildFailureCode
  ): PresentationDraftRecord {
    const normalizedSource = normalizeLineEndings(source);
    const sourceHash = hashSource(normalizedSource);
    const now = Date.now();

    return this.db.transaction(() => {
      this.assertBaseRevisionIsCurrent(nodeId, baseDocument);

      // `created_at` 保留第一份 draft 的时间；重复写错只刷新源码、错误和 updated_at。
      this.db
        .prepare(
          `
        INSERT INTO presentation_drafts (
          node_id,
          deck_source,
          source_hash,
          base_revision_id,
          base_revision,
          last_error_summary,
          last_error_kind,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          deck_source = excluded.deck_source,
          source_hash = excluded.source_hash,
          base_revision_id = excluded.base_revision_id,
          base_revision = excluded.base_revision,
          last_error_summary = excluded.last_error_summary,
          last_error_kind = excluded.last_error_kind,
          created_at = CASE
            WHEN presentation_drafts.base_revision_id = excluded.base_revision_id
             AND presentation_drafts.base_revision = excluded.base_revision
            THEN presentation_drafts.created_at
            ELSE excluded.created_at
          END,
          updated_at = excluded.updated_at
      `
        )
        .run(
          nodeId,
          normalizedSource,
          sourceHash,
          baseDocument.currentRevisionId,
          baseDocument.currentRevision,
          errorSummary,
          errorKind,
          now,
          now
        );

      // draft 是当前 VFS 正文，不只是编译器旁路状态；快照必须与 draft 同事务推进。
      saveWorkspaceNodeTextSnapshot({
        db: this.db,
        nodeId,
        contentType: 'text/plain',
        text: normalizedSource,
        sourcePluginId: SLIDES_PLUGIN_ID,
        sourceNodeType: 'presentation',
        updatedAt: now,
      });

      const draft = this.get(nodeId);
      if (!draft) {
        throw new Error(`Failed to read presentation draft after upsert: ${nodeId}`);
      }
      return draft;
    })();
  }

  get(nodeId: string): PresentationDraftRecord | null {
    const row = this.db
      .prepare(
        `
      SELECT d.*
      FROM presentation_drafts d
      INNER JOIN presentation_documents p
        ON p.node_id = d.node_id
       AND p.current_revision_id = d.base_revision_id
       AND p.current_revision = d.base_revision
      WHERE d.node_id = ?
    `
      )
      .get(nodeId) as DraftRow | undefined;

    return row ? mapDraftRow(row) : null;
  }

  has(nodeId: string): boolean {
    const row = this.db
      .prepare(
        `
      SELECT 1 AS found
      FROM presentation_drafts d
      INNER JOIN presentation_documents p
        ON p.node_id = d.node_id
       AND p.current_revision_id = d.base_revision_id
       AND p.current_revision = d.base_revision
      WHERE d.node_id = ?
      LIMIT 1
    `
      )
      .get(nodeId) as { found: number } | undefined;
    return row?.found === 1;
  }

  delete(nodeId: string): void {
    this.db.prepare('DELETE FROM presentation_drafts WHERE node_id = ?').run(nodeId);
  }

  private assertBaseRevisionIsCurrent(
    nodeId: string,
    baseDocument: PresentationDocumentRecord
  ): void {
    const current = this.db
      .prepare(
        `
      SELECT current_revision_id, current_revision
      FROM presentation_documents
      WHERE node_id = ?
    `
      )
      .get(nodeId) as CurrentRevisionRow | undefined;

    if (
      current?.current_revision_id !== baseDocument.currentRevisionId ||
      current.current_revision !== baseDocument.currentRevision
    ) {
      throw new PresentationDraftStaleBaseError(
        nodeId,
        baseDocument.currentRevisionId,
        baseDocument.currentRevision,
        current?.current_revision_id ?? null,
        current?.current_revision ?? null
      );
    }
  }
}

function mapDraftRow(row: DraftRow): PresentationDraftRecord {
  return {
    nodeId: row.node_id,
    deckSource: row.deck_source,
    sourceHash: row.source_hash,
    baseRevisionId: row.base_revision_id,
    baseRevision: row.base_revision,
    ...(row.last_error_summary !== null ? { lastErrorSummary: row.last_error_summary } : {}),
    ...(row.last_error_kind !== null ? { lastErrorKind: row.last_error_kind } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
