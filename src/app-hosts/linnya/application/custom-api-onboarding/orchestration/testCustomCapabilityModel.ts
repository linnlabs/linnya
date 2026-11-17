import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CustomCapabilityModelCommand,
  CustomCapabilityTestResult,
} from '@app/schemas/custom-api-onboarding';
import { createEmbeddingPort, createRerankingPort } from 'src/app-hosts/linnya/adapters/inference';
import { createImageGenerationPort } from 'src/app-hosts/linnya/adapters/image-generation';
import { createDocumentOcrPort } from 'src/app-hosts/linnya/adapters/document-ocr';
import { EmbeddingFailure, RerankingFailure } from 'src/domains/model-inference';
import { ImageGenerationFailure } from 'src/domains/image-generation';
import { OcrProviderError } from 'src/domains/document-ocr';
import { buildCustomCapabilityRegistration } from '../functions/buildCustomCapabilityRegistration';
import {
  MODEL_CONNECTION_TEST_PDF,
  MODEL_CONNECTION_TEST_PNG,
} from '../definitions/modelConnectionTestDocument';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';

/** 连接测试走正式 Host port；临时目录不注册模型、不写凭据，也不改变用户的用途绑定。 */
export async function testCustomCapabilityModel(
  command: CustomCapabilityModelCommand,
  callerSignal: AbortSignal
): Promise<CustomCapabilityTestResult> {
  const { model } = buildCustomCapabilityRegistration(
    command,
    'connection-test',
    'connection-test'
  );
  const catalog = {
    async initialize() {},
    getModel: (id: string) => (id === model.id ? model : undefined),
    resolveCredential: () => command.api_key,
  };
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(120_000)]);
  let temporaryDirectory: string | undefined;
  try {
    if (model.embedding_route) {
      const result = await createEmbeddingPort({ catalog }).embed({
        modelId: model.id,
        values: ['Linnya model connection test'],
        signal,
      });
      return { message: `调用成功，返回 ${result.vectors[0].length} 维向量。配置尚未保存。` };
    }
    if (model.reranking_route) {
      const result = await createRerankingPort({ catalog }).rerank({
        modelId: model.id,
        query: 'apple fruit',
        documents: ['Apple is a fruit.', 'The train leaves at noon.'],
        topN: 2,
        signal,
      });
      return { message: `调用成功，返回 ${result.ranking.length} 条重排结果。配置尚未保存。` };
    }
    if (model.image_generation_route) {
      const result = await createImageGenerationPort({
        catalog,
        credentialResolver: {
          async resolve() {
            if (!command.api_key) throw new Error('Missing test credential');
            return { profile: 'bearer', secret: command.api_key };
          },
        },
      }).generate({
        modelId: model.id,
        prompt: 'A small green circle on a plain white background.',
        size: command.image_sizes?.[0] ?? '1024x1024',
        count: 1,
        signal,
      });
      return { message: `调用成功，返回 ${result.images.length} 张图片。配置尚未保存。` };
    }
    if (!model.document_ocr_route) throw new Error('Unsupported test capability');
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'linnya-model-test-'));
    const pdfPath = path.join(temporaryDirectory, 'sample.pdf');
    await writeFile(pdfPath, Buffer.from(MODEL_CONNECTION_TEST_PDF, 'base64'));
    const input =
      model.document_ocr_route.mode === 'document_upload'
        ? { kind: 'pdf_path' as const, path: pdfPath }
        : {
            kind: 'image_base64' as const,
            base64: MODEL_CONNECTION_TEST_PNG,
            mimeType: 'image/png' as const,
            pageNumber: 1,
          };
    const result = await createDocumentOcrPort({ catalog }).recognizeDocument({
      modelId: model.id,
      input,
      options: { signal },
    });
    if (!result.pages.some(page => page.markdown.trim())) {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.registration_failed',
        '服务已响应，但未识别出示例文字，请检查模型与接口格式',
        422
      );
    }
    return { message: `调用成功，识别出 ${result.pages.length} 页内容。配置尚未保存。` };
  } catch (error: unknown) {
    if (error instanceof CustomApiOnboardingError) throw error;
    let detail = '请检查 API 地址、模型 ID 和接口格式';
    if (signal.aborted) detail = callerSignal.aborted ? '测试已取消' : '测试超时，请检查服务状态';
    else if (
      error instanceof EmbeddingFailure ||
      error instanceof RerankingFailure ||
      error instanceof ImageGenerationFailure
    ) {
      detail =
        error.kind === 'protocol'
          ? '服务响应与所选接口格式不匹配，请确认模型类型和 API 格式'
          : '服务拒绝了请求或网络不可用，请检查 API Key、地址和模型 ID';
    } else if (error instanceof OcrProviderError) {
      detail =
        error.statusCode === 401 || error.statusCode === 403
          ? 'OCR 服务鉴权失败，请检查 API Key'
          : 'OCR 服务响应异常，请确认 Paddle 接口格式与地址';
    }
    throw new CustomApiOnboardingError('custom_api_onboarding.registration_failed', detail, 422);
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
