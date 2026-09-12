import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeResourceRef } from '@linnlabs/linnkit/contracts';
import type {
  CanonicalInferencePort,
  CanonicalInferenceRequest,
  LlmInputMaterializationAttempt,
  LlmRequestMessage,
} from '@linnlabs/linnkit/ports';
import { LLM_IMAGE_INPUT_ERROR_CODES, llm } from '@linnlabs/linnkit/runtime-kernel';
import { LANGUAGE_INFERENCE_CAPABILITY_IDS } from '@app/schemas/model-inference';
import type { ModelConfig } from 'src/domains/model-catalog';
import {
  createWorkspaceLlmImageResolver,
  type WorkspaceLlmImageResolverPort,
} from 'src/features/workspace/assets/features/llm-image-resolution';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';

const getModel = vi.hoisted(() => vi.fn<(id: string) => ModelConfig | undefined>());
vi.mock('src/domains/model-catalog', () => ({ modelCatalog: { getModel } }));

import {
  collectDurableImageInputs,
  createWorkspaceLlmInputMaterializer,
  defaultImageInputProcessingProfileRegistry as registry,
} from '../index';

const MODEL_ID = 'fixture-deepseek';
const MIB = 1024 * 1024;
const roots: string[] = [];
const databases: Database.Database[] = [];

beforeEach(() => {
  getModel.mockReset();
  getModel.mockImplementation(id => id === MODEL_ID ? {
    id,
    model_name: 'deepseek-flash',
    catalog_source: 'default',
    capabilities: ['chat', 'image_input'],
    ui_visibility: ['chat'],
    display_name: 'DeepSeek fixture',
    description: 'Dedicated route materialization fixture',
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: LANGUAGE_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT,
      auth_profile: 'bearer',
      endpoint_id: 'deepseek',
      endpoint_model_id: 'deepseek-flash',
      base_url: 'https://fixture.invalid',
      context_window_tokens: 1_048_576,
      max_output_tokens: 4_096,
      input_support: { user_image: true, tool_result_image: true },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  } : undefined);
});

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

function createAttempt(references: RuntimeResourceRef[], inputBudget = 1_000_000): LlmInputMaterializationAttempt {
  const messages: LlmRequestMessage[] = [
    { role: 'user', content: '对比用户图片与工具截图。', attachments: references.slice(0, 1) },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'read-image', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'read-image', content: '图片已读取。', attachments: references.slice(1) },
  ];
  const estimates = collectDurableImageInputs(messages).map(input => ({
    input,
    estimate: registry.estimateImageInput(MODEL_ID, { ...input.reference, placement: input.placement }),
  }));
  const firstEstimate = estimates[0];
  if (!firstEstimate) throw new Error('Expected at least one image fixture.');
  return {
    activeModelId: MODEL_ID,
    messages,
    admissionEvidence: {
      inputBudget,
      nonImageEstimatedTokens: 40,
      initialProfileId: firstEstimate.estimate.profileId,
      attachments: estimates.map(({ input, estimate }) => ({
        messageIndex: input.messageIndex,
        attachmentIndex: input.attachmentIndex,
        id: input.reference.id,
        resourceId: input.reference.resourceId,
        placement: input.placement,
        estimatedTokens: estimate.estimatedTokens,
      })),
    },
  };
}

function references(count: number, fields: Partial<Pick<RuntimeResourceRef, 'byteLength' | 'width' | 'height'>> = {}): RuntimeResourceRef[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `attachment-${index}`,
    kind: 'image',
    resourceId: `asset-${index}`,
    mediaType: 'image/png',
    byteLength: 120,
    width: 16,
    height: 8,
    sha256: 'a'.repeat(64),
    ...fields,
  }));
}

function createObservedMaterializer() {
  const resolveImages = vi.fn<WorkspaceLlmImageResolverPort['resolveImages']>(async inputs => inputs.map(input => ({
    id: input.id,
    resourceId: input.resourceId,
    mediaType: input.mediaType,
    byteLength: input.byteLength,
    width: input.width,
    height: input.height,
    bytes: Uint8Array.of(1),
  })));
  return {
    resolveImages,
    materializer: createWorkspaceLlmInputMaterializer({
      profileRegistry: registry,
      workspaceResolver: { resolveImages },
    }),
  };
}

