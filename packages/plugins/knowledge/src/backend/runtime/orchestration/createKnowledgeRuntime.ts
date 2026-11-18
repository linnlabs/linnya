import path from 'node:path';
import { getPluginStorage } from '@plugin/backend/storageRuntime';
import { createPluginVectorRuntime } from '@plugin/backend/vectorRuntime';
import { getPluginInferencePort } from '@plugin/backend/inferenceRuntime';
import { getPluginProjectReadPort } from '@plugin/backend/projectReadRuntime';
import { getPluginModelConfigurationPort } from '@plugin/backend/modelConfiguration';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import { QdrantAdapter } from '../../infrastructure/vector-store/QdrantAdapter';
import { QdrantRepositoryImpl } from '../../infrastructure/QdrantRepositoryImpl';
import { DefaultSearchService } from '../../application/searchService';
import { KnowledgeBaseCoordinator } from '../../application/KnowledgeBaseCoordinator';
import { KnowledgeGraphQueueOrchestrator } from '../../graph/application/knowledgeGraphQueueOrchestrator';
import { GraphProgressService } from '../../graph/application/graphProgressService';
import { KnowledgeQueues } from '../../queue/orchestration/KnowledgeQueues';
import { createKnowledgeActivityOwner } from './createKnowledgeActivityOwner';
import { connectKnowledgeProgress } from './connectKnowledgeProgress';
import { scheduleKnowledgeMaintenance } from './scheduleKnowledgeMaintenance';
import { ingestionProgressStore } from '../../ingestion/store/ingestionProgressStore';
import { scopeKnowledgeInference } from './scopeKnowledgeInference';
import { markInterruptedKnowledgeDocuments } from './markInterruptedKnowledgeDocuments';
import type { KnowledgeToolRuntime } from '../../tools/runtime/knowledgeToolRuntime';
import { prepareKnowledgeData } from './prepareKnowledgeData';

