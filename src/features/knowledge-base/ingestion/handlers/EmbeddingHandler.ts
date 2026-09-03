/**
 * @file src/knowledge-base/ingestion/handlers/EmbeddingHandler.ts
 * 
 * @brief EMBEDDING状态处理器
 * 
 * @description
 * 功能 (What): 处理文档向量化阶段的业务逻辑
 * 输入 (Input): TaskContext包含解析结果和向量化参数
 * 输出 (Output): StateTransitionResult，包含向量化结果
 * 副作用 (Side-effects): 调用AI引擎生成文本向量
 */

import { Logger } from 'src/shared/logger';
import { InternalStage, type StateHandler, type StateTransitionResult, type TaskContext } from '../definitions/state';
import type { EmbeddingPort } from 'src/domains/model-inference';
import type { SparseVector } from '../../infrastructure/qdrantRepository';
import type { ParsedContentBlock, VectorizedBlock, VectorizeResult } from '../ingestionTypes';
import { textsToSparseVectors } from '../utils/textToSparseVector';

const logger = new Logger('knowledge-base:ingestion:embedding-handler');

/**
 * 功能 (What): EMBEDDING状态处理器 - 文档向量化核心逻辑
 * 输入 (Input): 任务上下文，包含解析结果
 * 输出 (Output): 转换到STORING状态，包含向量化结果
 * 副作用 (Side-effects): 调用AI引擎，生成文本向量，分批处理
 */
export class EmbeddingHandler implements StateHandler {
  private readonly embedding: EmbeddingPort;

  constructor(embedding: EmbeddingPort) {
    this.embedding = embedding;
  }
  
  getName(): string {
    return 'EmbeddingHandler';
  }

  async execute(context: TaskContext): Promise<StateTransitionResult> {
    logger.info(`[EmbeddingHandler] 开始向量化: ${context.docId}`);

    try {
      // 验证解析结果
      if (!context.parseResult || !context.parseResult.contentBlocks) {
        throw new Error('缺少解析结果，无法进行向量化');
      }

      const contentBlocks: ParsedContentBlock[] = context.parseResult.contentBlocks;
      if (contentBlocks.length === 0) {
        logger.warn(`[EmbeddingHandler] 无内容块需要向量化: ${context.docId}`);
        
        // 无内容时直接跳到存储阶段
        return {
          success: true,
          newStage: InternalStage.STORING,
          context: { 
            ...context, 
            vectorizeResult: { vectorizedBlocks: [], metadata: { empty: true } },
            stageProgress: 100,
            currentProgress: 80 
          },
          message: '无内容需要向量化，跳过向量化阶段'
        };
      }

      logger.info(`[EmbeddingHandler] 开始向量化 ${contentBlocks.length} 个内容块`);
      
      // 初始化进度
      context.stageProgress = 0;

      // 步骤 1: 准备文本列表（与后处理产物一一对应，禁止在此处再次切分，避免 block_id/point_id 覆盖）
      const textsToEmbed = contentBlocks.map((block) => (block.text || '').trim());
      const totalBlocks = textsToEmbed.length;

      // 步骤 2: 分批向量化（稠密向量 + 稀疏向量）
      const batchSize = this.calculateBatchSize(totalBlocks);
      const vectorizedBlocks: VectorizedBlock[] = [];
      
      logger.info(`[EmbeddingHandler] 使用批量大小: ${batchSize}, 总共 ${totalBlocks} 个块`);

      for (let i = 0; i < totalBlocks; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, totalBlocks);
        const batchTexts = textsToEmbed.slice(i, batchEnd);
        
        // 更新进度：正在处理批次
        const batchProgress = Math.floor((i / totalBlocks) * 85); // 0-85%，留15%给稀疏向量和后处理
        context.stageProgress = batchProgress;
        
        logger.debug(`[EmbeddingHandler] 处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalBlocks / batchSize)}: ${i + 1}-${batchEnd}/${totalBlocks}`);

        // 🔥 步骤 2.1: 调用稠密向量化服务
        const batchVectors = await this.generateEmbeddings(batchTexts, context.embeddingModelId);
        
        // 🔥 步骤 2.2: 生成稀疏向量（BM25）
        const batchSparseVectors = await this.generateSparseVectors(batchTexts);
        
        // 将稠密向量和稀疏向量附加到对应的内容块（严格一一对应）
        for (let j = 0; j < batchTexts.length; j++) {
          const originalIndex = i + j;
          const originalBlock = contentBlocks[originalIndex];
          const vectorizedBlock: VectorizedBlock = {
            ...originalBlock,
            text: batchTexts[j],
            vector: batchVectors[j],
            sparse_vector: batchSparseVectors[j],
            vectorModel: context.embeddingModelId,
            sparseVectorModel: 'bm25',
            vectorTimestamp: Date.now()
          };
          vectorizedBlocks.push(vectorizedBlock);
        }

        // 更新完成进度
        const completedProgress = Math.floor(((i + batchTexts.length) / totalBlocks) * 85);
        context.stageProgress = completedProgress;
        
        logger.debug(`[EmbeddingHandler] 批次完成: ${i + batchTexts.length}/${totalBlocks} (${completedProgress}%)`);
      }

      // 步骤 3: 向量化后处理
      context.stageProgress = 95;
      logger.info(`[EmbeddingHandler] 向量化完成，开始后处理...`);
      
      // 验证向量结果
      const vectorDimension = vectorizedBlocks[0]?.vector?.length;
      const sparseVectorCount = vectorizedBlocks.filter(block => block.sparse_vector && block.sparse_vector.indices.length > 0).length;
      logger.info(`[EmbeddingHandler] 稠密向量维度: ${vectorDimension}, 稀疏向量数量: ${sparseVectorCount}/${vectorizedBlocks.length}`);

      // 步骤 4: 准备向量化结果
      const vectorizeResult: VectorizeResult = {
        vectorizedBlocks,
        metadata: {
          ...context.parseResult.metadata,
          embeddingModel: context.embeddingModelId,
          sparseVectorModel: 'bm25', // 🔥 新增：稀疏向量模型信息
          vectorDimension,
          totalVectors: vectorizedBlocks.length,
          totalSparseVectors: sparseVectorCount, // 🔥 新增：稀疏向量统计
          batchSize,
          processingTime: Date.now() - context.lastUpdated
        }
      };

      context.stageProgress = 100;
      logger.info(`[EmbeddingHandler] 混合向量化完成: ${vectorizedBlocks.length} 个稠密向量 + ${sparseVectorCount} 个稀疏向量，维度: ${vectorDimension}`);

      // 🔥 调试：打印最终的向量化结果 - 已移除
      // logger.info(`[EmbeddingHandler] DEBUG: Final vectorizeResult: \n${inspect(vectorizeResult, { depth: null, colors: false })}`);

      return {
        success: true,
        newStage: InternalStage.STORING,
        context: { 
          ...context, 
          vectorizeResult,
          stageProgress: 100,
          currentProgress: 80  // 向量化完成，整体进度80%
        },
        message: `混合向量化完成: ${vectorizedBlocks.length} 个向量（稠密+稀疏）`
      };

    } catch (error) {
      const errorMessage = `向量化失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[EmbeddingHandler] ${errorMessage}`, error);
      
