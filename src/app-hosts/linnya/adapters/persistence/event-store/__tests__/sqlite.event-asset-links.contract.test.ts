import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createToolProcessEvent,
  createToolOutputEvent,
  createUserInputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
} from '@linnlabs/linnkit/contracts';
import { agentUtils, formatAgentLlmMessages } from '@linnlabs/linnkit/context-manager';
import { deriveModelInputRequirement } from '@linnlabs/linnkit/runtime-kernel';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import { CONVERSATION_SCHEMAS } from '../conversation.schema';
import { SQLiteEventStore } from '../sqlite.implementation';
import type { RunSession } from '../event-store.interface';
import { serializeStoredRuntimeEvent } from '../functions/runtimeEventStorageCodec';

interface CountRow {
  readonly count: number;
}

function createStore(databasePath = ':memory:'): {
  readonly db: Database.Database;
  readonly store: SQLiteEventStore;
} {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      media_type TEXT,
      size_bytes INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT,
      storage_status TEXT NOT NULL,
      local_path TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE project_asset_links (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'resource',
      origin TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, asset_id)
    );
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  return { db, store: new SQLiteEventStore(db) };
}

function imageRef(id: string, resourceId: string, hashCharacter: string): RuntimeResourceRef {
  return {
    id,
    kind: 'image',
    resourceId,
    mediaType: 'image/png',
    byteLength: 128,
    width: 16,
    height: 8,
    sha256: hashCharacter.repeat(64),
    fileName: `${id}.png`,
  };
}

function assetCommit(ref: RuntimeResourceRef): WorkspaceAssetCommitRecord {
  return {
    assetId: ref.resourceId,
    uri: `/Resources/Attachments/${ref.sha256.slice(0, 2)}/${ref.sha256}.png`,
    mediaType: ref.mediaType,
    byteLength: ref.byteLength,
    width: ref.width,
    height: ref.height,
    sha256: ref.sha256,
    localPath: `/managed/${ref.sha256}.png`,
    createdAt: 1000,
  };
}

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow).count;
}

function routeForSession(event: RuntimeEvent, session: RunSession): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, {
    run_id: session.runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
}

async function appendUserWithAsset(params: {
  readonly store: SQLiteEventStore;
  readonly conversationId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly ref: RuntimeResourceRef;
  readonly commit?: WorkspaceAssetCommitRecord;
  readonly timestamp?: number;
}): Promise<RoutedRuntimeEvent> {
  const event = createUserInputEvent(
    params.eventId,
    params.conversationId,
    params.runId,
    'inspect image',
    { attachments: [params.ref], timestamp: params.timestamp ?? 1000 },
  );
  const session = await params.store.beginRunSession(params.conversationId, params.runId, { kind: 'agent' });
  const routedEvent = routeForSession(event, session);
  await params.store.appendEventToRun(session, routedEvent, {
    assetCommits: params.commit ? [params.commit] : [],
  });
  return routedEvent;
}

