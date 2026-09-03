import type Database from 'better-sqlite3';
import type { RuntimeEvent, RuntimeResourceRef } from 'linnkit/contracts';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';

interface AssetRow {
  readonly id: string;
  readonly uri: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly width_px: number | null;
  readonly height_px: number | null;
  readonly sha256: string | null;
  readonly storage_status: string;
  readonly local_path: string | null;
}

type AttachmentSource = 'user_input' | 'tool_output';

function readAttachments(event: RuntimeEvent): {
  readonly source: AttachmentSource;
  readonly attachments: readonly RuntimeResourceRef[];
} | null {
  if (event.type === 'user_input' || event.type === 'tool_output') {
    return {
      source: event.type,
      attachments: event.attachments ?? [],
    };
  }
  return null;
}

function assertCommitMatchesAttachment(
  commit: WorkspaceAssetCommitRecord,
  attachment: RuntimeResourceRef,
): void {
  if (
    commit.assetId !== attachment.resourceId
    || commit.mediaType !== attachment.mediaType
    || commit.byteLength !== attachment.byteLength
    || commit.width !== attachment.width
    || commit.height !== attachment.height
    || commit.sha256 !== attachment.sha256
  ) {
    throw new Error(
      `[SQLiteEventAssetLinks] asset commit does not match attachment ${attachment.id}`,
    );
  }
}

function assertAssetMatchesAttachment(row: AssetRow, attachment: RuntimeResourceRef): void {
  if (
    row.storage_status !== 'local'
    || row.media_type !== attachment.mediaType
    || row.size_bytes !== attachment.byteLength
    || row.width_px !== attachment.width
    || row.height_px !== attachment.height
    || row.sha256 !== attachment.sha256
    || !row.local_path
  ) {
    throw new Error(
      `[SQLiteEventAssetLinks] asset ${row.id} does not match attachment ${attachment.id}`,
    );
  }
}

function assertExistingAssetCompatible(row: AssetRow, commit: WorkspaceAssetCommitRecord): void {
  const conflicts = row.uri !== commit.uri
    || (row.media_type !== null && row.media_type !== commit.mediaType)
    || (row.size_bytes !== null && row.size_bytes !== commit.byteLength)
    || (row.width_px !== null && row.width_px !== commit.width)
    || (row.height_px !== null && row.height_px !== commit.height)
    || (row.sha256 !== null && row.sha256 !== commit.sha256);
  if (conflicts) {
    throw new Error(`[SQLiteEventAssetLinks] asset commit conflicts with existing asset ${row.id}`);
  }
}

export class SqliteEventAssetLinks {
  constructor(private readonly db: Database.Database) {}

