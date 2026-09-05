import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { SLIDES_PLUGIN_ID } from '@plugin/slides/shared/pluginMeta';
import type {
  DeckSpec,
  TemplateSpec,
  TemplateSummary,
} from '@plugin/slides/shared';
import { createSlideLayoutKey } from '@plugin/slides/shared';
import { saveWorkspaceNodeTextSnapshot } from '@plugin/backend/workspaceRuntime';
import type { PluginWorkspaceDocumentUpdatedPayload } from '@plugin/backend/workspaceRuntime';
import {
  buildPresentationSourceRevision,
  hashPresentationSource,
  normalizePresentationSource,
  PresentationSourceConsistencyError,
  reconstructPresentationSource,
  type PresentationStoredSourceRevision,
} from '../../features/presentationSourceHistory/index.js';
import {
  PresentationStaleBaseError,
  type PresentationCommitOptions,
  type PresentationCommitResult,
  type PresentationCreateOptions,
  type PresentationDocumentRecord,
  type PresentationRepositoryPort,
  type PresentationRevisionOrigin,
  type PresentationRevisionRecord,
  type PresentationTemplateRecord,
} from '../definitions/presentationRepository.js';
import {
  mapPresentationDocumentRow,
  normalizeDeckSpecOrThrow as normalizeStoredDeckSpecOrThrow,
  readPresentationDocumentRow,
  type StoredPresentationDocumentRow,
} from '../functions/presentationDocumentRecordCodec.js';

interface SourceRevisionRow {
  readonly id: string;
  readonly parent_revision_id: string | null;
  readonly revision: number;
  readonly base_source_hash: string | null;
  readonly source_hash: string;
  readonly storage_kind: 'checkpoint' | 'patch';
  readonly source_checkpoint: string | null;
  readonly source_patch: string | null;
  readonly patch_bytes: number;
}

interface RevisionRow extends Omit<SourceRevisionRow, 'source_checkpoint' | 'source_patch'> {
  readonly node_id: string;
  readonly created_at: number;
  readonly author_id: string | null;
  readonly origin: PresentationRevisionOrigin;
}

interface TemplateRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly template_spec_json: string;
  readonly source_pptx_buffer: Buffer;
  readonly created_at: number;
  readonly updated_at: number;
  readonly usage_count: number;
}

interface TemplateSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly usage_count: number;
  readonly created_at: number;
}

interface WorkspaceProjectRow {
  readonly project_id: string | null;
}

export interface PresentationRepositoryOptions {
  /** 同一提交事务中记录本次物化实际使用的资产，失败事务不会留下 revision 引用。 */
  readonly recordRevisionContext?: (nodeId: string, revisionId: string) => void;
  readonly requestHistoryMaintenance?: (nodeId: string) => void;
  readonly publishDocumentUpdated?: (payload: PluginWorkspaceDocumentUpdatedPayload) => void;
}

export class PresentationRepository implements PresentationRepositoryPort {
  constructor(
    private readonly db: Database,
    private readonly options: PresentationRepositoryOptions = {},
  ) {}