/** 一个 activation 持有全部知识库运行资源；这里只读 SQLite/创建目录，不启动向量或线程。 */
export async function createKnowledgeRuntime() {
  const storage = getPluginStorage('knowledge');
  const controller = new AbortController();
  const inference = scopeKnowledgeInference(getPluginInferencePort(), controller.signal);
  const projects = getPluginProjectReadPort();
  const models = getPluginModelConfigurationPort();
  const activity = createKnowledgeActivityOwner();
  const { paths, metadata, sot, originals, graphRepository, links } = await prepareKnowledgeData(storage, projects);
  let adapter: Promise<QdrantAdapter> | undefined;
  let maintenance: ReturnType<typeof scheduleKnowledgeMaintenance> | undefined;
  let interactiveMaintenanceRequested = false;
  let vectorReady = false;
  let accepting = true;
  let activeTools = 0;
  let interruptedTasks: readonly { docId: string; kbId: string }[] | undefined;
  const resolveVectorUrl = async (signal?: AbortSignal) => {
    let url: string;
    try {
      url = await vector.ensureReady(signal);
    } catch (cause) {
      if (signal?.aborted || controller.signal.aborted) throw cause;
      // 首次启动失败在本 activation 保持失败；提示实际可用的显式恢复操作。
      throw new Error('知识库向量服务未能启动，请检查运行日志，修复后停用并重新启用知识库。', { cause });
    }
    vectorReady = true;
    startInteractiveMaintenanceIfReady();
    return url;
  };
  function startInteractiveMaintenanceIfReady() {
    // CLI 的项目范围操作不能顺带以交互界面的全局权限维护其他库。
    if (accepting && interactiveMaintenanceRequested && vectorReady && !maintenance) {
      maintenance = scheduleKnowledgeMaintenance({
        metadataRepository: metadata,
        qdrantRepository: vectors,
        sotRepository: sot,
        originalDocumentRepository: originals,
        knowledgeGraphRepository: graphRepository,
        activity,
      });
      graph.startBackfill();
    }
  }
  const vectors = new QdrantRepositoryImpl(
    () => (adapter ??= resolveVectorUrl(controller.signal).then(url => new QdrantAdapter({ url })))
  );
  const queues = new KnowledgeQueues({
    activity,
    paths,
    resolveVectorUrl,
    prepareIngestion: job => ({
      ...job,
      ...(path.extname(job.filename).toLowerCase() === '.pdf' && !job.pdfOcrModelId
        ? { pdfOcrModelId: models.readDefaultModelIdByCapability('pdf_ocr_default') }
        : {}),
    }),
  });
  const graph = new KnowledgeGraphQueueOrchestrator({
    queueManager: queues,
    database: storage.database,
    sotRepository: sot,
    publishGraphProgress: payload => {
      if (accepting)
        broadcastRendererPluginMessage('knowledge', 'graph-progress-updated', { ...payload });
    },
  });
  const searchService = new DefaultSearchService({
    qdrantRepository: vectors,
    metadataRepository: metadata,
    sotRepository: sot,
    embedding: inference.embedding,
    reranking: inference.reranking,
    knowledgeGraphRepository: graphRepository,
  });
  const service = new KnowledgeBaseCoordinator({
    queues,
    graphTasks: graph,
    temporaryDirectory: paths.temporaryDirectory,
    enqueueGraphExtraction: (kbId, docId) => graph.enqueueGraphExtractionForDocument(kbId, docId),
    activity,
    metadataRepository: metadata,
    qdrantRepository: vectors,
    sotRepository: sot,
    originalDocumentRepository: originals,
    searchService,
    knowledgeGraphRepository: graphRepository,
    ingestionCapabilities: inference,
    statusUpdatePublisher: event => connectedProgress.statusUpdatePublisher(event),
  });
  // SQLite admission 失败时还没有向 Host 领取资源 owner，下一次启用可直接重试。
  const vector = createPluginVectorRuntime('knowledge');
  const connectedProgress = connectKnowledgeProgress(queues, originals);
  const progress = new GraphProgressService(graphRepository);
  const toolRuntime: KnowledgeToolRuntime = {
    service,
    listProjectKnowledgeBaseIds: projectId => links.getKnowledgeBaseIdsForProject(projectId),
    enterTool() {
      if (!accepting) throw new Error('知识库正在停用，请稍后再试');
      activeTools += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          activeTools -= 1;
        }
      };
    },
  };
  graph.start();
  function beginDeactivation() {
    accepting = false;
    activity.stopAccepting();
    connectedProgress.stopPublishing();
    // CLI drain 会先把队列 job 改为 failed；必须在那之前保存本实例需补持久终态的身份。
    interruptedTasks ??= queues
      .listIngestionTasks()
      .filter(job => job.state === 'pending' || job.state === 'running')
      .map(job => ({ docId: job.data.docId, kbId: job.data.kbId }));
    return interruptedTasks;
  }
  return {
    service,
    toolRuntime,
    metadata,
    sot,
    originals,
    links,
    graph,
    progress,
    projects,
    inference,
    queues,
    // 历史图谱是用户界面的后台工作；CLI 获准的一次写入不能顺带启动其他库的模型调用。
    startInteractiveMaintenance() {
      interactiveMaintenanceRequested = true;
      startInteractiveMaintenanceIfReady();
    },
    signal: controller.signal,
    assertAccepting() {
      if (!accepting) throw new Error('知识库正在停用，请稍后再试');
    },
    hasActiveTasks() {
      return activeTools > 0 || activity.hasActivity();
    },
    assertCanDeactivate() {
      if (activeTools > 0)
        throw new Error('知识库工具仍在运行，请等待检索或深度搜索结束后再停用。');
    },
    beginDeactivation,
    async stop() {
      // 同步封闭接单之后才让出执行权；失败时仍由 effect 持有当前 owner，允许再次收尾。
      const interrupted = beginDeactivation();
      controller.abort();
      const graphStopped = graph.stop();
      const maintenanceStopped = maintenance?.stop();
      const draining = activity.drain();
      await queues.shutdown();
      await draining;
      await graphStopped;
      await markInterruptedKnowledgeDocuments(metadata, interrupted);
      interruptedTasks = [];
      await maintenanceStopped;
      await vector.stop();
      progress.dispose();
      await connectedProgress.dispose();
      ingestionProgressStore.clear();
    },
  };
}
export type KnowledgeRuntime = Awaited<ReturnType<typeof createKnowledgeRuntime>>;
