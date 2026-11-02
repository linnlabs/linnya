import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { createNodePhysicalFileReader } from 'src/app-hosts/linnya/adapters/file-read';
import {
  CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE,
  createImageInputProcessingProfileRegistry,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import type { ToolContext } from 'src/tools/types';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import { createGraphLoopHarness } from '../graphLoopHarness';
import { createToolImageModelCatalog, findSuccessfulToolOutput } from '../toolImageIntegrationFixtures';

describe('Conversation file image agent loop without tool result images', () => {
  it('读图降级为尺寸元数据，run 继续且不登记受管副本', async () => {
    const conversationRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-read-image-metadata-'));
    const conversationId = 'read-image-metadata-conv';
    const modelId = 'read-image-metadata-model';
    const toolCallId = 'read-image-metadata-call';
    const ingestLocalImage = vi.fn();
    const issueClaims = vi.fn();
    const visionCatalog = createToolImageModelCatalog(modelId);
    const visionModel = visionCatalog.getModelById(modelId)!;
    const profileRegistry = createImageInputProcessingProfileRegistry({
      resolveRouteForModel: () => 'openai_chat_completions',
      bindings: [{ route: 'openai_chat_completions', profile: CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE }],
    });
    const model = {
      ...visionModel,
      adapter_input_support: { user_image: true, tool_result_image: false },
    };

    try {
      await fsp.writeFile(
        path.join(conversationRoot, 'slide.png'),
        await sharp({
          create: { width: 8, height: 5, channels: 4, background: { r: 210, g: 55, b: 72, alpha: 1 } },
        }).png().toBuffer(),
      );
      const harness = createGraphLoopHarness({
        conversationId,
        turnId: 'read-image-metadata-turn',
        query: '请读取这张图。',
        tools: [new ReadFileTool()],
        requestPatch: { model_id: modelId },
        toolContextPatch: {
          physicalFileReader: createNodePhysicalFileReader(),
          conversationWorkDirectoryAdmission: {
            withAdmission: async (
              _input: unknown,
              admitted: (directory: unknown) => unknown,
            ) => admitted({
              identity: deriveConversationWorkDirectoryIdentity(conversationId),
              absolutePath: conversationRoot,
              status: 'existing',
            }),
          },
          managedImageIngress: { ingestLocalImage },
          toolResultAssetClaims: { issueClaims, consumeClaims: vi.fn(() => []), releaseClaims: vi.fn() },
        } as unknown as Partial<ToolContext>,
        modelInput: {
          modelCatalog: {
            getModelById: id => (id === modelId ? model : undefined),
            getModelsByCapability: () => [model],
            getModelsByUIVisibility: () => [model],
          },
          imageInputEstimator: profileRegistry,
          llmInputMaterializer: { materialize: vi.fn() },
          toolModelInputResolver: { resolveToolModelInput: vi.fn(async () => []), completeToolModelInput: vi.fn(async () => undefined) },
        },
        turns: [
          {
            toolCalls: [{
              id: toolCallId,
              name: 'read_file',
              argumentsJson: JSON.stringify({ locator: 'conversation:/slide.png' }),
            }],
          },
          { contentChunks: ['这张图我没有看到像素。'] },
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

      const toolOutput = findSuccessfulToolOutput(result.events);
      expect(toolOutput).toMatchObject({ tool_name: 'read_file', tool_call_id: toolCallId });
      expect(toolOutput).not.toHaveProperty('attachments');
      expect(toolOutput.observation).toContain('没有看到像素');
      expect(ingestLocalImage).not.toHaveBeenCalled();
      expect(issueClaims).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(conversationRoot, { recursive: true, force: true });
    }
  });
});