  async createPresentation(
    nodeId: string,
    deckSpec: DeckSpec,
    options: PresentationCreateOptions,
  ): Promise<PresentationCommitResult> {
    const normalizedDeckSpec = this.normalizeDeckSpecOrThrow(deckSpec);
    const normalizedSource = normalizePresentationSource(options.deckSource);
    const revisionId = uuidv4();
    const now = Date.now();
    const sourceRevision = buildPresentationSourceRevision({
      revision: 1,
      source: normalizedSource,
      parentSource: null,
      accumulatedPatchBytes: 0,
    });

    const createTx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO presentation_documents (
          node_id, current_revision_id, current_revision,
          deck_source, source_hash, deck_spec_json, pptx_buffer,
          title, slide_count, layout, created_at, updated_at, author_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nodeId,
        revisionId,
        normalizedSource,
        sourceRevision.sourceHash,
        JSON.stringify(normalizedDeckSpec),
        options.pptxBuffer,
        normalizedDeckSpec.title,
        normalizedDeckSpec.slides.length,
        createSlideLayoutKey(normalizedDeckSpec.layout),
        now,
        now,
        options.authorId ?? null,
      );
      this.insertRevision({
        revisionId,
        nodeId,
        revision: 1,
        parentRevisionId: null,
        sourceRevision,
        createdAt: now,
        authorId: options.authorId,
        origin: options.origin,
      });
      this.commitWorkspaceProjection(nodeId, normalizedSource, now);
      this.options.recordRevisionContext?.(nodeId, revisionId);
    });
    createTx.immediate();
    this.enqueueDocumentUpdated(nodeId, 1);
    this.options.requestHistoryMaintenance?.(nodeId);

    return { revisionId, revision: 1 };
  }

  async discardCreatedPresentation(nodeId: string): Promise<void> {
    this.db.transaction(() => {
      // presentation_documents 是 Slides 聚合根；revision/draft 由外键级联清理。
      this.db.prepare('DELETE FROM presentation_documents WHERE node_id = ?').run(nodeId);
    }).immediate();
  }

  async commitPresentation(
    nodeId: string,
    deckSpec: DeckSpec,
    options: PresentationCommitOptions,
  ): Promise<PresentationCommitResult> {
    const normalizedDeckSpec = this.normalizeDeckSpecOrThrow(deckSpec);
    const normalizedSource = normalizePresentationSource(options.deckSource);
    const revisionId = uuidv4();
    const now = Date.now();

    const commitTx = this.db.transaction((): number => {
      const current = this.readDocumentRow(nodeId);
      if (
        !current
        || current.current_revision_id !== options.baseRevisionId
        || current.current_revision !== options.baseRevision
      ) {
        throw new PresentationStaleBaseError(
          nodeId,
          options.baseRevisionId,
          options.baseRevision,
          current?.current_revision_id ?? null,
          current?.current_revision ?? null,
        );
      }

      const actualCurrentHash = hashPresentationSource(current.deck_source);
      if (actualCurrentHash !== current.source_hash) {
        throw new PresentationSourceConsistencyError(
          `Slides current document ${nodeId} 的 source hash 不一致。`,
        );
      }

      const nextRevision = current.current_revision + 1;
      const sourceRevision = buildPresentationSourceRevision({
        revision: nextRevision,
        source: normalizedSource,
        parentSource: current.deck_source,
        accumulatedPatchBytes: this.readAccumulatedPatchBytes(nodeId),
      });
      this.insertRevision({
        revisionId,
        nodeId,
        revision: nextRevision,
        parentRevisionId: current.current_revision_id,
        sourceRevision,
        createdAt: now,
        authorId: options.authorId,
        origin: options.origin,
      });

      const update = this.db.prepare(`
        UPDATE presentation_documents
        SET current_revision_id = ?,
            current_revision = ?,
            deck_source = ?,
            source_hash = ?,
            deck_spec_json = ?,
            pptx_buffer = ?,
            title = ?,
            slide_count = ?,
            layout = ?,
            updated_at = ?,
            author_id = ?
        WHERE node_id = ?
          AND current_revision_id = ?
          AND current_revision = ?
      `).run(
        revisionId,
        nextRevision,
        normalizedSource,
        sourceRevision.sourceHash,
        JSON.stringify(normalizedDeckSpec),
        options.pptxBuffer,
        normalizedDeckSpec.title,
        normalizedDeckSpec.slides.length,
        createSlideLayoutKey(normalizedDeckSpec.layout),
        now,
        options.authorId ?? null,
        nodeId,
        options.baseRevisionId,
        options.baseRevision,
      );
      if (update.changes !== 1) {
        throw new PresentationStaleBaseError(
          nodeId,
          options.baseRevisionId,
          options.baseRevision,
          current.current_revision_id,
          current.current_revision,
        );
      }

      this.commitWorkspaceProjection(nodeId, normalizedSource, now);
      this.options.recordRevisionContext?.(nodeId, revisionId);
      // 成功恢复和普通提交都替代当前草稿，不能让旧失败状态遮住新文稿。
      this.db.prepare('DELETE FROM presentation_drafts WHERE node_id = ?').run(nodeId);
      return nextRevision;
    });

    const revision = commitTx.immediate();
    this.enqueueDocumentUpdated(nodeId, revision);
    this.options.requestHistoryMaintenance?.(nodeId);
    return { revisionId, revision };
  }

  async getPresentation(nodeId: string): Promise<PresentationDocumentRecord | null> {
    const row = this.readDocumentRow(nodeId);
    if (!row) {
      return null;
    }
    return mapPresentationDocumentRow(row);
  }

  async getRevisionSource(nodeId: string, revision: number): Promise<string | null> {
    const target = this.readRevisionIdentity(nodeId, revision);
    if (!target) {
      return null;
    }

    const checkpoint = this.readCheckpointAtOrBefore(nodeId, revision);
    if (!checkpoint) {
      throw new PresentationSourceConsistencyError(
        `Slides ${nodeId} revision ${revision} 之前没有 checkpoint。`,
      );
    }

    const rows = this.db.prepare(`
      SELECT id, parent_revision_id, revision, base_source_hash, source_hash, storage_kind,
             source_checkpoint, source_patch, patch_bytes
      FROM presentation_revisions
      WHERE node_id = ? AND revision BETWEEN ? AND ?
      ORDER BY revision ASC
    `).all(nodeId, checkpoint.revision, revision);
    const revisions = rows.map((row) => readSourceRevisionRow(row, nodeId));
    const source = reconstructPresentationSource(revisions);
    if (hashPresentationSource(source) !== target.source_hash) {
      throw new PresentationSourceConsistencyError(
        `Slides ${nodeId} revision ${revision} 的目标 source hash 不一致。`,
      );
    }
    return source;
  }

  async listRevisions(nodeId: string): Promise<PresentationRevisionRecord[]> {
    const rows = this.db.prepare(`
      SELECT id, node_id, revision, parent_revision_id, base_source_hash, source_hash,
             storage_kind, patch_bytes,
             created_at, author_id, origin
      FROM presentation_revisions
      WHERE node_id = ?
      ORDER BY revision DESC
    `).all(nodeId);
    return rows.map((row) => mapRevisionRow(readRevisionRow(row, nodeId)));
  }

  async saveTemplate(template: TemplateSpec, sourcePptxBuffer: Buffer): Promise<string> {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO presentation_templates
        (id, name, description, template_spec_json, source_pptx_buffer, created_at, updated_at, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      template.id,
      template.name,
      template.description ?? null,
      JSON.stringify(template),
      sourcePptxBuffer,
      now,
      now,
    );
    return template.id;
  }

  async getTemplate(templateId: string): Promise<PresentationTemplateRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM presentation_templates WHERE id = ?',
    ).get(templateId);
    return row === undefined ? null : this.mapTemplateRow(readTemplateRow(row));
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    const rows = this.db.prepare(
      'SELECT id, name, description, usage_count, created_at FROM presentation_templates ORDER BY created_at DESC',
    ).all();
    return rows.map((row) => {
      const summary = readTemplateSummaryRow(row);
      return {
        id: summary.id,
        name: summary.name,
        description: summary.description ?? undefined,
        usageCount: summary.usage_count,
        createdAt: summary.created_at,
      };
    });
  }

  async incrementTemplateUsage(templateId: string): Promise<void> {
    this.db.prepare(
      'UPDATE presentation_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?',
    ).run(Date.now(), templateId);
  }

  private insertRevision(input: {
    readonly revisionId: string;
    readonly nodeId: string;
    readonly revision: number;
    readonly parentRevisionId: string | null;
    readonly sourceRevision: ReturnType<typeof buildPresentationSourceRevision>;
    readonly createdAt: number;
    readonly authorId?: string;
    readonly origin: PresentationRevisionOrigin;
  }): void {
    this.db.prepare(`
      INSERT INTO presentation_revisions (
        id, node_id, revision, parent_revision_id,
        base_source_hash, source_hash, storage_kind,
        source_checkpoint, source_patch, patch_bytes,
        created_at, author_id, origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.revisionId,
      input.nodeId,
      input.revision,
      input.parentRevisionId,
      input.sourceRevision.baseSourceHash,
      input.sourceRevision.sourceHash,
      input.sourceRevision.storageKind,
      input.sourceRevision.sourceCheckpoint,
      input.sourceRevision.sourcePatch,
      input.sourceRevision.patchBytes,
      input.createdAt,
      input.authorId ?? null,
      input.origin,
    );
  }

  private readDocumentRow(nodeId: string): StoredPresentationDocumentRow | null {
    const row = this.db.prepare(`
      SELECT node_id, current_revision_id, current_revision,
             deck_source, source_hash, deck_spec_json, pptx_buffer,
             title, slide_count, layout, created_at, updated_at, author_id
      FROM presentation_documents
      WHERE node_id = ?
    `).get(nodeId);
    return row === undefined ? null : readPresentationDocumentRow(row);
  }

  private readRevisionIdentity(
    nodeId: string,
    revision: number,
  ): { readonly source_hash: string } | null {
    const row = this.db.prepare(`
      SELECT source_hash
      FROM presentation_revisions
      WHERE node_id = ? AND revision = ?
    `).get(nodeId, revision);
    if (row === undefined) {
      return null;
    }
    if (!isRecord(row) || typeof row.source_hash !== 'string') {
      throw new PresentationSourceConsistencyError('Slides revision identity 行结构非法。');
    }
    return { source_hash: row.source_hash };
  }

  private readCheckpointAtOrBefore(
    nodeId: string,
    revision: number,
  ): { readonly revision: number } | null {
    const row = this.db.prepare(`
      SELECT revision
      FROM presentation_revisions
      WHERE node_id = ? AND revision <= ? AND storage_kind = 'checkpoint'
      ORDER BY revision DESC
      LIMIT 1
    `).get(nodeId, revision);
    if (row === undefined) {
      return null;
    }
    if (!isRecord(row) || !isFiniteInteger(row.revision)) {
      throw new PresentationSourceConsistencyError('Slides checkpoint 行结构非法。');
    }
    return { revision: row.revision };
  }

  private readAccumulatedPatchBytes(nodeId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(patch_bytes), 0) AS patch_bytes
      FROM presentation_revisions
      WHERE node_id = ?
        AND revision > COALESCE((
          SELECT MAX(revision)
          FROM presentation_revisions
          WHERE node_id = ? AND storage_kind = 'checkpoint'
        ), 0)
    `).get(nodeId, nodeId);
    if (!isRecord(row) || !isFiniteInteger(row.patch_bytes) || row.patch_bytes < 0) {
      throw new PresentationSourceConsistencyError('Slides 累计 patch 大小行结构非法。');
    }
    return row.patch_bytes;
  }

  private commitWorkspaceProjection(nodeId: string, deckSource: string, updatedAt: number): void {
    const result = this.db.prepare(`
      UPDATE workspace_nodes
      SET updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(updatedAt, nodeId);
    if (result.changes !== 1) {
      throw new Error(`Presentation workspace node not found: ${nodeId}`);
    }

    // 快照与 current/revision 同事务提交，插件禁用后的 VFS 读取不会落后于当前文稿。
    saveWorkspaceNodeTextSnapshot({
      db: this.db,
      nodeId,
      contentType: 'text/plain',
      text: deckSource,
      sourcePluginId: SLIDES_PLUGIN_ID,
      sourceNodeType: 'presentation',
      updatedAt,
    });
  }

  private enqueueDocumentUpdated(nodeId: string, revision: number): void {
    const publishDocumentUpdated = this.options.publishDocumentUpdated;
    if (!publishDocumentUpdated) {
      return;
    }
    setTimeout(() => {
      const current = this.readDocumentRow(nodeId);
      if (!current || current.current_revision < revision) {
        return;
      }
      const workspaceRow = this.readWorkspaceProjectRow(nodeId);
      if (!workspaceRow) {
        return;
      }
      publishDocumentUpdated({
        projectId: workspaceRow.project_id,
        documentId: nodeId,
        nodeType: 'presentation',
        mutationKind: 'version',
        versionNumber: revision,
      });
    }, 0);
  }

  private readWorkspaceProjectRow(nodeId: string): WorkspaceProjectRow | null {
    const row = this.db.prepare(`
      SELECT project_id
      FROM workspace_nodes
      WHERE id = ? AND deleted_at IS NULL
    `).get(nodeId);
    if (row === undefined) {
      return null;
    }
    if (!isRecord(row) || (row.project_id !== null && typeof row.project_id !== 'string')) {
      throw new Error(`Presentation workspace project row is invalid: ${nodeId}`);
    }
    return { project_id: row.project_id };
  }

  private mapTemplateRow(row: TemplateRow): PresentationTemplateRecord {
    const parsed: unknown = JSON.parse(row.template_spec_json);
    if (!isTemplateSpec(parsed)) {
      throw new Error(`Stored Slides template spec is invalid: ${row.id}`);
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      spec: parsed,
      sourcePptxBuffer: row.source_pptx_buffer,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usageCount: row.usage_count,
    };
  }

  private normalizeDeckSpecOrThrow(deckSpec: DeckSpec): DeckSpec {
    return normalizeStoredDeckSpecOrThrow(deckSpec);
  }
}

function mapRevisionRow(row: RevisionRow): PresentationRevisionRecord {
  return {
    revisionId: row.id,
    nodeId: row.node_id,
    revision: row.revision,
    parentRevisionId: row.parent_revision_id,
    baseSourceHash: row.base_source_hash,
    sourceHash: row.source_hash,
    storageKind: row.storage_kind,
    patchBytes: row.patch_bytes,
    createdAt: row.created_at,
    authorId: row.author_id ?? undefined,
    origin: row.origin,
  };
}

function readSourceRevisionRow(value: unknown, nodeId: string): PresentationStoredSourceRevision {
  if (!isSourceRevisionRow(value)) {
    throw new PresentationSourceConsistencyError(`Slides ${nodeId} source revision 行结构非法。`);
  }
  return {
    revisionId: value.id,
    parentRevisionId: value.parent_revision_id,
    revision: value.revision,
    baseSourceHash: value.base_source_hash,
    sourceHash: value.source_hash,
    storageKind: value.storage_kind,
    sourceCheckpoint: value.source_checkpoint,
    sourcePatch: value.source_patch,
    patchBytes: value.patch_bytes,
  };
}

function readRevisionRow(value: unknown, nodeId: string): RevisionRow {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !isFiniteInteger(value.revision)
    || !isNullableString(value.base_source_hash)
    || typeof value.source_hash !== 'string'
    || (value.storage_kind !== 'checkpoint' && value.storage_kind !== 'patch')
    || !isFiniteInteger(value.patch_bytes)
    || typeof value.node_id !== 'string'
    || !isNullableString(value.parent_revision_id)
    || !isFiniteInteger(value.created_at)
    || !isNullableString(value.author_id)
    || !isPresentationRevisionOrigin(value.origin)
  ) {
    throw new PresentationSourceConsistencyError(`Slides ${nodeId} revision metadata 行结构非法。`);
  }
  return {
    id: value.id,
    node_id: value.node_id,
    revision: value.revision,
    parent_revision_id: value.parent_revision_id,
    base_source_hash: value.base_source_hash,
    source_hash: value.source_hash,
    storage_kind: value.storage_kind,
    patch_bytes: value.patch_bytes,
    created_at: value.created_at,
    author_id: value.author_id,
    origin: value.origin,
  };
}

function isSourceRevisionRow(value: unknown): value is SourceRevisionRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && isNullableString(value.parent_revision_id)
    && isFiniteInteger(value.revision)
    && isNullableString(value.base_source_hash)
    && typeof value.source_hash === 'string'
    && (value.storage_kind === 'checkpoint' || value.storage_kind === 'patch')
    && isNullableString(value.source_checkpoint)
    && isNullableString(value.source_patch)
    && isFiniteInteger(value.patch_bytes);
}

function readTemplateRow(value: unknown): TemplateRow {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !isNullableString(value.description)
    || typeof value.template_spec_json !== 'string'
    || !Buffer.isBuffer(value.source_pptx_buffer)
    || !isFiniteInteger(value.created_at)
    || !isFiniteInteger(value.updated_at)
    || !isFiniteInteger(value.usage_count)
  ) {
    throw new Error('Stored Slides template row is invalid.');
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    template_spec_json: value.template_spec_json,
    source_pptx_buffer: value.source_pptx_buffer,
    created_at: value.created_at,
    updated_at: value.updated_at,
    usage_count: value.usage_count,
  };
}

function readTemplateSummaryRow(value: unknown): TemplateSummaryRow {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !isNullableString(value.description)
    || !isFiniteInteger(value.usage_count)
    || !isFiniteInteger(value.created_at)
  ) {
    throw new Error('Stored Slides template summary row is invalid.');
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    usage_count: value.usage_count,
    created_at: value.created_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isTemplateSpec(value: unknown): value is TemplateSpec {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string';
}

function isPresentationRevisionOrigin(value: unknown): value is PresentationRevisionOrigin {
  return value === 'create'
    || value === 'codegen'
    || value === 'edit'
    || value === 'relayout'
    || value === 'repair'
    || value === 'restore';
}