describe('SQLiteEventStore conversation event asset links', () => {
  it('atomically registers assets and ordered event links without promoting project conversation attachments', async () => {
    const { db, store } = createStore();
    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-assets');
    const conversationId = 'conv-assets-project';
    const first = imageRef('attachment-first', 'asset-first', 'a');
    const second = imageRef('attachment-second', 'asset-second', 'b');
    const event = createUserInputEvent('event-assets', conversationId, 'run-assets', '', {
      attachments: [first, second],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [event], 'project-assets', 'agent');
    const session = await store.beginRunSession(conversationId, 'run-assets', { kind: 'agent' });

    await store.appendEventToRun(session, routeForSession(event, session), {
      assetCommits: [assetCommit(first), assetCommit(second)],
    });

    expect(db.prepare(`
      SELECT id, media_type, size_bytes, width_px, height_px, sha256, storage_status, local_path
      FROM assets ORDER BY id
    `).all()).toEqual([
      {
        id: 'asset-first',
        media_type: 'image/png',
        size_bytes: 128,
        width_px: 16,
        height_px: 8,
        sha256: 'a'.repeat(64),
        storage_status: 'local',
        local_path: `/managed/${'a'.repeat(64)}.png`,
      },
      {
        id: 'asset-second',
        media_type: 'image/png',
        size_bytes: 128,
        width_px: 16,
        height_px: 8,
        sha256: 'b'.repeat(64),
        storage_status: 'local',
        local_path: `/managed/${'b'.repeat(64)}.png`,
      },
    ]);
    expect(db.prepare(`
      SELECT event_id, attachment_id, ordinal, asset_id, source
      FROM conversation_event_asset_links ORDER BY ordinal
    `).all()).toEqual([
      {
        event_id: event.id,
        attachment_id: first.id,
        ordinal: 0,
        asset_id: first.resourceId,
        source: 'user_input',
      },
      {
        event_id: event.id,
        attachment_id: second.id,
        ordinal: 1,
        asset_id: second.resourceId,
        source: 'user_input',
      },
    ]);
    expect(db.prepare(`
      SELECT project_id, asset_id, role, origin
      FROM project_asset_links ORDER BY asset_id
    `).all()).toEqual([]);
    expect(countRows(db, 'events')).toBe(1);
    expect(countRows(db, 'conversation_ui_messages')).toBe(1);
    expect(countRows(db, 'conversation_ui_messages')).toBe(1);
    expect(db.prepare(`
      SELECT total_events, user_message_count FROM conversations WHERE conversation_id = ?
    `).get(conversationId)).toEqual({ total_events: 1, user_message_count: 1 });
    store.close();
  });

  it('相同内容重新进入当前受管 store 时更新物理路径而不改变 asset 身份', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-assets-store-move';
    const firstRef = imageRef('attachment-store-old', 'asset-store-stable', 'a');
    const firstEvent = createUserInputEvent(
      'event-store-old',
      conversationId,
      'run-store-old',
      'old store',
      { attachments: [firstRef], timestamp: 1000 },
    );
    await store.ensureConversation(conversationId, [firstEvent], undefined, 'agent');
    const firstSession = await store.beginRunSession(conversationId, 'run-store-old', { kind: 'agent' });
    await store.appendEventToRun(firstSession, routeForSession(firstEvent, firstSession), {
      assetCommits: [{ ...assetCommit(firstRef), localPath: '/legacy-v1/content.png' }],
    });

    const secondRef = { ...firstRef, id: 'attachment-store-new' };
    const secondEvent = createUserInputEvent(
      'event-store-new',
      conversationId,
      'run-store-new',
      'new store',
      { attachments: [secondRef], timestamp: 2000 },
    );
    const secondSession = await store.beginRunSession(conversationId, 'run-store-new', { kind: 'agent' });
    await store.appendEventToRun(secondSession, routeForSession(secondEvent, secondSession), {
      assetCommits: [{ ...assetCommit(secondRef), localPath: '/bound-v2/content.png' }],
    });

    expect(db.prepare('SELECT id, local_path FROM assets').all()).toEqual([{
      id: 'asset-store-stable',
      local_path: '/bound-v2/content.png',
    }]);
    expect(db.prepare('SELECT event_id, asset_id FROM conversation_event_asset_links ORDER BY event_id').all())
      .toEqual([
        { event_id: 'event-store-new', asset_id: 'asset-store-stable' },
        { event_id: 'event-store-old', asset_id: 'asset-store-stable' },
      ]);
    store.close();
  });

  it('重开 SQLite 后仍按原顺序恢复 tool event 附件，且复用 canonical asset', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'linnya-tool-event-assets-'));
    const databasePath = join(temporaryDirectory, 'workspace.sqlite');
    const { db, store } = createStore(databasePath);
    const conversationId = 'conv-assets-global';
    const ref = imageRef('attachment-user', 'asset-shared', 'c');
    const firstEvent = createUserInputEvent('event-shared-user', conversationId, 'run-shared', 'first', {
      attachments: [ref],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [firstEvent], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-shared', { kind: 'agent' });
    await store.appendEventToRun(session, routeForSession(firstEvent, session), { assetCommits: [assetCommit(ref)] });

    const toolRef = { ...ref, id: 'attachment-tool' };
    const toolEvent = createToolOutputEvent(
      'event-shared-tool',
      conversationId,
      'run-shared',
      'render',
      'call-shared',
      { status: 'success', observation: 'done', data: null },
      { attachments: [toolRef], timestamp: 2000 },
    );
    await store.appendEventToRun(session, routeForSession(toolEvent, session));

    expect(countRows(db, 'assets')).toBe(1);
    expect(countRows(db, 'conversation_event_asset_links')).toBe(2);
    expect(countRows(db, 'project_asset_links')).toBe(0);
    expect(db.prepare(`
      SELECT event_id, attachment_id, source
      FROM conversation_event_asset_links ORDER BY created_at
    `).all()).toEqual([
      { event_id: firstEvent.id, attachment_id: ref.id, source: 'user_input' },
      { event_id: toolEvent.id, attachment_id: toolRef.id, source: 'tool_output' },
    ]);
    store.close();

    try {
      const reopenedDb = new Database(databasePath);
      const reopenedStore = new SQLiteEventStore(reopenedDb);
      const replay = await reopenedStore.readEvents(conversationId, {
        direction: 'forward',
        limit: 10,
      });
      const replayedTool = replay.events.find(
        (event): event is Extract<RoutedRuntimeEvent, { type: 'tool_output' }> => (
          event.id === toolEvent.id && event.type === 'tool_output'
        ),
      );
      expect(replayedTool).toBeDefined();
      expect(replayedTool?.attachments?.map(attachment => ({
        id: attachment.id,
        resourceId: attachment.resourceId,
      }))).toEqual([{
        id: toolRef.id,
        resourceId: toolRef.resourceId,
      }]);
      if (!replayedTool) throw new Error('expected tool event after SQLite replay');

      // 能力要求必须来自最终上下文；SQLite 中曾经出现过图片，不能让要求永久粘住。
      const replayedToolMessages = formatAgentLlmMessages([
        agentUtils.convertEventToAiMessage(replayedTool),
      ]);
      expect(deriveModelInputRequirement(replayedToolMessages)).toEqual({
        requires_image_input: true,
        placements: ['tool_result_image'],
      });
      expect(deriveModelInputRequirement([
        { role: 'user', content: '图片工具组已退出最终上下文' },
      ])).toEqual({
        requires_image_input: false,
        placements: [],
      });
      const projection = reopenedDb.prepare(`
        SELECT attachments_json
        FROM conversation_ui_messages
        WHERE conversation_id = ? AND message_type = 'tool_calls'
      `).get(conversationId) as { attachments_json: string | null };
      expect(JSON.parse(projection.attachments_json ?? '[]')).toEqual([
        expect.objectContaining({ id: toolRef.id, assetId: toolRef.resourceId }),
      ]);
      reopenedStore.close();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('tool attachment 与既有账本不一致时原子回滚 event、link、projection 和 stats', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-tool-asset-rollback';
    const ref = imageRef('attachment-tool-valid', 'asset-tool-existing', '3');
    const userEvent = createUserInputEvent('event-tool-asset-seed', conversationId, 'turn-seed', 'seed', {
      attachments: [ref],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [userEvent], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-tool-asset-rollback', { kind: 'agent' });
    await store.appendEventToRun(session, routeForSession(userEvent, session), { assetCommits: [assetCommit(ref)] });
    const invalidToolRef = { ...ref, id: 'attachment-tool-invalid', width: ref.width + 1 };
    const toolEvent = createToolOutputEvent(
      'event-tool-asset-invalid',
      conversationId,
      'turn-tool-invalid',
      'resource_read',
      'call-tool-invalid',
      { status: 'success', observation: 'image loaded', data: null },
      { attachments: [invalidToolRef], timestamp: 2000 },
    );

    await expect(store.appendEventToRun(session, routeForSession(toolEvent, session))).rejects.toThrow('does not match attachment');

    expect(db.prepare('SELECT id FROM events ORDER BY id').all()).toEqual([
      { id: userEvent.id },
    ]);
    expect(db.prepare('SELECT event_id, attachment_id FROM conversation_event_asset_links').all()).toEqual([
      { event_id: userEvent.id, attachment_id: ref.id },
    ]);
    expect(countRows(db, 'conversation_ui_messages')).toBe(1);
    expect(db.prepare(`
      SELECT total_events, user_message_count FROM conversations WHERE conversation_id = ?
    `).get(conversationId)).toEqual({ total_events: 1, user_message_count: 1 });
    store.close();
  });

  it('rolls back event, links, asset, projection and stats when commit facts disagree', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-assets-rollback';
    const ref = imageRef('attachment-rollback', 'asset-rollback', 'd');
    const event = createUserInputEvent('event-assets-rollback', conversationId, 'run-assets-rollback', 'rollback', {
      attachments: [ref],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [event], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-assets-rollback', { kind: 'agent' });

    await expect(store.appendEventToRun(session, routeForSession(event, session), {
      assetCommits: [{ ...assetCommit(ref), width: ref.width + 1 }],
    })).rejects.toThrow('does not match attachment');

    expect(countRows(db, 'events')).toBe(0);
    expect(countRows(db, 'assets')).toBe(0);
    expect(countRows(db, 'conversation_event_asset_links')).toBe(0);
    expect(countRows(db, 'conversation_ui_messages')).toBe(0);
    expect(db.prepare(`
      SELECT total_events, user_message_count FROM conversations WHERE conversation_id = ?
    `).get(conversationId)).toEqual({ total_events: 0, user_message_count: 0 });

    const wrongConversationEvent = createUserInputEvent(
      'event-wrong-conversation',
      'different-conversation',
      session.runId,
      'wrong owner',
      { attachments: [ref], timestamp: 1001 },
    );
    await expect(store.appendEventToRun(session, routeForSession(wrongConversationEvent, session), {
      assetCommits: [assetCommit(ref)],
    })).rejects.toThrow('cannot append it');
    expect(countRows(db, 'events')).toBe(0);
    store.close();
  });

  it('atomically replaces one user input while preserving the destination run', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-assets-replace';
    const originalRef = imageRef('attachment-original', 'asset-original', '4');
    const original = createUserInputEvent('event-replace-target', conversationId, 'turn-original', 'original', {
      attachments: [originalRef],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [original], undefined, 'agent');
    const originalSession = await store.beginRunSession(conversationId, 'run-replace-original', { kind: 'agent' });
    await store.appendEventToRun(originalSession, routeForSession(original, originalSession), { assetCommits: [assetCommit(originalRef)] });

    const later = createUserInputEvent('event-replace-later', conversationId, 'turn-later', 'later', {
      timestamp: 2000,
    });
    const laterSession = await store.beginRunSession(conversationId, 'run-replace-later', { kind: 'agent' });
    await store.appendEventToRun(laterSession, routeForSession(later, laterSession));

    const destination = await store.beginRunSession(conversationId, 'run-replace-destination', { kind: 'agent' });
    const replacementRef = imageRef('attachment-replacement', 'asset-replacement', '5');
    const replacement = createUserInputEvent(
      original.id,
      conversationId,
      'turn-replacement',
      'replacement',
      { attachments: [replacementRef], timestamp: 3000 },
    );

    await expect(store.replaceUserInputEvent(destination, original.id, routeForSession(replacement, destination), {
      assetCommits: [assetCommit(replacementRef)],
    })).resolves.toEqual({ deletedEventCount: 2, deletedRunCount: 2 });

    expect(db.prepare('SELECT id FROM runs ORDER BY id').all()).toEqual([
      { id: destination.runId },
    ]);
    expect(db.prepare('SELECT id, run_id FROM events').all()).toEqual([
      { id: replacement.id, run_id: destination.runId },
    ]);
    expect(db.prepare('SELECT message_id, run_id, attachments_json FROM conversation_ui_messages').all())
      .toEqual([{
        message_id: replacement.id,
        run_id: destination.runId,
        attachments_json: JSON.stringify([{
          id: replacementRef.id,
          kind: replacementRef.kind,
          assetId: replacementRef.resourceId,
          mediaType: replacementRef.mediaType,
          byteLength: replacementRef.byteLength,
          width: replacementRef.width,
          height: replacementRef.height,
          sha256: replacementRef.sha256,
          fileName: replacementRef.fileName,
        }]),
      }]);
    expect(db.prepare('SELECT event_id, attachment_id, asset_id FROM conversation_event_asset_links').all())
      .toEqual([{
        event_id: replacement.id,
        attachment_id: replacementRef.id,
        asset_id: replacementRef.resourceId,
      }]);
    expect(db.prepare(`
      SELECT total_events, user_message_count, preview_text
      FROM conversations
      WHERE conversation_id = ?
    `).get(conversationId)).toEqual({
      total_events: 1,
      user_message_count: 1,
      preview_text: 'replacement',
    });
    expect(countRows(db, 'assets')).toBe(2);
    store.close();
  });

  it('rolls back the full replacement when the new asset facts fail validation', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-assets-replace-rollback';
    const originalRef = imageRef('attachment-replace-rollback', 'asset-replace-rollback', '6');
    const original = createUserInputEvent('event-replace-rollback', conversationId, 'turn-original', 'original', {
      attachments: [originalRef],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [original], undefined, 'agent');
    const originalSession = await store.beginRunSession(conversationId, 'run-replace-rollback-original', { kind: 'agent' });
    const routedOriginal = routeForSession(original, originalSession);
    await store.appendEventToRun(originalSession, routedOriginal, { assetCommits: [assetCommit(originalRef)] });
    const destination = await store.beginRunSession(conversationId, 'run-replace-rollback-destination', { kind: 'agent' });

    const replacementRef = imageRef('attachment-invalid-replacement', 'asset-invalid-replacement', '7');
    const replacement = createUserInputEvent(
      original.id,
      conversationId,
      'turn-replacement',
      'replacement must roll back',
      { attachments: [replacementRef], timestamp: 2000 },
    );
    await expect(store.replaceUserInputEvent(destination, original.id, routeForSession(replacement, destination), {
      assetCommits: [{ ...assetCommit(replacementRef), width: replacementRef.width + 1 }],
    })).rejects.toThrow('does not match attachment');

    expect(db.prepare('SELECT id, status FROM runs ORDER BY id').all()).toEqual([
      { id: destination.runId, status: 'running' },
      { id: originalSession.runId, status: 'running' },
    ]);
    expect(db.prepare('SELECT id, run_id, payload FROM events').all()).toEqual([{
      id: original.id,
      run_id: originalSession.runId,
      payload: serializeStoredRuntimeEvent(routedOriginal),
    }]);
    expect(db.prepare('SELECT message_id, run_id FROM conversation_ui_messages').all()).toEqual([{
      message_id: original.id,
      run_id: originalSession.runId,
    }]);
    expect(db.prepare('SELECT event_id, attachment_id, asset_id FROM conversation_event_asset_links').all())
      .toEqual([{
        event_id: original.id,
        attachment_id: originalRef.id,
        asset_id: originalRef.resourceId,
      }]);
    expect(db.prepare(`
      SELECT total_events, user_message_count, preview_text
      FROM conversations
      WHERE conversation_id = ?
    `).get(conversationId)).toEqual({
      total_events: 1,
      user_message_count: 1,
      preview_text: 'original',
    });
    expect(countRows(db, 'assets')).toBe(1);
    store.close();
  });

  it('deletes links explicitly on both truncate paths while retaining shared asset bytes', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-assets-truncate';
    const ref = imageRef('attachment-kept', 'asset-truncate-shared', 'e');
    const first = createUserInputEvent('event-assets-kept', conversationId, 'run-assets-kept', 'kept', {
      attachments: [ref],
      timestamp: 1000,
    });
    await store.ensureConversation(conversationId, [first], undefined, 'agent');
    const firstSession = await store.beginRunSession(conversationId, 'run-assets-kept', { kind: 'agent' });
    await store.appendEventToRun(firstSession, routeForSession(first, firstSession), { assetCommits: [assetCommit(ref)] });
    db.prepare('UPDATE runs SET start_ts = 1000 WHERE id = ?').run(firstSession.runId);

    const secondRef = { ...ref, id: 'attachment-materialized-delete' };
    const second = await appendUserWithAsset({
      store,
      conversationId,
      runId: 'run-assets-materialized-delete',
      eventId: 'event-assets-materialized-delete',
      ref: secondRef,
      timestamp: 2000,
    });
    db.prepare('UPDATE runs SET start_ts = 2000 WHERE id = ?').run('run-assets-materialized-delete');

    await store.truncateFromEvent(conversationId, second.id);
    expect(db.prepare(`
      SELECT attachment_id FROM conversation_event_asset_links ORDER BY attachment_id
    `).all()).toEqual([{ attachment_id: ref.id }]);

    const thirdRef = { ...ref, id: 'attachment-event-path-delete' };
    await appendUserWithAsset({
      store,
      conversationId,
      runId: 'run-assets-event-delete',
      eventId: 'event-assets-before-tool-process',
      ref: thirdRef,
      timestamp: 3000,
    });
    const toolOutput = createToolOutputEvent(
      'event-assets-tool-output-target',
      conversationId,
      'run-assets-event-delete',
      'render',
      'call-event-delete',
      { status: 'success', observation: 'rendered', data: null },
      { timestamp: 3100 },
    );
    const thirdSession = await store.openRunSession(conversationId, 'run-assets-event-delete');
    await store.appendEventToRun(thirdSession, routeForSession(toolOutput, thirdSession));
    db.prepare('UPDATE runs SET start_ts = 3000 WHERE id = ?').run('run-assets-event-delete');

    await store.truncateFromEvent(conversationId, toolOutput.id);
    expect(db.prepare('SELECT attachment_id FROM conversation_event_asset_links').all()).toEqual([
      { attachment_id: ref.id },
    ]);
    expect(countRows(db, 'assets')).toBe(1);
    store.close();
  });

  it('deletes links explicitly for single and no-project batch deletion with foreign keys disabled', async () => {
    const { db, store } = createStore();
    db.pragma('foreign_keys = OFF');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
    const firstRef = imageRef('attachment-delete-one', 'asset-delete-one', 'f');
    const firstEvent = createUserInputEvent('event-delete-one', 'conv-delete-one', 'run-delete-one', 'one', {
      attachments: [firstRef],
    });
    await store.ensureConversation('conv-delete-one', [firstEvent], undefined, 'agent');
    await appendUserWithAsset({
      store,
      conversationId: 'conv-delete-one',
      runId: 'run-delete-one',
      eventId: 'event-delete-one',
      ref: firstRef,
      commit: assetCommit(firstRef),
    });

    await store.deleteConversation('conv-delete-one');
    expect(countRows(db, 'conversation_event_asset_links')).toBe(0);
    expect(countRows(db, 'conversation_ui_messages')).toBe(0);
    expect(countRows(db, 'conversation_ui_projection_state')).toBe(0);
    expect(countRows(db, 'events')).toBe(0);
    expect(countRows(db, 'runs')).toBe(0);
    expect(countRows(db, 'conversations')).toBe(0);

    const secondRef = imageRef('attachment-delete-batch', 'asset-delete-batch', '1');
    const secondEvent = createUserInputEvent('event-delete-batch', 'conv-delete-batch', 'run-delete-batch', 'batch', {
      attachments: [secondRef],
    });
    await store.ensureConversation('conv-delete-batch', [secondEvent], undefined, 'agent');
    await appendUserWithAsset({
      store,
      conversationId: 'conv-delete-batch',
      runId: 'run-delete-batch',
      eventId: 'event-delete-batch',
      ref: secondRef,
      commit: assetCommit(secondRef),
    });

    await store.deleteConversationsWithoutProject();
    expect(countRows(db, 'conversation_event_asset_links')).toBe(0);
    expect(countRows(db, 'conversation_ui_messages')).toBe(0);
    expect(countRows(db, 'conversation_ui_projection_state')).toBe(0);
    expect(countRows(db, 'events')).toBe(0);
    expect(countRows(db, 'runs')).toBe(0);
    expect(countRows(db, 'conversations')).toBe(0);
    expect(countRows(db, 'assets')).toBe(2);
    store.close();
  });
});
