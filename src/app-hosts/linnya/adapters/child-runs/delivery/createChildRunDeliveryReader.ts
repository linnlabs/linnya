import type { BackendPluginCliExecutionContext } from '@linnya/plugin-host-contract/backend/pluginCli';
import { SQLiteRunRegistryStore } from '../../persistence/run-registry';
import { runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import { createHash } from 'node:crypto';
import { SubagentArgsSchema, SubagentResultSchema } from '@app/schemas';
import type { PluginChildRunDeliveryReader } from '@linnya/plugin-host-contract/backend/childRunDelivery';
import type { ToolContext } from 'src/tools/types';
import { resolveWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import { createMarkdownReadDatabase, readMarkdownVfsContent } from 'src/domains/markdown';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { readRunToolDeliveries } from '../../persistence/event-store';

import { DocumentObservationUnavailableError } from './documentObservationError';

function isContext(value: unknown): value is Pick<ToolContext, 'databaseService'> {
  return typeof value === 'object' && value !== null && 'databaseService' in value
    && typeof value.databaseService === 'object' && value.databaseService !== null
    && 'getDb' in value.databaseService && typeof value.databaseService.getDb === 'function';
}

/** SDK 跨 owner 编排：EventStore 提供调用事实，VFS 提供当前保存版本；插件不读取它们的表。 */
export function createChildRunDeliveryReader(value: BackendPluginCliExecutionContext): PluginChildRunDeliveryReader {
  if (!isContext(value.hostContext)) throw new Error('Child delivery requires an admitted internal-data context');
  const db = value.hostContext.databaseService?.getDb();
  const conversationId = value.conversationId;
  const projectId = value.projectId;
  if (!db || !conversationId || !projectId) throw new Error('Child delivery requires a project conversation');
  const runtime = { db, conversationId, projectId };
  return {
    async readRunStatus(runId) {
      const record = await new SQLiteRunRegistryStore(db).load(runId);
      return record?.conversationId === conversationId ? record.status : null;
    },
    read(runId) {
      return readRunToolDeliveries(db, conversationId, runId, 'subagent').map(row => {
        const args = SubagentArgsSchema.parse(JSON.parse(row.argumentsJson));
        const result = SubagentResultSchema.shape.data.parse(JSON.parse(row.dataJson));
        if ((args.subagent_type ?? 'general') !== result.subagent_type) throw new Error('Subagent delivery identity mismatch');
        const childId = result.subrun_ids[0];
        if (!childId) throw new Error('Missing subagent identity');
        const children = readRunToolDeliveries(db, conversationId, runIdFromSubrunId(childId), 'subagent')
          .map(child => SubagentResultSchema.shape.data.parse(JSON.parse(child.dataJson)));
        return { toolCallId: row.toolCallId, prompt: args.prompt, type: result.subagent_type, result, children };
      });
    },
    async observeDocument(locatorOrInode) {
      const params = {
        ...runtime, nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
        ...(locatorOrInode.startsWith('workspace:') && !locatorOrInode.startsWith('workspace:/')
          ? { inode: locatorOrInode } : { path: locatorOrInode.startsWith('workspace:/') ? locatorOrInode.slice('workspace:'.length) : locatorOrInode }),
      };
      const resolved = await resolveWorkspaceVfsNode(params);
      if (!resolved.ok) throw new DocumentObservationUnavailableError(resolved.message);
      if (resolved.node.type !== 'document') throw new Error('Version observation currently requires a versioned Markdown document');
      // 读取 owner 的完整 current 投影，不用通用 VFS 的默认字符截断计算全文 hash。
      const read = readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId: resolved.node.id });
      if (!read) throw new DocumentObservationUnavailableError('Saved Markdown version unavailable');
      const { versionNumber, pendingCount } = read.metadata;
      return {
        inode: resolved.node.inode, path: resolved.node.path, versionNumber, pendingCount,
        sha256: createHash('sha256').update(read.text).digest('hex'),
      };
    },
  };
}
