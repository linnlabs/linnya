/**
 * @file src/knowledge-base/ingestion/failureCleanup.ts
 * 
 * **功能 (What):** 失败清理工具 - 清理三大数据源
 * **输入 (Input):** 文档ID、知识库ID和相关仓储实例
 * **输出 (Output):** 无
 * **副作用 (Side-effects):** 删除SQLite记录、Qdrant向量、SOT文件，允许用户重试
 */

import { Logger } from 'src/shared/logger';
import { Document } from '../domain/document';
import { MetadataRepository } from '../infrastructure/metadataRepository';
import { SotRepository } from '../infrastructure/sotRepository';
import { QdrantRepository } from '../infrastructure/qdrantRepository';
import type { OriginalDocumentRepository } from '../infrastructure/originalDocumentRepository';
import { DocumentService } from '../application/services/DocumentService';
import type { KnowledgeGraphRepository } from '../graph/infrastructure/knowledgeGraphRepository';
import { analyzeDocumentConsistency, emitConsistencyScanLogs } from './failureCleanupConsistency';

const logger = new Logger('FailureCleanup');

const noopOriginalDocumentRepository: OriginalDocumentRepository = {
  save: async () => {
    throw new Error('noopOriginalDocumentRepository 不支持保存原始文件');
  },
  getPath: async () => undefined,
  getSizeBytes: async () => undefined,
  delete: async () => false,
  deleteByKnowledgeBase: async () => 0,
};

// Qdrant点的载荷接口
interface QdrantPointPayload {
  doc_id?: string;
  [key: string]: unknown;
}

