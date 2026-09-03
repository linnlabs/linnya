import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  imageFileExtensionForMediaType,
  inspectImageBytes,
} from 'src/shared/media/image-inspection';
import {
  GeneratedImagePublicationError,
  type PublishGeneratedImageInput,
  type SavedGeneratedImageInfo,
} from '../definitions/generatedImagePublication';

function assertPublicationPolicy(input: PublishGeneratedImageInput): void {
  if (
    !Number.isSafeInteger(input.policy.maxImageBytes)
    || input.policy.maxImageBytes <= 0
    || !Number.isSafeInteger(input.policy.maxImagePixels)
    || input.policy.maxImagePixels <= 0
  ) {
    throw new GeneratedImagePublicationError(
      'invalid_policy',
      '生成图片发布策略必须包含正安全整数形式的字节和像素上限。',
    );
  }
}

function generatedImageStem(createdAt: Date): string {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
  // n > 1 时多张图可能在同一毫秒落盘；随机身份用于防止合法结果互相覆盖。
  return `generated_image_${timestamp}_${randomUUID()}`;
}

/**
 * 在暴露 conversation 路径前完成真实解码、媒体身份确定和元数据发布。
 * 原始编码保持不变；JPEG 不会为了匹配历史 `.png` 命名而被无意义转码。
 */
export async function publishGeneratedImage(
  input: PublishGeneratedImageInput,
): Promise<SavedGeneratedImageInfo> {
  assertPublicationPolicy(input);
  if (input.bytes.byteLength > input.policy.maxImageBytes) {
    throw new GeneratedImagePublicationError(
      'image_too_large',
      `生成图片字节数超过限制: actual=${input.bytes.byteLength}, max=${input.policy.maxImageBytes}`,
    );
  }

  // 必须先建立媒体事实再生成文件名；来源 URL、响应头和扩展名都不是可信身份。
  const inspected = await inspectImageBytes({
    bytes: input.bytes,
    maxImagePixels: input.policy.maxImagePixels,
  });
  const createdAt = new Date();
  const stem = generatedImageStem(createdAt);
  const extension = imageFileExtensionForMediaType(inspected.mediaType);
  const fileName = `${stem}.${extension}`;
  const metadataFileName = `${stem}_metadata.json`;
  const filePath = path.join(input.outputDir, fileName);
  const metadataPath = path.join(input.outputDir, metadataFileName);
  const savedInfo: SavedGeneratedImageInfo = {
    filePath,
    fileName,
    mediaType: inspected.mediaType,
    byteLength: inspected.byteLength,
    width: inspected.width,
    height: inspected.height,
    sha256: inspected.sha256,
    originalPrompt: input.originalPrompt,
    ...(input.revisedPrompt ? { revisedPrompt: input.revisedPrompt } : {}),
    createdAt: createdAt.toISOString(),
    model: input.model,
  };

  await fsp.mkdir(input.outputDir, { recursive: true });
  await fsp.writeFile(filePath, input.bytes, { flag: 'wx' });
  try {
    await fsp.writeFile(metadataPath, JSON.stringify(savedInfo, null, 2), { flag: 'wx' });
  } catch (error) {
    // 图片和元数据共同构成一次发布；元数据失败时撤回本次尚未对外暴露的新文件。
    await fsp.rm(filePath, { force: true });
    throw error;
  }

  return Object.freeze(savedInfo);
}
