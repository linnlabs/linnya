import { promises as fsp } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { createPinia, setActivePinia } from 'pinia';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationUserInputCommittedEventSchema,
  validateConversationNextRequest,
} from '@app/schemas';
import { agentContext, agentUtils, formatAgentLlmMessages } from '@linnlabs/linnkit/context-manager';
import type { LlmRequestMessage, TokenizerPort } from '@linnlabs/linnkit/ports';
import { mapUiMessagesWindowDtoToRows } from 'apps/renderer/domains/conversation/message-window/functions/mapUiMessageDto';
import { readUiMessagesWindowDto } from 'apps/renderer/domains/conversation/message-window/functions/uiMessagesDtoGuards';
import { createConversationImageDraftSubmissionSnapshot } from 'apps/renderer/domains/conversation/features/image-attachments/functions/conversationImageDraftRules';
import { createConversationImageAttachmentApi } from 'apps/renderer/domains/conversation/features/image-attachments/orchestration/conversationImageAttachmentApi';
import { createConversationImageAttachmentDraftController } from 'apps/renderer/domains/conversation/features/image-attachments/orchestration/conversationImageAttachmentDraftController';
import { createConversationImagePreviewApi } from 'apps/renderer/domains/conversation/features/image-attachments/orchestration/conversationImagePreviewApi';
import { useConversationImageAttachmentDraftStore } from 'apps/renderer/domains/conversation/features/image-attachments/store/conversationImageAttachmentDraftStore';
import {
  createImageInputProcessingProfileRegistry,
  createWorkspaceLlmInputMaterializer,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { createWorkspaceAssetIdentityResolver } from 'src/features/workspace/assets/functions/createWorkspaceAssetIdentityResolver';
import {
  createConversationImageIngress,
  type ConversationImageIngressPolicy,
} from 'src/features/conversation/attachments/features/image-ingress';
import { createConversationAttachmentStoragePaths } from 'src/features/conversation/attachments/shared/storage-paths';
import { createWorkspaceLlmImageResolver } from 'src/features/workspace/assets/features/llm-image-resolution';
import { createWorkspaceImagePreview } from 'src/features/workspace/assets/features/image-preview';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE } from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { createConversationImageAttachmentRouter } from 'src/electron-main/routes/conversationImageAttachmentRouter';
import { createWorkspaceImagePreviewRouter } from 'src/electron-main/routes/workspaceImagePreviewRouter';
import { CONVERSATION_SCHEMAS } from '../../persistence/event-store/conversation.schema';
import { SQLiteEventStore } from '../../persistence/event-store/sqlite.implementation';
import {
  readTail,
  rebuildConversationUiProjection,
} from '../../persistence/event-store/ui-projection';
import { FlowIncomingEventPreparer } from '../incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { FlowOrchestrator } from '../flow.orchestrator';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from '../flow.history-handler.service';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from '../flow.persistence';
import { createDirectFlowConversationAdmissionPort } from '../__test-helpers__/createDirectFlowConversationAdmissionPort';
import type { FlowAgentRunExecution, FlowAgentRunRequest } from '../flow.runner-handoff';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import {
  configureAgentRuntimeSingletons,
  resetAgentRuntimeSingletonsForTest,
} from 'src/electron-main/services/agentRuntimeSingletons';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import type { UserInputEvent } from '@linnlabs/linnkit/contracts';

const TEST_POLICY: ConversationImageIngressPolicy = {
  maxImageBytes: 1024 * 1024,
  maxImagePixels: 1_000_000,
  maxAttachmentsPerMessage: 10,
  maxTotalBytesPerMessage: 2 * 1024 * 1024,
};
const STORE_ID = '791cf8b2-b05e-41b0-b74b-a9639f58eb75';

interface StoredEventRow {
  readonly id: string;
  readonly payload: string;
}

interface StoredProjectionRow {
  readonly attachments_json: string | null;
}

interface StoredAssetPathRow {
  readonly local_path: string | null;
}