// Qdrant点接口
interface QdrantPoint {
  payload?: QdrantPointPayload;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * **功能 (What):** 从Qdrant集合中获取所有唯一的文档ID
 * **输入 (Input):** 
 * @param qdrantRepository - Qdrant仓储实例
 * @param collectionName - 集合名称
 * **输出 (Output):** 文档ID的Set集合
 * **副作用 (Side-effects):** 查询Qdrant数据库
 */
async function getQdrantDocIds(qdrantRepository: QdrantRepository, collectionName: string): Promise<Set<string>> {
  try {
    // 🔥 获取集合信息（用于诊断），但不要把 points_count 当成“是否为空”的唯一证据
    const collectionInfo = await qdrantRepository.getCollectionInfo(collectionName);
    const pointsCount = collectionInfo.points_count || 0;

    /**
     * 根因修复：必须全量遍历集合，而不是最多取 10000 个点。
     * 否则一致性检查会“看不见后半段”，残留孤儿数据会持续复发。
     *
     * 同时根因修复（误删）：
     * - Qdrant 在启动/加载窗口里可能出现 points_count=0 或 scroll 返回空页的瞬态；
     * - 如果把这些瞬态当作“集合为空”，会把大量 doc 误判为缺失并触发三删。
     *
     * 所以这里以 scroll 的真实返回为准，并在“计数>0但首屏为空”等矛盾情况下直接抛错中止本轮维护。
     */
    const pageSize = 1000;
    let offset: unknown = undefined;
    const docIds = new Set<string>();
    let totalPoints = 0;

    let firstPage = true;
    while (true) {
      const page = await qdrantRepository.scrollPointsPage(collectionName, pageSize, offset);

      // “计数>0但首屏为空”是强信号：Qdrant 可能仍在加载/响应异常 —— 不能据此做删除决策
      if (firstPage && pointsCount > 0 && page.points.length === 0) {
        throw new Error(
          `[FailureCleanup] Qdrant 扫描异常：collection=${collectionName} points_count=${pointsCount} 但 scroll 首页为空，跳过本轮一致性维护以避免误删`
        );
      }

      // “计数=0且首屏为空”才认为确实为空（双证据）
      if (firstPage && pointsCount === 0 && page.points.length === 0) {
        logger.info(`[FailureCleanup] 📊 Qdrant集合 ${collectionName} 为空（points_count=0 且 scroll 为空）`);
        return new Set();
      }

      firstPage = false;

      totalPoints += page.points.length;
      for (const point of page.points) {
        const payload = point.payload;
        const docId = isRecord(payload) ? payload['doc_id'] : undefined;
        if (typeof docId === 'string' && docId.trim().length > 0) {
          docIds.add(docId);
        }
      }

      if (page.points.length === 0 || page.nextOffset === undefined) break;
      if (Object.is(page.nextOffset, offset)) {
        throw new Error(
          `[FailureCleanup] Qdrant 扫描异常：collection=${collectionName} nextOffset 未推进，跳过本轮一致性维护以避免误删`
        );
      }
      offset = page.nextOffset;
    }

    logger.info(
      `[FailureCleanup] 📊 从Qdrant获取到 ${totalPoints} 个向量点（points_count=${pointsCount}），包含 ${docIds.size} 个唯一文档ID`
    );
    return docIds;
  } catch (error) {
    /**
     * 根因修复（误删）：
     * - “扫描失败/超时/网络波动”不等价于“集合为空/文档不存在”；
     * - 若吞掉异常并返回空集合，会把“检查失败”误判为“确实缺失”，继而触发破坏性三删。
     *
     * 因此这里必须把错误显式抛出，让上层跳过本轮一致性维护（等待下次重试），而不是继续做删除决策。
     */
    logger.error(`[FailureCleanup] 获取Qdrant文档ID失败（将中止本轮一致性维护，避免误删）: ${error}`);
    throw error;
  }
}


/**
 * **功能 (What):** 清理失败文档的三大数据源
 * **输入 (Input):** 
 * @param docId - 文档ID
 * @param kbId - 知识库ID
 * @param metadataRepository - 元数据仓储实例
 * @param qdrantRepository - Qdrant仓储实例（可选）
 * @param sotRepository - SOT仓储实例（可选）
 * **输出 (Output):** 无
 * **副作用 (Side-effects):** 删除SQLite记录、Qdrant向量、SOT文件
 */
export async function cleanupFailedDocument(
  docId: string, 
  kbId: string = '',
  metadataRepository?: MetadataRepository,
  qdrantRepository?: QdrantRepository,
  sotRepository?: SotRepository,
  knowledgeGraphRepository?: KnowledgeGraphRepository,
  originalDocumentRepository?: OriginalDocumentRepository
): Promise<void> {
  logger.info(`[FailureCleanup] 🧹 开始清理失败文档三大数据源: ${docId}`);

  /**
   * - FailureCleanup 只负责“何时删/删哪些”的编排，不重复实现删除细节。
   */
  if (!metadataRepository || !qdrantRepository || !sotRepository || !knowledgeGraphRepository) {
    logger.warn(
      `[FailureCleanup] 清理跳过：缺少必要仓储实例（metadata=${!!metadataRepository}, qdrant=${!!qdrantRepository}, sot=${!!sotRepository}, knowledgeGraph=${!!knowledgeGraphRepository}），docId=${docId}`
    );
    return;
  }

  // 若未传入 kbId，则以 SQLite 元数据为权威取 kbId（避免误删到错误集合）
  let resolvedKbId = kbId;
  if (!resolvedKbId || resolvedKbId.trim().length === 0) {
    const meta = await metadataRepository.getDocumentById(docId);
    if (meta?.kbId && meta.kbId.trim().length > 0) {
      resolvedKbId = meta.kbId.trim();
    }
  }

  if (!resolvedKbId || resolvedKbId.trim().length === 0) {
    logger.warn(`[FailureCleanup] 清理跳过：无法解析 kbId（未传入且元数据不存在），docId=${docId}`);
    return;
  }

  const documentService = new DocumentService({
    metadataRepository,
    qdrantRepository,
    sotRepository,
    originalDocumentRepository: originalDocumentRepository ?? noopOriginalDocumentRepository,
    knowledgeGraphRepository,
  });

  await documentService.deleteDocument(resolvedKbId, docId);

  logger.info(`[FailureCleanup] 🧹 失败文档清理完成: ${docId}`);
} 

/**
 * **功能 (What):** 应用启动时批量清理所有失败文档的三大数据源
 * **输入 (Input):** 
 * @param metadataRepository - 元数据仓储实例
 * @param qdrantRepository - Qdrant仓储实例（可选）
 * @param sotRepository - SOT仓储实例（可选）
 * **输出 (Output):** 清理统计信息
 * **副作用 (Side-effects):** 批量删除SQLite记录、Qdrant向量、SOT文件
 */
export async function cleanupAllFailedDocuments(
  metadataRepository?: MetadataRepository,
  qdrantRepository?: QdrantRepository,
  sotRepository?: SotRepository,
  knowledgeGraphRepository?: KnowledgeGraphRepository,
  originalDocumentRepository?: OriginalDocumentRepository
): Promise<{
  totalFailed: number;
  sqliteCleared: number;
  qdrantCleared: number;
  sotCleared: number;
}> {
  logger.info(`[FailureCleanup] 🧹 开始三大数据源一致性检查和清理...`);
  
  const stats = {
    totalFailed: 0,
    sqliteCleared: 0,
    qdrantCleared: 0,
    sotCleared: 0
  };

  if (!metadataRepository) {
    logger.info(`[FailureCleanup] ⚠️ MetadataRepository未提供，跳过批量清理`);
    return stats;
  }

  /**
   * 根因修复（误删）：
   * - 该函数的职责是“三大数据源一致性维护”，没有完整三源就无法做可靠判定；
   * - 缺失任何一个仓储时继续执行，会把“未知/未检查”误当作“缺失”，导致错误状态纠偏甚至误删。
   */
  if (!qdrantRepository || !sotRepository || !knowledgeGraphRepository) {
    logger.warn(
      `[FailureCleanup] ⚠️ 一致性维护跳过：缺少必要仓储实例（qdrant=${!!qdrantRepository}, sot=${!!sotRepository}, knowledgeGraph=${!!knowledgeGraphRepository}）`
    );
    return stats;
  }

  try {
    /**
     * 根因修复（启动慢导致误删）：
     * - Qdrant 在启动早期可能“不可达/超时”，但旧逻辑会把这种情况当作“所有集合都不存在/为空”
     * - 继而触发“向量库缺失→全量判失败→三删”的灾难链路
     *
     * 这里必须先判断 Qdrant 是否“可达”（reachable）：
     * - 可达：才允许做三大数据源的一致性判定（包含 Qdrant 缺失判断）
     * - 不可达：直接跳过本轮维护，让上层编排器稍后重试（不做任何破坏性动作）
     *
     * 注意：我们用 `collectionExists('default')` 作为轻量探测：
     * - 结果 true/false 都代表“服务可达且返回了确定响应”
     * - 非 404 的异常会被 QdrantAdapter 显式抛出（视为不可达/未就绪）
     */
    if (qdrantRepository) {
      try {
        await qdrantRepository.collectionExists('default');
      } catch (e) {
        logger.warn(
          `[FailureCleanup] ⚠️ Qdrant 未就绪/不可达，跳过本轮知识库一致性清理（避免误删）: ${e instanceof Error ? e.message : String(e)}`
        );
        return stats;
      }
    }

    // 1. 收集三大数据源的数据
    logger.info(`[FailureCleanup] 📊 正在收集三大数据源数据...`);
    
    // 获取所有元数据记录
    const allDocs = await metadataRepository.getAllDocuments();
    const metadataIds = new Set(allDocs.map((doc: Document) => doc.id));
    const metadataById = new Map(allDocs.map((doc: Document) => [doc.id, doc] as const));
    logger.info(`[FailureCleanup] 📊 元数据库: ${metadataIds.size} 个文档`);
    
    // 获取所有SOT文件ID
    let sotIds = new Set<string>();
    try {
      const sotFileIds = await sotRepository.listAllDocumentIds();
      sotIds = new Set(sotFileIds);
      logger.info(`[FailureCleanup] 📊 SOT文件: ${sotIds.size} 个文件`);
    } catch (error) {
      /**
       * 根因修复（误删）：
       * - SoT 列表读取失败时，“返回空列表继续执行”会被误判为 SoT 全部缺失；
       * - 进而把大量已完成文档标记为失败并触发三删。
       */
      logger.warn(
        `[FailureCleanup] ⚠️ 获取SOT文件列表失败，跳过本轮一致性维护（避免误删）: ${error instanceof Error ? error.message : String(error)}`
      );
      return stats;
    }
    
    // 检查Qdrant集合并获取所有文档ID（根因修复：覆盖所有知识库集合，而不是仅 default）
    const qdrantDocIdsByKb = new Map<string, Set<string>>();
    const qdrantDocIds = new Set<string>();
    try {
      const kbIdsToCheck = await getAllKnowledgeBaseIdsForCleanup(metadataRepository);
      logger.info(`[FailureCleanup] 📊 需要检查的Qdrant集合数: ${kbIdsToCheck.length}`);

      for (const kbId of kbIdsToCheck) {
        const exists = await qdrantRepository.collectionExists(kbId);
        logger.info(`[FailureCleanup] 📊 Qdrant集合 ${kbId}: ${exists ? '存在' : '不存在'}`);
        if (!exists) continue;

        const idsInKb = await getQdrantDocIds(qdrantRepository, kbId);
        qdrantDocIdsByKb.set(kbId, idsInKb);
        for (const docId of idsInKb) {
          qdrantDocIds.add(docId);
        }
      }

      logger.info(`[FailureCleanup] 📊 Qdrant向量: ${qdrantDocIds.size} 个唯一文档（跨所有集合汇总）`);
    } catch (error) {
      /**
       * 根因修复（误删）：
       * - 如果 Qdrant 扫描只“部分成功”，则“不在集合中”这一结论不成立（可能只是没扫到）；
       * - 继续做一致性判定会把“未知”当“缺失”，导致误删。
       *
       * 所以：只要本轮 Qdrant 扫描出现任何错误，就直接跳过本轮维护（等待下次）。
       */
      logger.warn(
        `[FailureCleanup] ⚠️ 检查Qdrant集合失败，跳过本轮一致性维护（避免误删）: ${error instanceof Error ? error.message : String(error)}`
      );
      return stats;
    }

    const { failedDocIds, report: scanReport } = await analyzeDocumentConsistency({
      metadataById,
      metadataRepository,
      sotRepository,
      metadataIds,
      sotIds,
      qdrantDocIds,
      qdrantDocIdsByKb
    });
    
    /**
     * 移除旧的“向量库缺失→全量判失败”分支。
     *
     * 原因：
     * - “Qdrant 为空”并不等价于“文档都失败”，尤其在启动早期 Qdrant 尚未就绪/索引尚未加载时；
     * - 一旦误判，会触发三删，造成不可逆的数据丢失；
     *
     * 正确策略：
     * - Qdrant 不可达：前置可达性探测已直接 return（由上层重试）
     * - Qdrant 可达但集合确实为空：这更像“索引缺失/迁移/配置错误”，应走重建索引/重新向量化策略，
     *   不应在启动维护里做全量删除（破坏性过强）。
     */
    
    stats.totalFailed = failedDocIds.size;
    emitConsistencyScanLogs({
      metadataCount: metadataIds.size,
      sotCount: sotIds.size,
      qdrantCount: qdrantDocIds.size,
      cleanupCandidateCount: stats.totalFailed,
      report: scanReport
    });
    logger.info(`[FailureCleanup] 🔍 检测到 ${stats.totalFailed} 个不一致的文档需要清理`);

    if (stats.totalFailed === 0) {
      logger.info(`[FailureCleanup] ✅ 三大数据源一致性良好，无需清理`);
      return stats;
    }

    // 3. 清理不一致的文档（根因修复：按“文档实际所在集合”清理，而不是固定 default）
    for (const failedDocId of failedDocIds) {
      try {
        const meta = allDocs.find((d) => d.id === failedDocId);
        const kbIdsFromQdrant: string[] = [];
        for (const [kbId, ids] of qdrantDocIdsByKb.entries()) {
          if (ids.has(failedDocId)) kbIdsFromQdrant.push(kbId);
        }

        // 优先使用元数据里的 kbId；否则使用Qdrant里出现过的集合列表；都没有则回退 default 以兼容旧逻辑
        const kbIdsToCleanup =
          meta?.kbId
            ? [meta.kbId]
            : kbIdsFromQdrant.length > 0
              ? kbIdsFromQdrant
              : ['default'];

        for (const kbId of kbIdsToCleanup) {
          await cleanupFailedDocument(
            failedDocId,
            kbId,
            metadataRepository,
            qdrantRepository,
            sotRepository,
            knowledgeGraphRepository,
            originalDocumentRepository
          );
        }

        // 根据实际清理结果更新统计（粗粒度统计：只要触发了清理就+1）
        if (metadataIds.has(failedDocId)) stats.sqliteCleared++;
        if (qdrantRepository && kbIdsToCleanup.length > 0) stats.qdrantCleared++;
        if (sotIds.has(failedDocId)) stats.sotCleared++;
      } catch (error) {
        logger.error(`[FailureCleanup] ❌ 清理不一致文档 ${failedDocId} 时出错: ${error}`);
      }
    }

    logger.info(`[FailureCleanup] 🎉 三大数据源一致性清理完成:`, stats);
    return stats;

  } catch (error) {
    logger.error(`[FailureCleanup] ❌ 一致性检查失败: ${error}`);
    return stats;
  }
}

/**
 * 根因修复：启动清理需要覆盖“所有知识库集合”，而不是仅 default。
 *
 * 说明：
 * - 当前系统已支持“多知识库 + 项目关联”；
 * - 若只扫描 default，会导致非 default 的集合残留孤儿向量点；
 * - 最终表现为：search 能搜到 doc_id，但元数据无记录，browse 失败。
 */
async function getAllKnowledgeBaseIdsForCleanup(
  metadataRepository?: MetadataRepository
): Promise<string[]> {
  if (!metadataRepository) return ['default'];
  try {
    const kbs = await metadataRepository.getAllKnowledgeBases();
    const ids = kbs
      .map((kb) => kb.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
    return Array.from(new Set(ids.length > 0 ? ids : ['default']));
  } catch (error) {
    logger.warn(`[FailureCleanup] 获取知识库列表失败，回退到 default: ${error}`);
    return ['default'];
  }
}

/**
 * **功能 (What):** 应用启动时的一次性清理任务
 * **输入 (Input):** 仓储实例
 * **输出 (Output):** 无
 * **副作用 (Side-effects):** 后台异步清理失败文档
 */
export async function performStartupCleanup(
  metadataRepository?: MetadataRepository,
  qdrantRepository?: QdrantRepository,
  sotRepository?: SotRepository,
  knowledgeGraphRepository?: KnowledgeGraphRepository,
  originalDocumentRepository?: OriginalDocumentRepository
): Promise<void> {
  logger.info(`[FailureCleanup] 🚀 应用启动 - 开始后台清理任务...`);
  
  try {
    // 延迟10秒再开始清理，为Qdrant数据加载提供更充足的时间
    setTimeout(async () => {
      const stats = await runKnowledgeBaseStartupMaintenanceOnce(
        metadataRepository,
        qdrantRepository,
        sotRepository,
        knowledgeGraphRepository,
        originalDocumentRepository
      );
      
      if (stats.totalFailed > 0) {
        logger.info(`[FailureCleanup] 🧹 启动清理完成: 清理了 ${stats.totalFailed} 个失败文档`);
      } else {
        logger.info(`[FailureCleanup] ✅ 启动清理完成: 数据状态良好，无需清理`);
      }
    }, 10000);
    
  } catch (error) {
    logger.error(`[FailureCleanup] ❌ 启动清理任务失败: ${error}`);
  }
} 

/**
 * Phase 2（启动后一次性维护）的“知识库一致性维护”入口：
 * - 不做 setTimeout，由外部编排器控制启动时机
 * - 只返回统计结果，便于统一汇总日志
 */
export async function runKnowledgeBaseStartupMaintenanceOnce(
  metadataRepository?: MetadataRepository,
  qdrantRepository?: QdrantRepository,
  sotRepository?: SotRepository,
  knowledgeGraphRepository?: KnowledgeGraphRepository,
  originalDocumentRepository?: OriginalDocumentRepository
): Promise<{
  totalFailed: number;
  sqliteCleared: number;
  qdrantCleared: number;
  sotCleared: number;
}> {
  return await cleanupAllFailedDocuments(
    metadataRepository,
    qdrantRepository,
    sotRepository,
    knowledgeGraphRepository,
    originalDocumentRepository
  );
}
