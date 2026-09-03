import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { createUserInputEvent } from 'linnkit/contracts';
import type {
  LlmInputMaterializationAttempt,
  LlmInputMaterializerPort,
  ResolvedLlmInputMessage,
} from 'linnkit/ports';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createNodePhysicalFileReader } from 'src/app-hosts/linnya/adapters/file-read';
import {
  createImageInputProcessingProfileRegistry,
  createWorkspaceLlmInputMaterializer,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createInMemoryToolResultAssetClaimRegistry } from 'src/domains/assets/features/tool-result-claims';
import { createManagedImageStoragePaths } from 'src/domains/assets/shared/managed-image-storage';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { createWorkspaceLlmImageResolver } from 'src/features/workspace/assets/features/llm-image-resolution';
import { createWorkspaceToolModelInputResolver } from 'src/features/workspace/assets/features/tool-model-input';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import {
  ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE,
  OPENAI_RESPONSES_IMAGE_INPUT_PROFILE,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import type { ToolContext } from 'src/tools/types';
import { createGraphLoopHarness } from '../graphLoopHarness';
import {
  assertToolImageAiSdkInput,
  createToolImageModelCatalog,
  createToolImageWorkspaceDatabase,
  findSuccessfulToolOutput,
  type ToolImageProviderSurface,
} from '../toolImageIntegrationFixtures';

const STORE_ID = '791cf8b2-b05e-41b0-b74b-a9639f58eb75';

describe.each<ToolImageProviderSurface>(['openai_responses', 'anthropic_messages'])(
  'Conversation file image agent loop: %s',
  (surface) => {
    it('从对话目录图片进入受管副本，原图删除后仍可物化、回放且不进入项目资源库', async () => {
    const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-conversation-file-loop-'));
      const appDataRoot = path.join(testRoot, 'app-data');
      const conversationRoot = path.join(testRoot, 'conversation-root');
      const sourcePath = path.join(
        conversationRoot,
        'slides-renders',
        'run-1',
        'slide-001.png',
      );
      const databasePath = path.join(testRoot, 'workspace.sqlite');
      const conversationId = `conversation-file-conv-${surface}`;
      const turnId = `conversation-file-turn-${surface}`;
      const projectId = `conversation-file-project-${surface}`;
      const modelId = `conversation-file-model-${surface}`;
      const toolCallId = `conversation-file-call-${surface}`;
      const db = createToolImageWorkspaceDatabase(databasePath);
      let store: SQLiteEventStore | undefined = new SQLiteEventStore(db);

      try {
        const bytes = await sharp({
          create: {
            width: 8,
            height: 5,
            channels: 4,
            background: { r: 210, g: 55, b: 72, alpha: 1 },
          },
        }).png().toBuffer();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        await fsp.mkdir(path.dirname(sourcePath), { recursive: true });
        await fsp.writeFile(sourcePath, bytes);
        await fsp.mkdir(appDataRoot, { recursive: true });
        db.prepare('INSERT INTO projects (id) VALUES (?)').run(projectId);

        const seed = createUserInputEvent(
          `conversation-file-seed-${surface}`,
          conversationId,
          `conversation-file-seed-turn-${surface}`,
          '请读取刚刚渲染的第一张幻灯片',
        );
        await store.ensureConversation(conversationId, [seed], projectId, 'agent');

        const claims = createInMemoryToolResultAssetClaimRegistry({
          createClaimId: () => `conversation-file-claim-${surface}`,
        });
        const imageIngress = createManagedImageIngress({
          appDataRoot,
          storeId: STORE_ID,
          maxImageBytes: 1_000_000,
          maxImagePixels: 1_000_000,
          ledger: createSqliteLocalImageAssetLedger({
            db,
            createAssetId: () => `conversation-file-asset-${surface}`,
          }),
          createStagingId: () => `conversation-file-staging-${surface}`,
        });
        const conversationAdmission: ConversationWorkDirectoryAdmissionPort = {
          withAdmission: async (input, admitted) => {
            expect(input.conversationId).toBe(conversationId);
            return admitted({
              identity: deriveConversationWorkDirectoryIdentity(conversationId),
              absolutePath: conversationRoot,
              status: 'existing',
            });
          },
        };
        const physicalFileReader = createNodePhysicalFileReader();
        const managedPaths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
        const verifiedImageLoader = createWorkspaceVerifiedImageLoader({
          db,
          storageBoundaries: [{
            boundaryRoot: appDataRoot,
            contentRoot: managedPaths.contentRoot,
          }],
          maxImagePixels: 1_000_000,
        });
        const profile = surface === 'openai_responses'
          ? OPENAI_RESPONSES_IMAGE_INPUT_PROFILE
          : ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE;
        const profileRegistry = createImageInputProcessingProfileRegistry({
          resolveRouteForModel: activeModelId => activeModelId === modelId ? surface : undefined,
          bindings: [{ route: surface, profile }],
        });
        const workspaceMaterializer = createWorkspaceLlmInputMaterializer({
          profileRegistry,
          workspaceResolver: createWorkspaceLlmImageResolver({ verifiedImageLoader }),
        });
        let materializationAttempt: LlmInputMaterializationAttempt | undefined;
        let providerMessages: readonly ResolvedLlmInputMessage[] | undefined;
        const llmInputMaterializer: LlmInputMaterializerPort = {
          async materialize(attempt) {
            materializationAttempt = attempt;
            const messages = await workspaceMaterializer.materialize(attempt);
            providerMessages = messages;
            return messages;
          },
        };
        const harness = createGraphLoopHarness({
          conversationId,
          turnId,
          query: '请读取刚刚生成的第一张图片。',
          tools: [new ReadFileTool()],
          requestPatch: { model_id: modelId },
          toolContextPatch: {
            databaseService: {
              getDb: () => db,
            } as unknown as ToolContext['databaseService'],
            workspaceProjectId: projectId,
            physicalFileReader,
            conversationWorkDirectoryAdmission: conversationAdmission,
            managedImageIngress: imageIngress,
            toolResultAssetClaims: claims,
          },
          modelInput: {
            modelCatalog: createToolImageModelCatalog(modelId),
            imageInputEstimator: profileRegistry,
            llmInputMaterializer,
            toolModelInputResolver: createWorkspaceToolModelInputResolver({
              db,
              verifiedImageLoader,
              toolResultClaims: claims,
            }),
          },
          turns: [
            {
              toolCalls: [{
                id: toolCallId,
                name: 'read_file',
                argumentsJson: JSON.stringify({
                  locator: 'conversation:/slides-renders/run-1/slide-001.png',
                }),
              }],
            },
            { contentChunks: ['我已读取第一张幻灯片并完成回答。'] },
          ],
        });

        const result = await (async () => {
          try {
            const runResult = await harness.run();
            harness.assertAllTurnsConsumed();
            return runResult;
          } finally {
            harness.restore();
          }
        })();
        const toolOutput = findSuccessfulToolOutput(result.events.filter(event => (
          event.type !== 'tool_output' || event.tool_call_id === toolCallId
        )));
        expect(toolOutput).toMatchObject({
          tool_name: 'read_file',
          tool_call_id: toolCallId,
          attachments: [{
            resourceId: `conversation-file-asset-${surface}`,
            sha256,
          }],
        });
        const imageToolMessage = providerMessages?.find(message => (
          message.role === 'tool'
          && 'attachments' in message
          && Array.isArray(message.attachments)
          && message.attachments.length > 0
        ));
        const providerAttachments = imageToolMessage && 'attachments' in imageToolMessage
          ? imageToolMessage.attachments
          : undefined;
        expect(providerAttachments).toEqual([
          expect.objectContaining({ placement: 'tool_result_image', bytes }),
        ]);
        expect(materializationAttempt).toBeDefined();

        const assetRow = db.prepare<[string], { readonly local_path: string }>(`
          SELECT local_path
          FROM assets
          WHERE id = ?
        `).get(`conversation-file-asset-${surface}`);
        expect(assetRow?.local_path).toBe(path.join(
          managedPaths.contentRoot,
          sha256.slice(0, 2),
          `${sha256}.png`,
        ));
        expect(assetRow?.local_path).not.toBe(sourcePath);

        await fsp.rm(sourcePath);
        if (!materializationAttempt) {
          throw new Error('expected durable materialization attempt on the second LLM turn');
        }
        const rematerialized = await workspaceMaterializer.materialize(materializationAttempt);
        await assertToolImageAiSdkInput({
          surface,
          modelId,
          inputMessages: materializationAttempt.messages,
          messages: rematerialized,
          admissionEvidence: materializationAttempt.admissionEvidence,
          expectedBase64: bytes.toString('base64'),
        });

        const session = await store.beginRunSession(conversationId, turnId, { kind: 'agent' });
        await store.appendEventToRun(session, toolOutput);
        expect(db.prepare(`
          SELECT asset_id, source
          FROM conversation_event_asset_links
          WHERE event_id = ?
        `).all(toolOutput.id)).toEqual([{
          asset_id: `conversation-file-asset-${surface}`,
          source: 'tool_output',
        }]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM project_asset_links').get()).toEqual({ count: 0 });

        store.close();
        store = undefined;
        const reopenedStore = new SQLiteEventStore(new Database(databasePath));
        const replay = await reopenedStore.readEvents(conversationId, {
          direction: 'forward',
          limit: 20,
        });
        expect(findSuccessfulToolOutput(replay.events.filter(event => (
          event.type !== 'tool_output' || event.tool_call_id === toolCallId
        ))).attachments).toEqual(toolOutput.attachments);
        reopenedStore.close();
      } finally {
        store?.close();
        await fsp.rm(testRoot, { recursive: true, force: true });
      }
    });
  },
);
