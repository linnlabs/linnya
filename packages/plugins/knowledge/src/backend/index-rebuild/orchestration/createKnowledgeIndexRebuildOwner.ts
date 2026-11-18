import { randomUUID } from 'node:crypto';
import { Logger } from '@plugin/backend/loggingRuntime';
import { resolveKnowledgeIndexFailureMessage } from '../functions/resolveKnowledgeIndexFailureMessage';

import type { KnowledgeActivityOwner } from '../../runtime/orchestration/createKnowledgeActivityOwner';
import type { KnowledgeIndexJobStatus } from '../definitions/knowledgeIndex';
import {
  rebuildKnowledgeIndex,
  type KnowledgeIndexRebuildDependencies,
} from './rebuildKnowledgeIndex';

const logger = new Logger('KnowledgeIndexRebuild');

/** 每库只保留最近一次任务；运行中取消、关 App 由相同 activity owner 收口。 */
export function createKnowledgeIndexRebuildOwner(
  deps: KnowledgeIndexRebuildDependencies,
  activity: KnowledgeActivityOwner
) {
  const jobs = new Map<
    string,
    { status: KnowledgeIndexJobStatus; cancel(): void; completion: Promise<void> }
  >();
  return {
    async start(kbId: string, modelId: string): Promise<KnowledgeIndexJobStatus> {
      const documents = await deps.metadata.getDocumentsInKnowledgeBase(kbId);
      if (documents.length === 0) throw new Error('知识库没有可重建的原文内容');
      const lease = activity.begin(kbId, 'rebuild');
      const controller = new AbortController();
      const signal = AbortSignal.any([lease.signal, controller.signal]);
      let status: KnowledgeIndexJobStatus = {
        jobId: randomUUID(),
        kbId,
        modelId,
        status: 'running',
        progress: 0,
        message: '正在检查原文和嵌入模型',
        updatedAt: Date.now(),
      };
      const job = {
        get status() {
          return status;
        },
        cancel: () => controller.abort(),
        completion: Promise.resolve(),
      };
      jobs.set(kbId, job);
      job.completion = rebuildKnowledgeIndex({
        deps,
        kbId,
        modelId,
        signal,
        progress: value => {
          status = {
            ...status,
            progress: (value.completedPoints / value.totalPoints) * 100,
            message: `已重建 ${value.completedPoints}/${value.totalPoints} 个索引块`,
            updatedAt: Date.now(),
          };
        },
      })
        .then(
          () => {
            status = {
              ...status,
              status: 'completed',
              progress: 100,
              message: '检索索引重建完成',
              updatedAt: Date.now(),
            };
          },
          (error: unknown) => {
            if (!signal.aborted) logger.error('检索索引重建失败', { kbId, modelId, error });
            status = {
              ...status,
              status: signal.aborted ? 'cancelled' : 'failed',
              message: signal.aborted
                ? '重建已取消，原文保留，可再次重建'
                : `${resolveKnowledgeIndexFailureMessage(error)}；原文保留，可再次重建`,
              updatedAt: Date.now(),
            };
          }
        )
        .finally(() => lease.release());
      return status;
    },
    get(kbId: string): KnowledgeIndexJobStatus | null {
      return jobs.get(kbId)?.status ?? null;
    },
    async cancel(jobId: string): Promise<boolean> {
      const job = [...jobs.values()].find(value => value.status.jobId === jobId);
      if (!job) return false;
      job.cancel();
      await job.completion;
      return true;
    },
  };
}