async function createVerifiedAssetFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-deepseek-materialization-'));
  roots.push(root);
  const contentRoot = path.join(root, 'content');
  await fsp.mkdir(contentRoot);
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE assets (
    id TEXT PRIMARY KEY, media_type TEXT, size_bytes INTEGER, width_px INTEGER,
    height_px INTEGER, sha256 TEXT, storage_status TEXT NOT NULL, local_path TEXT
  )`);
  const assets = await Promise.all((['jpeg', 'png', 'webp'] as const).map(async (format, index) => {
    const width = 16 + index;
    const height = 8;
    const bytes = await sharp({ create: {
      width, height, channels: 3, background: { r: 20, g: 80, b: 140 },
    } }).toFormat(format).toBuffer();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const localPath = path.join(contentRoot, `${sha256}.${format}`);
    await fsp.writeFile(localPath, bytes);
    const reference: RuntimeResourceRef = {
      id: `verified-attachment-${index}`,
      kind: 'image',
      resourceId: `verified-asset-${index}`,
      mediaType: `image/${format}`,
      byteLength: bytes.length,
      width,
      height,
      sha256,
    };
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      reference.resourceId, reference.mediaType, bytes.length, width, height, sha256, 'local', localPath,
    );
    return { reference, bytes, localPath };
  }));
  const resolver = createWorkspaceLlmImageResolver({
    verifiedImageLoader: createWorkspaceVerifiedImageLoader({
      db,
      storageBoundaries: [{ boundaryRoot: root, contentRoot }],
      maxImagePixels: 1_000_000,
    }),
  });
  return { assets, resolver, db };
}

describe('DeepSeek 默认 route 的图片 materialization 业务闭环', () => {
  it('真实三种图片经资产核验进入 LlmCaller，保留 user/tool 顺序；资产损坏不产生第二次 Provider 请求', async () => {
    const fixture = await createVerifiedAssetFixture();
    const attempt = createAttempt(fixture.assets.map(asset => asset.reference));
    expect(attempt.admissionEvidence.attachments.map(image => image.estimatedTokens)).toEqual([1024, 1024, 1024]);
    const requests: CanonicalInferenceRequest[] = [];
    const inferencePort: CanonicalInferencePort = {
      async *stream(request) {
        requests.push(request);
        yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
        yield { type: 'answer_delta', text: '已比较图片。' };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const model: llm.ModelCatalogEntry = {
      id: MODEL_ID,
      enabled: true,
      capabilities: ['chat', 'image_input'],
      adapter_input_support: { user_image: true, tool_result_image: true },
    };
    const caller = new llm.LlmCaller({
      inferencePort,
      modelCatalog: {
        getModelById: id => id === MODEL_ID ? model : undefined,
        getModelsByCapability: capability => model.capabilities?.includes(capability) ? [model] : [],
        getModelsByUIVisibility: () => [],
      },
      llmInputMaterializer: createWorkspaceLlmInputMaterializer({
        profileRegistry: registry,
        workspaceResolver: fixture.resolver,
      }),
    });
    const call = () => caller.call(MODEL_ID, [...attempt.messages], {}, undefined, {
      imageInputAdmissionEvidence: attempt.admissionEvidence,
    });
    await call();
    expect(requests).toHaveLength(1);
    const [userImage, ...toolImages] = fixture.assets.map(asset => ({
      type: 'image', media_type: asset.reference.mediaType, bytes: asset.bytes,
    }));
    expect(requests[0]?.messages.find(message => message.role === 'user')).toEqual({
      role: 'user', content: [{ type: 'text', text: '对比用户图片与工具截图。' }, userImage],
    });
    expect(requests[0]?.messages.find(message => message.role === 'tool')).toEqual({
      role: 'tool', tool_call_id: 'read-image',
      content: [{ type: 'text', text: '图片已读取。' }, ...toolImages],
    });
    // exact equality 同时保证 Provider content 不泄露 durable id、resourceId、hash 或物理路径。
    const corrupted = fixture.assets[1];
    if (!corrupted) throw new Error('Expected a tool image fixture.');
    await fsp.writeFile(corrupted.localPath, Buffer.alloc(corrupted.bytes.length));
    await expect(call()).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
      metadata: { placement: 'tool_result_image', attachment_id: corrupted.reference.id },
    });
    expect(requests).toHaveLength(1);
  });

  it('声明尺寸通过 route 门禁仍须核验实际图片，不能只信 durable ref 与资产账本', async () => {
    const fixture = await createVerifiedAssetFixture();
    const asset = fixture.assets[0];
    if (!asset) throw new Error('Expected a verified asset fixture.');
    const reference = { ...asset.reference, width: asset.reference.width - 1 };
    // 同时篡改隔离测试账本和引用，使失败只能来自实际图片解码后的尺寸复核。
    fixture.db.prepare('UPDATE assets SET width_px = ? WHERE id = ?').run(reference.width, reference.resourceId);
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: registry,
      workspaceResolver: fixture.resolver,
    });
    await expect(materializer.materialize(createAttempt([reference]))).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
      message: 'Workspace image resolution failed: dimensions_mismatch',
      metadata: { attachment_id: reference.id, placement: 'user_image' },
    });
  });

  it('整次请求接受 600 图，第 601 图在读取 bytes 前拒绝', async () => {
    const { materializer, resolveImages } = createObservedMaterializer();
    await materializer.materialize(createAttempt(references(600)));
    await expect(materializer.materialize(createAttempt(references(601)))).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      metadata: { limit_kind: 'image_count', actual_value: 601, limit_value: 600 },
    });
    expect(resolveImages).toHaveBeenCalledOnce();
  });

  it.each([
    { count: 1, height: 8192, rejectedHeight: 8193, limit: 8192 },
    { count: 15, height: 4096, rejectedHeight: 4097, limit: 4096 },
  ])('$count 图每边 $limit px 边界先于 bytes 读取检查', async ({ count, height, rejectedHeight, limit }) => {
    const { materializer, resolveImages } = createObservedMaterializer();
    await materializer.materialize(createAttempt(references(count, { height })));
    await expect(materializer.materialize(createAttempt(references(count, { height: rejectedHeight })))).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      message: 'Image edge pixels exceed the active route limit for this request image count.',
      metadata: { actual_value: rejectedHeight, limit_value: limit },
    });
    expect(resolveImages).toHaveBeenCalledOnce();
  });

  it('第 15 张工具图片使历史用户图片也按 4096 px 重检，不能按 message 分开计算', async () => {
    const { materializer, resolveImages } = createObservedMaterializer();
    const images = references(15);
    images[0] = { ...images[0], width: 8192 };
    await materializer.materialize(createAttempt(images.slice(0, 14)));
    await expect(materializer.materialize(createAttempt(images))).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      metadata: { placement: 'user_image', actual_value: 8192, limit_value: 4096 },
    });
    expect(resolveImages).toHaveBeenCalledOnce();
  });

  it.each([
    { count: 1, bytes: 32 * MIB, kind: 'single_image_bytes', actual: 32 * MIB + 1 },
    { count: 2, bytes: 16 * MIB, kind: 'total_image_bytes', actual: 32 * MIB + 2 },
  ])('$kind 超限在 bytes 读取前拒绝，不把 48 MiB wire body 误作 raw 总额', async ({ count, bytes, kind, actual }) => {
    const { materializer, resolveImages } = createObservedMaterializer();
    await materializer.materialize(createAttempt(references(count, { byteLength: bytes })));
    await expect(materializer.materialize(createAttempt(references(count, { byteLength: bytes + 1 })))).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      metadata: { limit_kind: kind, actual_value: actual, limit_value: 32 * MIB },
    });
    expect(resolveImages).toHaveBeenCalledOnce();
  });

  it('小图也以官方每图 1024 token 上界重算，不能复用较小的旧 profile admission 估计', async () => {
    const { materializer, resolveImages } = createObservedMaterializer();
    const attempt = createAttempt(references(2, { width: 1, height: 1 }), 2088);
    await materializer.materialize(attempt);
    await expect(materializer.materialize({
      ...attempt,
      admissionEvidence: {
        ...attempt.admissionEvidence,
        inputBudget: 2087,
        initialProfileId: 'old-profile',
        attachments: attempt.admissionEvidence.attachments.map(image => ({ ...image, estimatedTokens: 1 })),
      },
    })).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
      metadata: { actual_value: 2088, limit_value: 2087 },
    });
    expect(resolveImages).toHaveBeenCalledOnce();
  });
});
