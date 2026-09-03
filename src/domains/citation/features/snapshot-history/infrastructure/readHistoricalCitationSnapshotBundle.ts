/**
 * 读取已退出 live 生产链的 Knowledge CitationSnapshot。
 *
 * 该 reader 只服务历史卡片恢复与下载，所有身份由 Host 显式传入；
 * Citation domain 不解析 ToolContext，也不向 Agent 暴露 bundle 寻址能力。
 */
import { promises as fsp } from 'node:fs';
import {
  CitationSnapshotBundleIdSchema,
  CitationSnapshotBundleRecordV1Schema,
  type CitationSnapshotBundleRecordV1,
} from '@app/schemas';
import { pathManager } from '../../../../../shared/utils/pathManager';

export async function readHistoricalCitationSnapshotBundle(params: {
  readonly conversationId: string;
  readonly instanceId?: string;
  readonly bundleId: string;
}): Promise<CitationSnapshotBundleRecordV1> {
  const conversationId = params.conversationId.trim();
  if (!conversationId) {
    throw new Error('[CitationSnapshotHistory] conversationId 不能为空');
  }
  const instanceId = params.instanceId?.trim() || 'default';
  const bundleId = CitationSnapshotBundleIdSchema.parse(params.bundleId.trim());
  const filePath = pathManager.getConversationCitationSnapshotBundleFilePath({
    conversationId,
    instanceId,
    bundleId,
  });
  const text = await fsp.readFile(filePath, 'utf-8');
  return CitationSnapshotBundleRecordV1Schema.parse(JSON.parse(text) as unknown);
}
