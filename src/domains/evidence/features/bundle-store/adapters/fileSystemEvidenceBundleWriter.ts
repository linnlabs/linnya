import { promises as fsp } from 'fs';
import path from 'path';
import { pathManager } from '../../../../../shared/utils/pathManager';
import type { EvidenceBundleWriterPort } from '../ports/evidenceBundleWriter';

async function atomicWriteJson(params: {
  readonly filePath: string;
  readonly data: unknown;
}): Promise<void> {
  await fsp.mkdir(path.dirname(params.filePath), { recursive: true });
  const tempPath = `${params.filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(params.data, null, 2), 'utf-8');
    await fsp.rename(tempPath, params.filePath);
  } catch (error: unknown) {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // 临时文件可能尚未创建；原始写入错误才是调用方需要处理的根因。
    }
    throw error;
  }
}

export const fileSystemEvidenceBundleWriter: EvidenceBundleWriterPort = {
  async write(params) {
    const filePath = pathManager.getConversationEvidenceBundleFilePath({
      conversationId: params.conversationId,
      instanceId: params.instanceId,
      bundleId: params.bundleId,
    });
    await atomicWriteJson({ filePath, data: params.record });
    return { filePath };
  },
};