  persistForEvent(params: {
    readonly conversationId: string;
    readonly event: RuntimeEvent;
    readonly assetCommits: readonly WorkspaceAssetCommitRecord[];
  }): void {
    const eventAttachments = readAttachments(params.event);
    if (!eventAttachments) {
      if (params.assetCommits.length > 0) {
        throw new Error('[SQLiteEventAssetLinks] asset commits require user_input or tool_output');
      }
      return;
    }

    const commits = new Map<string, WorkspaceAssetCommitRecord>();
    for (const commit of params.assetCommits) {
      if (commits.has(commit.assetId)) {
        throw new Error(`[SQLiteEventAssetLinks] duplicate asset commit ${commit.assetId}`);
      }
      commits.set(commit.assetId, commit);
    }
    const referencedAssetIds = new Set(eventAttachments.attachments.map(item => item.resourceId));
    for (const assetId of commits.keys()) {
      if (!referencedAssetIds.has(assetId)) {
        throw new Error(`[SQLiteEventAssetLinks] unused asset commit ${assetId}`);
      }
    }

    const conversationRow = this.db.prepare<unknown[], { conversation_id: string }>(`
      SELECT conversation_id
      FROM conversations
      WHERE conversation_id = ?
    `).get(params.conversationId);
    if (!conversationRow) {
      throw new Error(`[SQLiteEventAssetLinks] conversation ${params.conversationId} does not exist`);
    }

    for (const [ordinal, attachment] of eventAttachments.attachments.entries()) {
      const commit = commits.get(attachment.resourceId);
      if (commit) {
        assertCommitMatchesAttachment(commit, attachment);
      }
      const asset = this.ensureAsset(attachment, commit);
      assertAssetMatchesAttachment(asset, attachment);

      this.db.prepare(`
        INSERT INTO conversation_event_asset_links (
          conversation_id, event_id, attachment_id, ordinal, asset_id, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.conversationId,
        params.event.id,
        attachment.id,
        ordinal,
        asset.id,
        eventAttachments.source,
        params.event.timestamp,
      );

    }
  }

  deleteForRuns(runIds: readonly string[]): void {
    if (runIds.length === 0) return;
    const placeholders = runIds.map(() => '?').join(',');
    this.db.prepare(`
      DELETE FROM conversation_event_asset_links
      WHERE event_id IN (
        SELECT id FROM events WHERE run_id IN (${placeholders})
      )
    `).run(...runIds);
  }

  deleteForConversation(conversationId: string): void {
    this.db.prepare(
      'DELETE FROM conversation_event_asset_links WHERE conversation_id = ?',
    ).run(conversationId);
  }

  deleteForConversationsWithoutProject(): void {
    this.db.prepare(`
      DELETE FROM conversation_event_asset_links
      WHERE conversation_id IN (
        SELECT conversation_id FROM conversations WHERE project_id IS NULL
      )
    `).run();
  }

  private ensureAsset(
    attachment: RuntimeResourceRef,
    commit: WorkspaceAssetCommitRecord | undefined,
  ): AssetRow {
    let row = this.readAssetById(attachment.resourceId);
    if (!row) {
      if (!commit) {
        throw new Error(
          `[SQLiteEventAssetLinks] asset ${attachment.resourceId} is missing and has no commit record`,
        );
      }
      const uriOwner = this.db.prepare<[string], { id: string }>(
        'SELECT id FROM assets WHERE uri = ?',
      ).get(commit.uri);
      if (uriOwner) {
        throw new Error(
          `[SQLiteEventAssetLinks] URI ${commit.uri} belongs to canonical asset ${uriOwner.id}`,
        );
      }
      this.db.prepare(`
        INSERT INTO assets (
          id, uri, media_type, size_bytes, width_px, height_px, sha256,
          storage_status, local_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)
      `).run(
        commit.assetId,
        commit.uri,
        commit.mediaType,
        commit.byteLength,
        commit.width,
        commit.height,
        commit.sha256,
        commit.localPath,
        commit.createdAt,
      );
      row = this.readAssetById(commit.assetId);
    } else if (commit) {
      assertExistingAssetCompatible(row, commit);
      this.db.prepare(`
        UPDATE assets
        SET media_type = COALESCE(media_type, ?),
            size_bytes = COALESCE(size_bytes, ?),
            width_px = COALESCE(width_px, ?),
            height_px = COALESCE(height_px, ?),
            sha256 = COALESCE(sha256, ?),
            -- 同一内容身份可以迁到新的受管 store；commit 已由 host 从相同 bytes
            -- 重算全部媒体事实，不能让历史物理路径成为第二身份源。
            local_path = ?
        WHERE id = ?
      `).run(
        commit.mediaType,
        commit.byteLength,
        commit.width,
        commit.height,
        commit.sha256,
        commit.localPath,
        commit.assetId,
      );
      row = this.readAssetById(commit.assetId);
    }

    if (!row) {
      throw new Error(`[SQLiteEventAssetLinks] failed to register asset ${attachment.resourceId}`);
    }
    return row;
  }

  private readAssetById(assetId: string): AssetRow | undefined {
    return this.db.prepare<[string], AssetRow>(`
      SELECT id, uri, media_type, size_bytes, width_px, height_px, sha256,
             storage_status, local_path
      FROM assets
      WHERE id = ?
    `).get(assetId);
  }
}
