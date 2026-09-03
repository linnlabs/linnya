import { promises as fsp } from 'node:fs';
import { inspectImageBytes } from 'src/shared/media/image-inspection';
import type { LocalImageAssetFacts } from '../definitions/localImageAssetRegistration';
import { LocalImageAssetRegistrationError } from '../definitions/localImageAssetRegistration';
import { createLocalImageAssetUri } from '../functions/createLocalImageAssetUri';

/**
 * 在数据库事务外完成文件 I/O 与图片解码，产出可在短事务内登记的不可变事实。
 */
export async function prepareLocalImageAssetFacts(params: {
  readonly sourcePath: string;
  readonly createdAt?: string;
  readonly maxImagePixels: number;
}): Promise<LocalImageAssetFacts> {
  if (!Number.isSafeInteger(params.maxImagePixels) || params.maxImagePixels <= 0) {
    throw new LocalImageAssetRegistrationError(
      'invalid_pixel_limit',
      'maxImagePixels 必须是正安全整数',
    );
  }

  let stat;
  try {
    stat = await fsp.lstat(params.sourcePath);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new LocalImageAssetRegistrationError(
        'source_not_found',
        `生成图片不存在: ${params.sourcePath}`,
      );
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new LocalImageAssetRegistrationError(
      'source_not_file',
      `生成图片不是普通文件: ${params.sourcePath}`,
    );
  }

  const bytes = await fsp.readFile(params.sourcePath);
  const inspected = await inspectImageBytes({
    bytes,
    maxImagePixels: params.maxImagePixels,
  });
  const parsedCreatedAt = params.createdAt ? Date.parse(params.createdAt) : Number.NaN;

  return {
    uri: createLocalImageAssetUri(inspected),
    mediaType: inspected.mediaType,
    byteLength: inspected.byteLength,
    width: inspected.width,
    height: inspected.height,
    sha256: inspected.sha256,
    localPath: params.sourcePath,
    createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
  };
}
