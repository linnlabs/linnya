import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type {
  ManagedContentPendingPublish,
  ManagedImageWritableStoragePaths,
} from '../definitions/managedImageStorage';
import { ManagedContentPublishError } from '../definitions/managedImageStorage';

interface PendingPublishReceiptV1 {
  readonly version: 1;
  readonly contentRelativePath: string;
  readonly expectedSha256: string;
}

const PUBLISH_ID_PATTERN = /^[0-9a-zA-Z_-]{1,200}$/;

function createPendingReceipt(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly publishId: string;
  readonly finalPath: string;
  readonly expectedSha256: string;
}): { readonly receiptPath: string; readonly contents: string } {
  if (!PUBLISH_ID_PATTERN.test(params.publishId)) {
    throw new Error('Managed image publish requires a safe publish identity');
  }
  const relativePath = path.relative(params.paths.contentRoot, params.finalPath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error('Managed image publish target escapes its content root');
  }
  const receipt: PendingPublishReceiptV1 = {
    version: 1,
    contentRelativePath: relativePath.split(path.sep).join('/'),
    expectedSha256: params.expectedSha256,
  };
  return {
    receiptPath: path.join(params.paths.pendingRoot, `${params.publishId}.json`),
    contents: `${JSON.stringify(receipt)}\n`,
  };
}

async function writeDurableReceipt(receiptPath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(receiptPath), { recursive: true });
  const handle = await fsp.open(receiptPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * 发布已复核的 staging 文件。hard link 提供不覆盖语义；并发命中既有内容时重新验证 hash。
 */
export async function publishStagedManagedContent(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly publishId: string;
  readonly stagingPath: string;
  readonly finalPath: string;
  readonly expectedSha256: string;
}): Promise<ManagedContentPendingPublish> {
  const receipt = createPendingReceipt(params);
  await writeDurableReceipt(receipt.receiptPath, receipt.contents);
  await fsp.mkdir(path.dirname(params.finalPath), { recursive: true });
  try {
    await fsp.link(params.stagingPath, params.finalPath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
      await fsp.rm(receipt.receiptPath, { force: true });
      throw error;
    }
    const existingBytes = await fsp.readFile(params.finalPath);
    const existingSha256 = createHash('sha256').update(existingBytes).digest('hex');
    if (existingSha256 !== params.expectedSha256) {
      await fsp.rm(receipt.receiptPath, { force: true });
      throw new ManagedContentPublishError('content_address_conflict');
    }
  }
  await fsp.unlink(params.stagingPath).catch((error: unknown) => {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  });
  return { receiptPath: receipt.receiptPath };
}

/** 只有对应数据库事务已经取得内容所有权后才能完成 pending 发布。 */
export async function completeManagedImagePublish(
  pending: ManagedContentPendingPublish,
): Promise<void> {
  await fsp.rm(pending.receiptPath, { force: true });
}

/** 历史图片入口保留兼容；新非 raster consumer 使用 managed content 名称。 */
export const publishStagedManagedImage = publishStagedManagedContent;
export const completeManagedContentPublish = completeManagedImagePublish;
