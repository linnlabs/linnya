import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryToolResultAssetClaimRegistry } from 'src/domains/assets/features/tool-result-claims';
import { createConversationAttachmentStoragePaths } from 'src/features/conversation/attachments/shared/storage-paths';
import { createWorkspaceVerifiedImageLoader } from '../../../shared/verified-image';
import type { ToolContext } from 'src/tools/types';
import { parseWorkspaceAssetUri } from '../functions/parseWorkspaceAssetUri';
import { createWorkspaceToolModelInputResolver } from '../orchestration/createWorkspaceToolModelInputResolver';

const roots: string[] = [];
const databases: Database.Database[] = [];
const STORE_ID = '25aa551d-d0d9-4aa8-b47a-279692fd2c88';

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-tool-model-input-'));
  roots.push(workspaceRoot);
  const contentRoot = createConversationAttachmentStoragePaths(workspaceRoot, STORE_ID).contentRoot;
  await fsp.mkdir(contentRoot, { recursive: true });

  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      media_type TEXT,
      size_bytes INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT,
      storage_status TEXT NOT NULL,
      local_path TEXT
    );
    CREATE TABLE project_asset_links (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      PRIMARY KEY (project_id, asset_id)
    );
    CREATE TABLE conversation_event_asset_links (
      conversation_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      asset_id TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, event_id, attachment_id)
    );
  `);

  const verifiedImageLoader = createWorkspaceVerifiedImageLoader({
    db,
    storageBoundaries: [{ boundaryRoot: workspaceRoot, contentRoot }],
    maxImagePixels: 1_000_000,
  });
  const toolResultClaims = createInMemoryToolResultAssetClaimRegistry();
  return {
    db,
    contentRoot,
    verifiedImageLoader,
    toolResultClaims,
    resolver: createWorkspaceToolModelInputResolver({
      db,
      verifiedImageLoader,
      toolResultClaims,
    }),
  };
}

async function addPngAsset(params: {
  readonly db: Database.Database;
  readonly contentRoot: string;
  readonly assetId: string;
  readonly corruptAfterWrite?: boolean;
}) {
  const bytes = await sharp({
    create: {
      width: 6,
      height: 4,
      channels: 4,
      background: {
        r: params.assetId === 'asset-corrupt' ? 200 : 20,
        g: 90,
        b: 160,
        alpha: 1,
      },
    },
  }).png().toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const localPath = path.join(params.contentRoot, sha256.slice(0, 2), `${sha256}.png`);
  await fsp.mkdir(path.dirname(localPath), { recursive: true });
  await fsp.writeFile(localPath, bytes);
  params.db.prepare(`
    INSERT INTO assets (
      id, media_type, size_bytes, width_px, height_px, sha256, storage_status, local_path
    ) VALUES (?, 'image/png', ?, 6, 4, ?, 'local', ?)
  `).run(params.assetId, bytes.length, sha256, localPath);
  if (params.corruptAfterWrite) {
    await fsp.writeFile(localPath, Buffer.alloc(bytes.length, 7));
  }
  return { bytes, sha256 };
}

function selections(assetIds: readonly string[]) {
  return assetIds.map((assetId, index) => ({
    id: `selection-${index + 1}`,
    uri: `asset://assets/${assetId}`,
    label: `image ${index + 1}`,
  }));
}

function toolContext(conversationId: string, workspaceProjectId?: string): ToolContext {
  return {
    conversationId,
    ...(workspaceProjectId ? { workspaceProjectId } : {}),
  };
}

