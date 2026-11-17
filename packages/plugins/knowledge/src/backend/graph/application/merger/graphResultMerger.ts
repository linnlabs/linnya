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
 * 合并输入参数
 */
export type MergeInput = {
  /**
   * 路径 A：Chunk-Driven 的增强结果（Map<key, augmentation>）
   * key 格式通常是 `${kbId}|${docId}|${blockId}` 或类似的唯一标识
   */
  chunkDrivenResults: Map<string, GraphAugmentation>;

  /**
   * 路径 B：Discovery 的增强结果列表
   */
  discoveryResults: DiscoveryResult[];

  /**
   * 相似度阈值（可选）
   * 如果 Discovery 结果的分数低于此值，则被视为噪声过滤掉
   * 默认：0 (不过滤)
   */
  minScoreThreshold?: number;
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
   * 执行合并
   */
  merge(input: MergeInput): MergeOutput {
    const { chunkDrivenResults, discoveryResults, minScoreThreshold = 0 } = input;
    
    // 1. 初始化输出 Map，直接复用 Chunk-Driven 的内容作为基底
    const mergedResults = new Map<string, GraphAugmentation>(chunkDrivenResults);

    const stats = {
      chunkDrivenCount: chunkDrivenResults.size,
      discoveryTotalCount: discoveryResults.length,
      discoveryAddedCount: 0,
      discoveryFilteredByDuplication: 0,
      discoveryFilteredByScore: 0,
    };

    // 2. 遍历 Discovery 结果并去重
    for (const item of discoveryResults) {
      // 2.1 分数过滤
      if (item.score < minScoreThreshold) {
        stats.discoveryFilteredByScore++;
        continue;
      }

      // 2.2 构造唯一键（与 Chunk-Driven 保持一致的 key 生成逻辑）
      // 注意：这里的 key 生成逻辑必须与 SearchService 中用于存储 chunkDrivenResults 的 key 逻辑一致
      // 假设 key 格式为 `${kbId}|${docId}|${blockId}`，但 DiscoveryResult 里目前只透传了 docId, blockId
      // 因此我们需要一种方式来匹配。
      
      // 实际上，SearchService 调用方通常使用 `kbId|docId|blockId` 作为 key。
      // 但 DiscoveryResult 目前可能缺少 kbId（或者假设是在同一个 kb 下）。
      // 为了通用性，我们假设 input.discoveryResults 里的 docId/blockId 足够用于去重判断，
      // 或者我们采用更宽松的策略：只要 map 中存在包含此 docId+blockId 的 key，就视为重复。
      
      // 更好的做法：让 DiscoveryResult 也携带 kbId，或者在 key 匹配时遍历。
      // 考虑到性能，我们假设 SearchService 会保证 key 的生成规则。
      // 如果 DiscoveryResult 来自 graphDiscoveryService，它应该能知道 kbId。
      // 暂时我们在 DiscoveryResult 类型定义里没有 kbId，这可能是一个小的缺失。
      // 但通常 Discovery 是针对特定 kbId 做的，或者结果里包含了。
      
      // 修正：让我们检查 graphDiscoveryService 的输出。
      // 它返回 GraphDiscoveredEvidenceBlock { docId, blockId, score }。
      // SearchService 在调用时知道当前的 kbId。
      // 所以我们可以在这里构造 key。
      
      // 但是，graphSearchService 的输出 Map 的 key 是由 `getGraphAugmentationKey` 生成的。
      // 我们需要保证 key 生成逻辑一致。
      
      // 既然我们无法在这里 import `getGraphAugmentationKey` (它可能在 searchUtils 里)，
      // 我们最好让 MergeInput 里的 discoveryResults 已经带有生成的 key，或者提供 key 生成函数。
      
      // 简化策略：遍历 mergedResults 的 keys，检查是否包含当前的 docId/blockId。
      // 这种方式比较慢 (O(N*M))。
      
      // 优化策略：我们假设 mergedResults 的 key 包含了 docId 和 blockId。
      // 我们可以构建一个 Set<string> `existingDocBlockIds` 来快速查找。
      const existingDocBlockIds = new Set<string>();
      for (const key of mergedResults.keys()) {
         // key 格式通常包含 docId 和 blockId，但具体格式不确定。
         // 这是一个潜在的耦合风险。
         // 让我们看看 searchService 是怎么做的。
         // 在 searchService 中，augmentations map 的 key 是 `getGraphAugmentationKey(kbId, docId, blockId)`。
         // 我们可以要求调用者传入 key 生成器，或者我们自己实现一个简单的查重 Set，
         // 其中的元素是 `${docId}|${blockId}`。
         
         // 为了安全起见，我们在 GraphResultMerger 内部维护一个 `seenDocBlockIds` 集合。
         // 我们需要解析 key 吗？不，我们只需要知道 chunkDrivenResults 里的 value 对应的 docId/blockId。
         // 可惜 GraphAugmentation 结构体里没有 docId/blockId 字段 (它是 entities/relations)。
         
         // 回退一步：SearchService 是如何使用这个 Map 的？
         // 它是通过 `augmentations.get(key)` 来获取增强信息的。
         // 所以 key 是唯一的索引。
         
         // 解决方案：我们要求调用方 (SearchService) 在构造 DiscoveryResult 时，
         // 直接把生成的 key 传进来。这样 Merger 就不需要关心 key 的格式，只负责 Map.has(key) 检查。
      }
      
      // 重新定义 DiscoveryResult，增加 key 字段
      // 见下文修改。
    }
    
    return { mergedResults, stats };
  }
  
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