async function listenForConversationImages(params: {
  readonly ingress: Awaited<ReturnType<typeof createConversationImageIngress>>;
  readonly db: Database.Database;
  readonly appDataRoot: string;
}): Promise<{ readonly server: Server; readonly baseUrl: string }> {
  const contentRoot = createConversationAttachmentStoragePaths(
    params.appDataRoot,
    STORE_ID
  ).contentRoot;
  const verifiedImageLoader = createWorkspaceVerifiedImageLoader({
    db: params.db,
    storageBoundaries: [{ boundaryRoot: params.appDataRoot, contentRoot }],
    maxImagePixels: TEST_POLICY.maxImagePixels,
  });
  const app = express();
  app.use(
    '/api/v1/conversation',
    createConversationImageAttachmentRouter({
      imageIngress: params.ingress,
      maxImageBytes: TEST_POLICY.maxImageBytes,
    })
  );
  app.use(
    '/api/v1/conversation',
    createWorkspaceImagePreviewRouter({
      imagePreview: createWorkspaceImagePreview({ verifiedImageLoader }),
    })
  );
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('conversation image fixture 未获得 TCP 监听地址');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

async function waitForDraftsToSettle(
  store: ReturnType<typeof useConversationImageAttachmentDraftStore>
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.items.length > 0 && store.items.every(item => item.status !== 'uploading')) return;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Renderer 图片草稿在时限内没有完成 staging');
}

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
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
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  return db;
}

async function writeImage(
  root: string,
  fileName: string,
  format: 'png' | 'webp',
  color: { readonly r: number; readonly g: number; readonly b: number }
): Promise<string> {
  const sourcePath = path.join(root, 'source', fileName);
  await fsp.mkdir(path.dirname(sourcePath), { recursive: true });
  const bytes = await sharp({
    create: { width: 18, height: 12, channels: 3, background: color },
  })
    [format]()
    .toBuffer();
  await fsp.writeFile(sourcePath, bytes);
  return sourcePath;
}

function requireReadyWindow(
  db: Database.Database,
  conversationId: string
): Extract<ReturnType<typeof readTail>, { readonly status: 'ready' }> {
  const result = readTail(db, conversationId, 20);
  if (result.status !== 'ready') {
    throw new Error(`expected ready UI projection, received ${result.status}`);
  }
  return result;
}

