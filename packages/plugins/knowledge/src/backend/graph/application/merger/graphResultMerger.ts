/**
 * @file graphResultMerger.ts
 *
 * @description
 * 负责合并“Chunk-Driven”（来自 RAG 检索）和“Edge-Driven Discovery”（来自图谱补漏召回）的结果。
 *
 * 核心逻辑：
 * 1. 优先保留 Chunk-Driven 结果（因其已被 RAG 精确召回并可能已包含完整图谱信息）。
 * 2. 对 Discovery 结果进行去重：
 *    - 如果 Discovery 找出的边/实体所指向的 evidence block 已经在 Chunk-Driven 列表中，则视为重复，跳过。
 * 3. 语义过滤（可选）：
 *    - 可以在此阶段对 Discovery 结果进行更严格的语义相似度检查（Cross-Validation）。
 */

// 注意：GraphAugmentation 定义在上一级目录的 graphSearchService 中
import type { GraphAugmentation } from '../graphSearchService';

/**
 * 简单的实体/边结构定义，用于合并时的对象引用。
 * 实际上 GraphAugmentation 内部是 entities: KnowledgeGraphNode[], relations: KnowledgeGraphEdge[]
 * 这里我们只依赖 GraphAugmentation 类型。
 */

export type DiscoveryResult = {
  // Discovery 找出的增强信息
  augmentation: GraphAugmentation;
  // 该增强信息对应的证据来源（docId + blockId）
  docId: string;
  blockId: string;
  // 语义相似度分数
  score: number;
};

/**
 * 合并输出结果
 */
export type MergeOutput = {
  /**
   * 合并后的完整结果 Map。
   * 包含原有的 Chunk-Driven 结果 + 新增的去重后的 Discovery 结果。
   */
  mergedResults: Map<string, GraphAugmentation>;

  /**
   * 统计信息（用于日志或调试）
   */
  stats: {
    chunkDrivenCount: number;
    discoveryTotalCount: number;
    discoveryAddedCount: number;
    discoveryFilteredByDuplication: number;
    discoveryFilteredByScore: number;
  };
};

export class GraphResultMerger {
  /**
   * 带 Key 的合并逻辑 (为了解决 key 生成耦合问题)
   */
  mergeWithKeys(input: MergeInputWithKeys): MergeOutput {
    const { chunkDrivenResults, discoveryResults, minScoreThreshold = 0 } = input;
    const mergedResults = new Map<string, GraphAugmentation>(chunkDrivenResults);

    const stats = {
      chunkDrivenCount: chunkDrivenResults.size,
      discoveryTotalCount: discoveryResults.length,
      discoveryAddedCount: 0,
      discoveryFilteredByDuplication: 0,
      discoveryFilteredByScore: 0,
    };

    for (const item of discoveryResults) {
      if (item.score < minScoreThreshold) {
        stats.discoveryFilteredByScore++;
        continue;
      }

      if (mergedResults.has(item.key)) {
        stats.discoveryFilteredByDuplication++;
        continue;
      }

      mergedResults.set(item.key, item.augmentation);
      stats.discoveryAddedCount++;
    }

    return { mergedResults, stats };
  }
}

export type DiscoveryResultWithKey = DiscoveryResult & {
  /**
   * 与 chunkDrivenResults Map key 格式一致的键
   */
  key: string;
};

export type MergeInputWithKeys = {
  chunkDrivenResults: Map<string, GraphAugmentation>;
  discoveryResults: DiscoveryResultWithKey[];
  minScoreThreshold?: number;
};
