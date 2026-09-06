import type Database from 'better-sqlite3';
import { DocumentVersionListSchema, type DocumentVersionSummary } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import type { DeckSpec } from '@plugin/slides/shared';
import type { PresentationSourceCompactionPlan, PresentationStoredSourceRevision } from '../definitions/presentationSourceRevision';
import type { PresentationRevisionAsset } from '../orchestration/PresentationRevisionScope';

export interface PresentationHistorySnapshot {
  readonly versions: readonly DocumentVersionSummary[];
  readonly sources: readonly PresentationStoredSourceRevision[];
  readonly draftKey: string | null;
  readonly draftBaseId: string | null;
}

/** Slides 自己拥有重链事务和可达性；Host 不认识这些表。 */
export class PresentationHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  list(nodeId: string): DocumentVersionSummary[] {
    const rows = this.db.prepare<[string], Omit<DocumentVersionSummary, 'isCurrent' | 'restoredFrom'> & {
      isCurrent: number; restoredFromId: string | null; restoredFromTime: number | null;
    }>(`
      SELECT r.id AS versionId, r.revision AS "order", r.created_at AS createdAt,
             r.id = d.current_revision_id AS isCurrent,
             r.restored_from_version_id AS restoredFromId, r.restored_from_created_at AS restoredFromTime
      FROM presentation_revisions r JOIN presentation_documents d ON d.node_id = r.node_id
      WHERE r.node_id = ? ORDER BY r.revision DESC
    `).all(nodeId);
    return DocumentVersionListSchema.parse(rows.map(({ restoredFromId, restoredFromTime, ...row }) => ({
      ...row, isCurrent: row.isCurrent === 1,
      ...(restoredFromId === null ? {} : {
        restoredFrom: { versionId: restoredFromId, createdAt: restoredFromTime },
      }),
    })));
  }

  snapshot(nodeId: string): PresentationHistorySnapshot {
    return this.db.transaction(() => {
      const versions = this.list(nodeId);
      const sources = this.db.prepare<[string], PresentationStoredSourceRevision>(`
        SELECT id AS revisionId, revision, parent_revision_id AS parentRevisionId,
          base_source_hash AS baseSourceHash, source_hash AS sourceHash, storage_kind AS storageKind,
          source_checkpoint AS sourceCheckpoint, source_patch AS sourcePatch, patch_bytes AS patchBytes
        FROM presentation_revisions WHERE node_id = ? ORDER BY revision
      `).all(nodeId);
      const draft = this.db.prepare<[string], { base: string; hash: string }>(
        'SELECT base_revision_id AS base, source_hash AS hash FROM presentation_drafts WHERE node_id = ?',
      ).get(nodeId);
      return { versions, sources, draftBaseId: draft?.base ?? null, draftKey: draft ? `${draft.base}:${draft.hash}` : null };
    })();
  }

  readContext(versionId: string): { themeJson: string } | undefined {
    return this.db.prepare<[string], { themeJson: string }>(
      'SELECT theme_json AS themeJson FROM presentation_revision_contexts WHERE revision_id = ?',
    ).get(versionId);
  }

  recordContext(versionId: string, sourceTheme: DeckSpec['theme'], assets: readonly PresentationRevisionAsset[]): void {
    this.db.prepare('INSERT INTO presentation_revision_contexts(revision_id, theme_json) VALUES (?, ?)')
      .run(versionId, JSON.stringify(sourceTheme ?? null));
    const insert = this.db.prepare('INSERT INTO presentation_revision_assets(revision_id, asset_id, asset_kind) VALUES (?, ?, ?)');
    for (const asset of assets) insert.run(versionId, asset.assetId, asset.kind);
  }

  compact(nodeId: string, snapshot: PresentationHistorySnapshot, plan: PresentationSourceCompactionPlan, backfill: ReadonlyMap<string, { sourceTheme: DeckSpec['theme']; assets: readonly PresentationRevisionAsset[] }>): void {
    this.db.transaction(() => {
      const current = this.snapshot(nodeId);
      if (current.draftKey !== snapshot.draftKey || current.versions.length !== snapshot.versions.length
        || current.versions.some((version, index) => version.versionId !== snapshot.versions[index]?.versionId)) {
        throw new DocumentHistoryError('version_conflict');
      }
      for (const [id, value] of backfill) this.recordContext(id, value.sourceTheme, value.assets);
      // 先重链所有幸存者，再按从新到旧删除，满足 parent 外键。
      const update = this.db.prepare(`UPDATE presentation_revisions SET parent_revision_id = ?, base_source_hash = ?,
        storage_kind = ?, source_checkpoint = ?, source_patch = ?, patch_bytes = ? WHERE node_id = ? AND id = ?`);
      for (const row of plan.retained) update.run(row.parentRevisionId, row.baseSourceHash, row.storageKind, row.sourceCheckpoint, row.sourcePatch, row.patchBytes, nodeId, row.revisionId);
      const remove = this.db.prepare('DELETE FROM presentation_revisions WHERE node_id = ? AND id = ?');
      for (const id of [...plan.removedRevisionIds].reverse()) remove.run(nodeId, id);

      // 失败草稿尚没有成功版本的资产清单，不能据此判定其图片已经不可达。
      if (snapshot.draftBaseId) return;
      // 上次释放失败后，后续版本可能重新引用同一资产；先撤销过期释放计划。
      this.db.prepare(`DELETE FROM presentation_asset_releases WHERE node_id = ? AND EXISTS (
        SELECT 1 FROM presentation_revision_assets a JOIN presentation_revisions r ON r.id = a.revision_id
        WHERE r.node_id = presentation_asset_releases.node_id AND a.asset_id = presentation_asset_releases.asset_id
      )`).run(nodeId);

      // binding 是 source identity 的缓存，不是额外的永久引用；历史引用才决定其生命周期。
      for (const table of ['presentation_image_bindings', 'presentation_svg_graphic_bindings'] as const) {
        this.db.prepare(`INSERT OR IGNORE INTO presentation_asset_releases(node_id, asset_id)
          SELECT presentation_id, asset_id FROM ${table} b WHERE presentation_id = ? AND NOT EXISTS (
            SELECT 1 FROM presentation_revision_assets a JOIN presentation_revisions r ON r.id = a.revision_id
            WHERE r.node_id = b.presentation_id AND a.asset_id = b.asset_id
          )`).run(nodeId);
        this.db.prepare(`DELETE FROM ${table} WHERE presentation_id = ? AND asset_id IN (
          SELECT asset_id FROM presentation_asset_releases WHERE node_id = ?
        )`).run(nodeId, nodeId);
      }
    }).immediate();
  }

  releasePending(nodeId: string, release: (assetIds: readonly string[]) => void): void {
    this.db.transaction(() => {
      if (this.snapshot(nodeId).draftBaseId) return;
      const pending = this.db.prepare<[string], { assetId: string }>(
        'SELECT asset_id AS assetId FROM presentation_asset_releases WHERE node_id = ?',
      ).all(nodeId);
      const referenced = this.db.prepare<[string, string], { found: number }>(`SELECT 1 AS found
        FROM presentation_revision_assets a JOIN presentation_revisions r ON r.id = a.revision_id
        WHERE r.node_id = ? AND a.asset_id = ? LIMIT 1`);
      const releasable = pending.filter(row => !referenced.get(nodeId, row.assetId));
      release(releasable.map(row => row.assetId));
      this.db.prepare('DELETE FROM presentation_asset_releases WHERE node_id = ?').run(nodeId);
    }).immediate();
  }
}