describe('Flow image attachment durable lifecycle', () => {
  const tempRoots: string[] = [];
  const servers: Server[] = [];

  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearPluginRuntimeStateForTests();
    resetAgentRuntimeSingletonsForTest();
    await Promise.all(servers.splice(0).map(closeServer));
    for (const root of tempRoots.splice(0)) {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps one ordered image-only aggregate from Renderer multipart through provider and preview reload', async () => {
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-lifecycle-'));
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-app-data-'));
    tempRoots.push(workspaceRoot, appDataRoot);
    const firstSource = await writeImage(workspaceRoot, 'first.png', 'png', {
      r: 16,
      g: 96,
      b: 184,
    });
    const secondSource = await writeImage(workspaceRoot, 'second.webp', 'webp', {
      r: 210,
      g: 72,
      b: 54,
    });
    const [firstSourceBytes, secondSourceBytes] = await Promise.all([
      fsp.readFile(firstSource),
      fsp.readFile(secondSource),
    ]);
    const draftIds = ['draft-second', 'draft-first'];
    const ingress = await createConversationImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      policy: TEST_POLICY,
      createDraftId: () => draftIds.shift() ?? 'draft-unexpected',
    });
    const db = createDatabase();
    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-image-lifecycle');
    const running = await listenForConversationImages({ ingress, db, appDataRoot });
    servers.push(running.server);
    setActivePinia(createPinia());
    const draftStore = useConversationImageAttachmentDraftStore();
    const revokedUrls: string[] = [];
    const imageApi = createConversationImageAttachmentApi({
      getBaseUrl: async () => running.baseUrl,
      fetch: (input, init) => fetch(input, init),
    });
    const draftController = createConversationImageAttachmentDraftController({
      store: draftStore,
      api: imageApi,
      objectUrls: {
        create: file => `blob:renderer-${file.name}`,
        revoke: url => revokedUrls.push(url),
      },
      log: {
        releaseFailed: code => {
          throw new Error(`fixture draft release failed: ${code}`);
        },
      },
      createClientId: (() => {
        let sequence = 0;
        return () => `renderer-client-${(sequence += 1)}`;
      })(),
    });
    const secondFile = new File([Uint8Array.from(secondSourceBytes)], 'second.webp', {
      type: 'image/gif',
    });
    const firstFile = new File([Uint8Array.from(firstSourceBytes)], 'first.png', {
      type: 'image/png',
    });
    expect(draftController.stageFiles([secondFile, firstFile])).toEqual({
      kind: 'accepted',
      clientIds: ['renderer-client-1', 'renderer-client-2'],
    });
    await waitForDraftsToSettle(draftStore);
    expect(draftStore.items.map(item => [item.fileName, item.status])).toEqual([
      ['second.webp', 'ready'],
      ['first.png', 'ready'],
    ]);
    const rendererSubmission = createConversationImageDraftSubmissionSnapshot(draftStore.items);
    const [secondDraft, firstDraft] = rendererSubmission.attachments;
    if (!secondDraft || !firstDraft) {
      throw new Error('Renderer submission 没有保留两张图片');
    }
    expect(rendererSubmission.attachments).toEqual([
      { draftId: 'draft-second', kind: 'image', fileName: 'second.webp' },
      { draftId: 'draft-first', kind: 'image', fileName: 'first.png' },
    ]);
    await Promise.all([fsp.unlink(firstSource), fsp.unlink(secondSource)]);

    const store = new SQLiteEventStore(db);
    const assetIds = ['asset-first', 'asset-second'];
    const attachmentIds = ['attachment-first', 'attachment-second'];
    const preparer = new FlowIncomingEventPreparer(
      {
        kind: 'enabled',
        imageIngress: ingress,
        assetIdentity: createWorkspaceAssetIdentityResolver({
          db,
          createAssetId: () => assetIds.shift() ?? 'asset-unexpected',
        }),
      },
      () => attachmentIds.shift() ?? 'attachment-unexpected'
    );
    const conversationId = 'conversation-image-lifecycle';
    const turnId = 'turn-image-lifecycle';
    const parsedRequest = validateConversationNextRequest({
      conversation_id: conversationId,
      project_id: 'project-image-lifecycle',
      new_events: [
        {
          type: 'user_input',
          id: 'event-image-lifecycle',
          timestamp: 1000,
          turn_id: turnId,
          content: '',
          raw_content: '',
          source: 'user',
          attachments: [
            { ...secondDraft, label: 'second' },
            { ...firstDraft, label: 'first' },
          ],
        },
      ],
    });
    if (!parsedRequest.success) {
      throw new Error(`image lifecycle request is invalid: ${parsedRequest.error.message}`);
    }
    const historyRepository = new HistoryRepository(store);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository)
    );
    const persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    const agentRuntime = configureAgentRuntimeSingletons({ db, eventStore: store });
    const executionOrder: string[] = [];
    const agentRunner = {
      run: vi.fn((runRequest: FlowAgentRunRequest): FlowAgentRunExecution => {
        executionOrder.push('agent');
        const result = Promise.resolve({
          conversation_id: conversationId,
          events: [],
          stepCount: 0,
        });
        return {
          handle: runRequest.runHandle,
          result,
          then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
        };
      }),
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      agentRunner,
      persistenceCoordinator,
      preparer,
      agentRuntime
    );
    const committedEvents: unknown[] = [];

    await orchestrator.next(parsedRequest.data, event => {
      if (event.type === 'user_input_committed') {
        executionOrder.push('ack');
        committedEvents.push(event);
      }
    });

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    expect(executionOrder).toEqual(['ack', 'agent']);
    const committed = ConversationUserInputCommittedEventSchema.parse(committedEvents[0]);
    expect(committed).toMatchObject({
      id: 'event-image-lifecycle',
      operation: 'append',
      raw_content: '',
      attachments: [
        { id: 'attachment-first', assetId: 'asset-first', mediaType: 'image/webp' },
        { id: 'attachment-second', assetId: 'asset-second', mediaType: 'image/png' },
      ],
    });
    draftController.acceptCommitted();
    expect(draftStore.items).toEqual([]);
    expect(revokedUrls).toEqual(['blob:renderer-second.webp', 'blob:renderer-first.png']);
    const runRequest = agentRunner.run.mock.calls[0]?.[0];
    if (!runRequest) throw new Error('expected FlowOrchestrator to dispatch one agent run');
    const registeredRequest = await runRequest.runHandle.request();
    const currentUserEvent = runRequest.newEvents.find(
      (event): event is UserInputEvent =>
        event.id === registeredRequest.currentUserEventId && event.type === 'user_input'
    );
    if (!currentUserEvent)
      throw new Error('expected runner events to contain the registered current user event');
    expect(registeredRequest.currentUserEventId).toBe('event-image-lifecycle');
    expect(registeredRequest.currentUserAttachments).toEqual(currentUserEvent.attachments);
    expect(registeredRequest.currentUserAttachments?.map(item => item.id)).toEqual([
      'attachment-first',
      'attachment-second',
    ]);

    expect(ingress.resolveDraft(firstDraft.draftId)).toBeNull();
    expect(ingress.resolveDraft(secondDraft.draftId)).toBeNull();
    const incremental = requireReadyWindow(db, conversationId);
    const wireDto = readUiMessagesWindowDto({
      success: true,
      conversation_id: incremental.conversation_id,
      messages: incremental.messages,
      citation_dependencies: incremental.citation_dependencies,
      has_more_before: incremental.has_more_before,
      has_more_after: incremental.has_more_after,
      prev_cursor: incremental.prev_cursor,
      next_cursor: incremental.next_cursor,
      revision: incremental.revision,
    });
    if (!wireDto.success) throw new Error('expected ready Renderer window DTO');
    const rendererRows = mapUiMessagesWindowDtoToRows(wireDto);
    expect(rendererRows[0]?.message).toMatchObject({
      id: 'event-image-lifecycle',
      content: '',
      attachments: [
        {
          id: 'attachment-first',
          assetId: 'asset-first',
          mediaType: 'image/webp',
          label: 'second',
        },
        {
          id: 'attachment-second',
          assetId: 'asset-second',
          mediaType: 'image/png',
          label: 'first',
        },
      ],
    });
    const rendererPreviewApi = createConversationImagePreviewApi({
      getBaseUrl: async () => running.baseUrl,
      fetch: (input, init) => fetch(input, init),
    });
    const reloadedPreview = await rendererPreviewApi.loadImage(
      'asset-first',
      new AbortController().signal
    );
    expect(reloadedPreview.type).toBe('image/webp');
    expect(Buffer.from(await reloadedPreview.arrayBuffer())).toEqual(secondSourceBytes);

    expect(
      db
        .prepare(
          `
      SELECT event_id, attachment_id, ordinal, asset_id
      FROM conversation_event_asset_links
      ORDER BY ordinal
    `
        )
        .all()
    ).toEqual([
      {
        event_id: 'event-image-lifecycle',
        attachment_id: 'attachment-first',
        ordinal: 0,
        asset_id: 'asset-first',
      },
      {
        event_id: 'event-image-lifecycle',
        attachment_id: 'attachment-second',
        ordinal: 1,
        asset_id: 'asset-second',
      },
    ]);
    expect(db.prepare('SELECT * FROM project_asset_links').all()).toEqual([]);

    const storedEvents = db
      .prepare<[], StoredEventRow>(`SELECT id, payload FROM events WHERE type = 'user_input'`)
      .all();
    expect(storedEvents[0]?.id).toBe(registeredRequest.currentUserEventId);
    expect(JSON.parse(storedEvents[0]?.payload ?? 'null')).toMatchObject({
      attachments: registeredRequest.currentUserAttachments,
    });
    expect(JSON.parse(storedEvents[0]?.payload ?? 'null')).not.toHaveProperty('id');
    const storedProjection = db
      .prepare<[], StoredProjectionRow>(
        `
      SELECT attachments_json FROM conversation_ui_messages
    `
      )
      .all();
    const durableSurfaces = JSON.stringify({
      storedEvents,
      storedProjection,
      wireDto,
      rendererMessages: rendererRows.map(row => row.message),
    });
    expect(durableSurfaces).not.toContain('draft-first');
    expect(durableSurfaces).not.toContain('draft-second');
    expect(durableSurfaces).not.toContain(workspaceRoot);
    expect(durableSurfaces).not.toContain('data:image');
    expect(durableSurfaces).not.toContain(';base64,');

    const rebuild = rebuildConversationUiProjection(db, conversationId, { force: true });
    expect(rebuild.status).toBe('rebuilt');
    const rebuilt = requireReadyWindow(db, conversationId);
    expect(rebuilt.messages).toEqual(incremental.messages);

    // 模拟刷新后的历史恢复：后续链路只消费 SQLite 事实事件，不复用本轮内存事件或 draft。
    const replayedHistory = await historyRepository.readEvents(conversationId, {
      direction: 'forward',
      limit: 20,
    });
    const replayedUserEvent = replayedHistory.events.find(
      (event): event is UserInputEvent =>
        event.id === 'event-image-lifecycle' && event.type === 'user_input'
    );
    if (!replayedUserEvent)
      throw new Error('expected persisted image event to survive history reload');

    const activeModelId = 'phase3-flow-image-model';
    const profileRegistry = createImageInputProcessingProfileRegistry({
      resolveRouteForModel: modelId => (modelId === activeModelId ? 'openai' : undefined),
      bindings: [{ route: 'openai', profile: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE }],
    });
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(new agentContext.AgentCoreContextProvider());
    const tokenizer: TokenizerPort = {
      estimateText: text => Math.max(1, Math.ceil(text.length / 4)),
      estimateMessage: message => Math.max(1, Math.ceil((message.content?.length ?? 0) / 4)),
    };
    const contextManager = new agentContext.AgentContextManager({
      providerRegistry,
      tokenizer,
      tokenizerModelId: activeModelId,
      imageInputEstimator: profileRegistry,
    });
    const contextResult = await contextManager.buildContextFromPreprocessedMessages(
      {
        promptKey: 'default',
        query: '',
        currentUserEventId: replayedUserEvent.id,
        currentUserAttachments: replayedUserEvent.attachments,
        model_id: activeModelId,
      },
      [agentUtils.convertEventToAiMessage(replayedUserEvent)],
      10_000
    );
    expect(replayedUserEvent.raw_content).toBe('');
    expect(contextResult.messages).toMatchObject([
      {
        id: 'event-image-lifecycle',
        role: 'user',
        content: replayedUserEvent.content,
        attachments: replayedUserEvent.attachments,
      },
    ]);
    expect(contextResult.imageInputAdmissionEvidence).toMatchObject({
      initialProfileId: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE.id,
      attachments: [
        { messageIndex: 0, attachmentIndex: 0, id: 'attachment-first', resourceId: 'asset-first' },
        {
          messageIndex: 0,
          attachmentIndex: 1,
          id: 'attachment-second',
          resourceId: 'asset-second',
        },
      ],
    });
    if (!contextResult.imageInputAdmissionEvidence) {
      throw new Error('expected image admission evidence from real Context Manager');
    }

    const durableMessages: LlmRequestMessage[] = formatAgentLlmMessages(contextResult.messages);
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry,
      workspaceResolver: createWorkspaceLlmImageResolver({
        verifiedImageLoader: createWorkspaceVerifiedImageLoader({
          db,
          storageBoundaries: [
            {
              boundaryRoot: appDataRoot,
              contentRoot: createConversationAttachmentStoragePaths(appDataRoot, STORE_ID)
                .contentRoot,
            },
          ],
          maxImagePixels: TEST_POLICY.maxImagePixels,
        }),
      }),
    });
    const resolvedMessages = await materializer.materialize({
      activeModelId,
      messages: durableMessages,
      admissionEvidence: contextResult.imageInputAdmissionEvidence,
    });

    expect(resolvedMessages).toMatchObject([
      {
        role: 'user',
        content: replayedUserEvent.content,
        attachments: [
          { mediaType: 'image/webp', bytes: secondSourceBytes },
          { mediaType: 'image/png', bytes: firstSourceBytes },
        ],
      },
    ]);

    const durableContextJson = JSON.stringify({
      replayedUserEvent,
      contextMessages: contextResult.messages,
      durableMessages,
    });
    expect(durableContextJson).not.toContain('data:image');
    expect(durableContextJson).not.toContain(';base64,');
    expect(durableContextJson).not.toContain(workspaceRoot);

    const storedAsset = db
      .prepare<[string], StoredAssetPathRow>(`SELECT local_path FROM assets WHERE id = ?`)
      .get('asset-first');
    if (!storedAsset?.local_path) throw new Error('fixture asset 缺少受管文件路径');
    expect(storedAsset.local_path).toContain(
      `${path.sep}ConversationAttachments${path.sep}v2${path.sep}stores${path.sep}${STORE_ID}${path.sep}content${path.sep}`
    );
    expect(path.relative(workspaceRoot, storedAsset.local_path).startsWith('..')).toBe(true);
    await fsp.writeFile(storedAsset.local_path, Buffer.from('corrupted'));
    await expect(
      rendererPreviewApi.loadImage('asset-first', new AbortController().signal)
    ).rejects.toMatchObject({
      code: 'conversation.image.asset_integrity_failed',
    });

    resetAgentRuntimeSingletonsForTest();
    store.close();
  });
});