      // 🔥 简化：失败清理现在在状态机层面统一处理
      return {
        success: false,
        newStage: InternalStage.FAILED,
        context: { ...context, errorMessage },
        error: errorMessage
      };
    }
  }

  /**
   * 功能 (What): 计算合适的批量处理大小
   * 输入 (Input): 总文本数量
   * 输出 (Output): 推荐的批量大小
   * 副作用 (Side-effects): 无
   */
  private calculateBatchSize(totalTexts: number): number {
    // 根据文本数量动态调整批量大小
    if (totalTexts <= 10) return totalTexts; // 小量数据一次处理
    if (totalTexts <= 50) return 5;          // 中等数据5个一批
    if (totalTexts <= 200) return 10;        // 较多数据10个一批
    return 20;                               // 大量数据20个一批
  }

  /**
   * 功能 (What): 生成文本向量
   * 输入 (Input): 文本数组和向量化模型ID
   * 输出 (Output): 向量数组
   * 副作用 (Side-effects): 调用AI引擎API
   */
  private async generateEmbeddings(texts: string[], modelId: string): Promise<number[][]> {
    try {
      const result = await this.embedding.embed({ modelId, values: texts });
      const vectors = result.vectors.map(vector => [...vector]);
      
      logger.debug(`[EmbeddingHandler] 稠密向量化完成: ${vectors.length} 个向量`);
      return vectors;
      
    } catch (error) {
      logger.error(`[EmbeddingHandler] 向量化API调用失败:`, error);
      throw new Error(`向量化API调用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 功能 (What): 生成稀疏向量（BM25）
   * 输入 (Input): 文本数组
   * 输出 (Output): 稀疏向量数组
   * 副作用 (Side-effects): 调用BM25引擎API
   */
  private async generateSparseVectors(texts: string[]): Promise<SparseVector[]> {
    try {
      // BM25 分词、停用词和哈希规则由共享 sparse-vector 实现统一维护。
      const sparseVectors = await textsToSparseVectors(texts);
      
      logger.debug(`[EmbeddingHandler] 稀疏向量化完成: ${sparseVectors.length} 个向量`);
      return sparseVectors;
      
    } catch (error) {
      logger.error(`[EmbeddingHandler] 稀疏向量化API调用失败:`, error);
      throw new Error(`稀疏向量化API调用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * 功能 (What): 验证向量的有效性
   * 输入 (Input): 向量数组
   * 输出 (Output): 验证结果对象
   * 副作用 (Side-effects): 无
   */
  private validateVectors(vectors: number[][]): { isValid: boolean; error?: string } {
    if (!vectors || vectors.length === 0) {
      return { isValid: false, error: '向量数组为空' };
    }

    const firstDimension = vectors[0].length;
    if (firstDimension === 0) {
      return { isValid: false, error: '向量维度为0' };
    }

    // 检查所有向量维度是否一致
    for (let i = 1; i < vectors.length; i++) {
      if (vectors[i].length !== firstDimension) {
        return { 
          isValid: false, 
          error: `向量维度不一致: 第1个向量${firstDimension}维，第${i + 1}个向量${vectors[i].length}维` 
        };
      }
    }

    // 检查向量是否包含有效数值
    for (let i = 0; i < vectors.length; i++) {
      for (let j = 0; j < vectors[i].length; j++) {
        const value = vectors[i][j];
        if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
          return { 
            isValid: false, 
            error: `向量包含无效数值: 第${i + 1}个向量，第${j + 1}个维度，值: ${value}` 
          };
        }
      }
    }

    return { isValid: true };
  }
}
