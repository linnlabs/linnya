import { z } from 'zod';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import type { KnowledgeRuntime } from '../../runtime/orchestration/createKnowledgeRuntime';
import { createKnowledgeExecution } from '../../runtime/orchestration/createKnowledgeExecution';
import { markInterruptedKnowledgeDocuments } from '../../runtime/orchestration/markInterruptedKnowledgeDocuments';
import type { KnowledgeCliCommand } from '../definitions/knowledgeCliCommand';
import { KnowledgeCliPermissionError } from '../definitions/knowledgeCliErrors';
import {
  resolveKnowledgeCliScope,
  assertKnowledgeCliAccess,
} from '../functions/resolveKnowledgeCliScope';
import { resolveKnowledgeCliModels } from '../functions/resolveKnowledgeCliModels';

const Completion = z.object({
  duplicate: z.boolean().optional(),
  frontendState: z.object({ message: z.string().optional() }).optional(),
});

/** scope 来自 Host 所属项目和此刻实际关联；全局管理 IPC 不参与 CLI 授权。 */
export async function executeKnowledgeCli(
  runtime: KnowledgeRuntime,
  command: KnowledgeCliCommand,
  context: BackendPluginCliExecutionContext
): Promise<unknown> {
  runtime.assertAccepting();
  context.signal.throwIfAborted();
  const projectId = context.projectId;
  const ids = projectId ? await runtime.links.listKnowledgeBasesForProject(projectId) : [];
  const links = await Promise.all(
    ids.map(async kbId => {
      const link = projectId ? await runtime.links.getLinkDetail(projectId, kbId) : undefined;
      if (!link) throw new Error('项目关联已变化，请重新执行');
      return link;
    })
  );
  const scope = resolveKnowledgeCliScope(projectId, links);
  assertKnowledgeCliAccess(scope, command);
  context.signal.throwIfAborted();
  if (command.action === 'list') {
    return {
      projectId: scope.projectId,
      libraries: await Promise.all(
        scope.kbIds.map(async kbId => {
          const kb = await runtime.service.getKnowledgeBaseById(kbId);
          if (!kb) throw new Error('项目关联的知识库不存在');
          const link = links.find(value => value.kbId === kbId);
          return { id: kb.id, name: kb.name, role: link?.role ?? 'read_only', implicit: !link };
        })
      ),
    };
  }
  const kb = await runtime.service.getKnowledgeBaseById(command.kbId);
  if (!kb) throw new Error('知识库不存在');
  switch (command.action) {
    case 'documents.list':
      return { kbId: kb.id, documents: await runtime.service.getDocumentsInKnowledgeBase(kb.id) };
    case 'index.status':
      return {
        kbId: kb.id,
        identity: runtime.metadata.indexState.read(kb.id),
        rebuild: runtime.service.getIndexRebuildStatus(kb.id),
      };
    case 'unlink':
      return {
        projectId: scope.projectId,
        kbId: kb.id,
        unlinked: await runtime.links.unlinkKnowledgeBaseFromProject(scope.projectId, kb.id),
      };
    case 'documents.delete': {
      const document = await runtime.service.getDocumentById(command.documentId);
      // 文档在别的库里等同跨库访问，按权限拒绝报告（退出码 77），不是一般操作失败。
      if (!document || document.kbId !== kb.id) throw new KnowledgeCliPermissionError('文档不属于当前获准知识库');
      await runtime.service.deleteDocument(kb.id, document.id);
      return { kbId: kb.id, documentId: document.id, deleted: true };
    }
    case 'index.rebuild': {
      if (!context.inference) throw new Error('当前 Host 未提供获准的模型调用能力');
      const models = resolveKnowledgeCliModels(kb, context.modelPurposeSnapshot);
      const execution = createKnowledgeExecution(context.inference, context.signal);
      try {
        const job = await runtime.service.rebuildIndex(kb.id, models.embeddingModelId, execution);
        const result = await runtime.service.waitForIndexRebuild(job.jobId);
        context.signal.throwIfAborted();
        if (result.status !== 'completed') throw new Error(result.message);
        return result;
      } finally {
        await execution.close();
      }
    }
    case 'documents.import': {
      if (!context.inference || !context.stageConversationFile)
        throw new Error('当前 Host 未提供获准的导入能力');
      const models = resolveKnowledgeCliModels(kb, context.modelPurposeSnapshot, command.source);
      const execution = createKnowledgeExecution(context.inference, context.signal);
      let accepted: { taskId: string; document: { id: string } } | undefined;
      // 通用队列在发布完成事件后释放大结果；本命令只保留重复判定和给用户的说明。
      let completion: ReturnType<typeof Completion.safeParse> | undefined;
      const disposeCompletion = runtime.queues.subscribeToEvent(
        'ingestion:taskCompleted',
        event => {
          if (runtime.queues.getExecution(event.taskId) === execution)
            completion = Completion.safeParse(event.result);
        }
      );
      try {
        const staged = await context.stageConversationFile(command.source);
        execution.signal.throwIfAborted();
        accepted = await runtime.service.addDocument(
          kb.id,
          staged.file.path,
          staged.file.name,
          staged.file.size,
          models.embeddingModelId,
          models.pdfOcrModelId,
          models.imageVisionModelId,
          undefined,
          false,
          models.graphExtractionModelId,
          execution
        );
        staged.acceptFile();
        await execution.wait();
        const job = runtime.queues.getTaskById(accepted.taskId);
        if (!job || job.state !== 'completed') throw new Error(job?.error ?? '摄入未成功完成');
        if (!completion) throw new Error('摄入完成回执不存在');
        if (!completion.success) throw completion.error;
        const result = completion.data;
        if (result.duplicate)
          return {
            kbId: kb.id,
            jobId: job.id,
            status: 'duplicate',
            message: result.frontendState?.message ?? '已存在相同文件，未重复导入',
          };
        const document = await runtime.service.getDocumentById(accepted.document.id);
        if (!document || document.status !== 'completed')
          throw new Error(document?.errorMessage ?? '摄入结果未保存');
        const graph = await runtime.graph.getDocumentWorkStatus(kb.id, document.id);
        const currentKb = await runtime.service.getKnowledgeBaseById(kb.id);
        if (
          currentKb?.enableGraphIndexing &&
          (graph.extraction?.status !== 'completed' || graph.indexing?.status !== 'completed')
        ) {
          throw new Error(
            graph.indexing?.errorMessage ?? '原文已导入，但知识图谱处理未完成，请查看知识库进度'
          );
        }
        return { kbId: kb.id, jobId: job.id, document, graph };
      } finally {
        await execution.close();
        disposeCompletion();
        if (accepted)
          await markInterruptedKnowledgeDocuments(
            runtime.metadata,
            [{ kbId: kb.id, docId: accepted.document.id }],
            '本次命令已中断。已保存资料保留，可重建索引；未保存内容可重新导入。'
          );
      }
    }
  }
}