describe('workspace tool model input resolver', () => {
  it('项目会话按声明顺序返回 durable refs，并允许不同 selection 复用同一 asset', async () => {
    const fixture = await createFixture();
    const asset = await addPngAsset({ ...fixture, assetId: 'asset-project' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-project', 'project-a');
    fixture.db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run('project-a', 'asset-project');

    const resolved = await fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-1',
      selections: selections(['asset-project', 'asset-project']),
      context: toolContext('conv-project', 'project-a'),
    });

    expect(resolved.map(reference => reference.id)).toEqual(['selection-1', 'selection-2']);
    expect(resolved[0]).toEqual({
      id: 'selection-1',
      kind: 'image',
      resourceId: 'asset-project',
      mediaType: 'image/png',
      byteLength: asset.bytes.length,
      width: 6,
      height: 4,
      sha256: asset.sha256,
      label: 'image 1',
    });
    expect(resolved[0]).not.toHaveProperty('bytes');
    expect(resolved[0]).not.toHaveProperty('path');
  });

  it('项目会话拒绝缺失或不匹配的 host project context，也拒绝跨项目 asset', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-project-b' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-project', 'project-a');
    fixture.db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run('project-b', 'asset-project-b');
    const input = {
      toolName: 'resource_read',
      toolCallId: 'call-1',
      selections: selections(['asset-project-b']),
    };

    await expect(fixture.resolver.resolveToolModelInput({
      ...input,
      context: toolContext('conv-project'),
    })).rejects.toMatchObject({ failure: 'project_context_missing' });
    await expect(fixture.resolver.resolveToolModelInput({
      ...input,
      context: toolContext('conv-project', 'project-b'),
    })).rejects.toMatchObject({ failure: 'project_context_mismatch' });
    await expect(fixture.resolver.resolveToolModelInput({
      ...input,
      context: toolContext('conv-project', 'project-a'),
    })).rejects.toMatchObject({
      failure: 'asset_out_of_scope',
      selectionId: 'selection-1',
      requestIndex: 0,
    });
  });

  it('全局会话只允许本会话历史已经引用的 asset', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-global' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, NULL)').run('conv-a');
    fixture.db.prepare('INSERT INTO conversations VALUES (?, NULL)').run('conv-b');
    fixture.db.prepare(`
      INSERT INTO conversation_event_asset_links
      VALUES ('conv-a', 'event-a', 'attachment-a', 0, 'asset-global', 'user_input', 1)
    `).run();

    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-a',
      selections: selections(['asset-global']),
      context: toolContext('conv-a'),
    })).resolves.toHaveLength(1);
    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-b',
      selections: selections(['asset-global']),
      context: toolContext('conv-b'),
    })).rejects.toMatchObject({ failure: 'asset_out_of_scope' });
  });

  it('项目会话可重读本会话 event-only asset，但同项目其他会话不能借项目上下文读取', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-conversation-only' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-owner', 'project-a');
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-peer', 'project-a');
    fixture.db.prepare(`
      INSERT INTO conversation_event_asset_links
      VALUES ('conv-owner', 'event-tool', 'attachment-tool', 0, 'asset-conversation-only', 'tool_result', 1)
    `).run();

    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-owner',
      selections: selections(['asset-conversation-only']),
      context: toolContext('conv-owner', 'project-a'),
    })).resolves.toHaveLength(1);
    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-peer',
      selections: selections(['asset-conversation-only']),
      context: toolContext('conv-peer', 'project-a'),
    })).rejects.toMatchObject({ failure: 'asset_out_of_scope' });
    expect(fixture.db.prepare('SELECT asset_id FROM project_asset_links').all()).toEqual([]);
  });

  it('当前 tool call 可用一次性 artifact claim 引用未加入项目资源库的受管 asset', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-project-history' });
    await addPngAsset({ ...fixture, assetId: 'asset-current-artifact' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-project', 'project-a');
    fixture.db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run(
      'project-a',
      'asset-project-history',
    );
    const [issued] = fixture.toolResultClaims.issueClaims({
      conversationId: 'conv-project',
      toolCallId: 'call-current',
      selections: [{ selectionId: 'selection-artifact', assetId: 'asset-current-artifact' }],
    });
    const mixedSelections = [
      { id: 'selection-history', uri: 'asset://assets/asset-project-history' },
      { id: issued.selectionId, uri: issued.uri },
    ];

    const resolved = await fixture.resolver.resolveToolModelInput({
      toolName: 'command',
      toolCallId: 'call-current',
      selections: mixedSelections,
      context: toolContext('conv-project', 'project-a'),
    });

    expect(resolved.map(reference => reference.resourceId)).toEqual([
      'asset-project-history',
      'asset-current-artifact',
    ]);
    expect(fixture.db.prepare(`
      SELECT asset_id FROM project_asset_links ORDER BY asset_id
    `).all()).toEqual([{ asset_id: 'asset-project-history' }]);
    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'command',
      toolCallId: 'call-current',
      selections: mixedSelections,
      context: toolContext('conv-project', 'project-a'),
    })).rejects.toMatchObject({
      failure: 'artifact_claim_rejected',
      selectionId: 'selection-artifact',
    });
  });

  it('artifact claim 跨 tool call 失败后仍可由原调用消费，重启 registry 后不可恢复', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-current-artifact' });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, NULL)').run('conv-global');
    const [issued] = fixture.toolResultClaims.issueClaims({
      conversationId: 'conv-global',
      toolCallId: 'call-owner',
      selections: [{ selectionId: 'selection-artifact', assetId: 'asset-current-artifact' }],
    });
    const input = {
      toolName: 'command',
      selections: [{ id: issued.selectionId, uri: issued.uri }],
      context: toolContext('conv-global'),
    };

    await expect(fixture.resolver.resolveToolModelInput({
      ...input,
      toolCallId: 'call-other',
    })).rejects.toMatchObject({ failure: 'artifact_claim_rejected' });
    await expect(fixture.resolver.resolveToolModelInput({
      ...input,
      toolCallId: 'call-owner',
    })).resolves.toHaveLength(1);

    const restartedResolver = createWorkspaceToolModelInputResolver({
      db: fixture.db,
      verifiedImageLoader: fixture.verifiedImageLoader,
      toolResultClaims: createInMemoryToolResultAssetClaimRegistry(),
    });
    const [restartIssued] = fixture.toolResultClaims.issueClaims({
      conversationId: 'conv-global',
      toolCallId: 'call-restart',
      selections: [{ selectionId: 'selection-restart', assetId: 'asset-current-artifact' }],
    });
    await expect(restartedResolver.resolveToolModelInput({
      toolName: 'command',
      toolCallId: 'call-restart',
      selections: [{ id: restartIssued.selectionId, uri: restartIssued.uri }],
      context: toolContext('conv-global'),
    })).rejects.toMatchObject({ failure: 'artifact_claim_rejected' });
  });

  it('URI 或任一图片完整性失败时整批拒绝', async () => {
    const fixture = await createFixture();
    await addPngAsset({ ...fixture, assetId: 'asset-good' });
    await addPngAsset({ ...fixture, assetId: 'asset-corrupt', corruptAfterWrite: true });
    fixture.db.prepare('INSERT INTO conversations VALUES (?, ?)').run('conv-project', 'project-a');
    fixture.db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run('project-a', 'asset-good');
    fixture.db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run('project-a', 'asset-corrupt');

    expect(parseWorkspaceAssetUri('asset://assets/asset-good')).toBe('asset-good');
    expect(parseWorkspaceAssetUri('asset://assets/asset-good?path=/tmp/x')).toBeNull();
    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-invalid-uri',
      selections: [{ id: 'bad', uri: 'file:///tmp/image.png' }],
      context: toolContext('conv-project', 'project-a'),
    })).rejects.toMatchObject({ failure: 'asset_uri_invalid' });
    await expect(fixture.resolver.resolveToolModelInput({
      toolName: 'resource_read',
      toolCallId: 'call-corrupt',
      selections: selections(['asset-good', 'asset-corrupt']),
      context: toolContext('conv-project', 'project-a'),
    })).rejects.toMatchObject({
      failure: 'asset_integrity_failed',
      selectionId: 'selection-2',
      requestIndex: 1,
    });
  });
});
