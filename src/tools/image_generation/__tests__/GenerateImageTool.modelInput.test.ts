import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerationResultSchema } from '@app/schemas';
import { ToolCallIdSchema } from 'linnkit/contracts';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { generateAndPublishImages } from 'src/app-hosts/linnya/application/image-generation';
import { GenerateImageTool } from '../GenerateImageTool';
import { ImageGenerationModelNotConfiguredError } from '../definitions/imageGenerationToolFailure';
import type { ToolContext } from '../../types';

vi.mock('src/app-hosts/linnya/application/image-generation', () => ({
  generateAndPublishImages: vi.fn(),
}));

const generateImages = vi.mocked(generateAndPublishImages);
const conversationId = 'conversation-generate-image';
const conversationRoot = path.join('/tmp', conversationId);
const requirement = {
  requires_image_input: true,
  placements: ['tool_result_image'] as const,
};
const savedImage = {
  filePath: path.join(conversationRoot, 'generated-images', 'image.png'),
  fileName: 'image.png',
  mediaType: 'image/png' as const,
  byteLength: 128,
  width: 32,
  height: 18,
  sha256: 'a'.repeat(64),
  originalPrompt: 'draw a lighthouse',
  createdAt: '2026-08-17T00:00:00.000Z',
  model: 'configured-image-model',
};

function createContext(input: {
  readonly admitted: boolean;
  readonly includeClaims?: boolean;
}): ToolContext {
  const context: ToolContext = {
    conversationId,
    parentToolCallId: ToolCallIdSchema.parse('call-generate-image'),
    imageGenerationModelId: 'configured-image-model',
    modelInputAdmission: {
      requirement,
      delivery: 'when_supported',
      admitted: input.admitted,
    },
    conversationWorkDirectoryAdmission: {
      async withAdmission(_request, admitted) {
        return admitted({
          identity: deriveConversationWorkDirectoryIdentity(conversationId),
          absolutePath: conversationRoot,
          status: 'existing',
        });
      },
    },
  };

  if (input.includeClaims) {
    context.managedImageIngress = {
      ingestLocalImage: vi.fn().mockResolvedValue({
        assetId: 'asset-generated-image',
        uri: 'asset://assets/asset-generated-image',
        mediaType: 'image/png',
        byteLength: savedImage.byteLength,
        width: savedImage.width,
        height: savedImage.height,
        sha256: savedImage.sha256,
        localPath: '/managed/asset-generated-image.png',
        createdAt: Date.parse(savedImage.createdAt),
      }),
    };
    context.toolResultAssetClaims = {
      issueClaims: vi.fn(() => [
        {
          selectionId: 'generate-image:asset-generated-image',
          uri: 'tool-result-asset-claim://claim-generated-image',
        },
      ]),
      consumeClaims: vi.fn(() => []),
      releaseClaims: vi.fn(),
    };
  }

  return context;
}

describe('GenerateImageTool model input delivery', () => {
  beforeEach(() => {
    generateImages.mockReset();
    generateImages.mockResolvedValue([savedImage]);
  });

  it('未选择图片生成模型时在工作目录与 Provider 调用前明确失败', async () => {
    const tool = new GenerateImageTool();

    const execution = tool.run({ prompt: 'draw a lighthouse' }, {});
    await expect(execution).rejects.toBeInstanceOf(ImageGenerationModelNotConfiguredError);
    await expect(execution).rejects.toThrow('尚未配置图片生成模型，请提醒用户配置。');
    expect(generateImages).not.toHaveBeenCalled();
  });

  it('非视觉模型生成成功时只返回文字、locator 与 Renderer media，不登记模型附件', async () => {
    const tool = new GenerateImageTool();
    const context = createContext({ admitted: false });

    const output = ImageGenerationResultSchema.parse(
      JSON.parse(
        await tool.run(
          {
            prompt: 'draw a lighthouse',
          },
          context
        )
      )
    );

    expect(output.data).toBe('conversation:/generated-images/image.png');
    expect(output.media).toHaveLength(1);
    expect(output.modelInput).toBeUndefined();
  });

  it('视觉模型生成成功时登记受管副本并声明同一工具结果图片', async () => {
    const tool = new GenerateImageTool();
    const context = createContext({ admitted: true, includeClaims: true });

    const output = ImageGenerationResultSchema.parse(
      JSON.parse(
        await tool.run(
          {
            prompt: 'draw a lighthouse',
          },
          context
        )
      )
    );

    expect(context.managedImageIngress?.ingestLocalImage).toHaveBeenCalledWith({
      sourcePath: savedImage.filePath,
      createdAt: savedImage.createdAt,
    });
    expect(output.modelInput?.attachments).toEqual([
      {
        id: 'generate-image:asset-generated-image',
        uri: 'tool-result-asset-claim://claim-generated-image',
      },
    ]);
  });
});
