/**
 * @file src/transcription/transcriptionMerger.ts
 * 
 * @brief 转录结果智能合并器
 * 
 * @description
 * 用于合并多个重叠片段的转录结果，避免重复内容。
 * 支持两级合并策略：
 * 1. 基于时间戳的精确对齐（优先，需要 verbose_json 格式）
 * 2. 基于文本相似度的软对齐（降级方案）
 * 
 * @note 去重职责划分
 * - **本模块**：处理音频切分导致的片段重叠（设计上的 5 秒重叠区域）
 * - **textDeduplicator**：处理 ASR 模型幻觉导致的字符/模式重复（如"好好好好好"）
 * - 两层去重是互补的，缺一不可
 */

import { Logger } from '@shared/logger';
import { deduplicateText } from './utils/textDeduplicator';
import { MergeConfig, createMergeConfig } from './config';

const logger = new Logger('transcriptionMerger');

/**
 * 转录片段（带时间戳）
 */
export interface TranscriptionSegment {
  /**
   * 片段索引
   */
  index: number;

  /**
   * 转录文本
   */
  text: string;

  /**
   * 片段在原始音频中的起始时间（秒）
   */
  audioStartTime: number;

  /**
   * 片段在原始音频中的结束时间（秒）
   */
  audioEndTime: number;

  /**
   * 单词级时间戳（可选，来自 verbose_json）
   */
  words?: Array<{
    word: string;
    start: number;  // 相对于片段开始的时间（秒）
    end: number;
  }>;

  /**
   * 句子级时间戳（可选，来自 verbose_json）
   */
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

/**
 * 时间戳置信度级别
 */
export type TimestampConfidence = 'high' | 'medium' | 'low';

/**
 * 合并结果
 */
export interface MergeResult {
  /**
   * 合并后的完整文本
   */
  text: string;

  /**
   * 使用的合并方法
   */
  method: 'timestamp' | 'text_alignment' | 'hybrid';

  /**
   * 合并统计信息
   */
  stats: {
    /**
     * 输入片段数
     */
    inputSegments: number;

    /**
     * 去重次数
     */
    deduplicationCount: number;

    /**
     * 平均重叠置信度
     */
    avgOverlapConfidence: number;

    /**
     * 时间戳回退次数（新增）
     */
    timestampRegressions?: number;

    /**
     * 文本对齐兜底次数（新增）
     */
    textAlignCorrections?: number;

    /**
     * 估算偏移平均值（毫秒，新增）
     */
    estimatedOffsetsAvgMs?: number;
  };

  /**
   * 合并后的段落信息（可选）
   */
  mergedSegments?: Array<{
    text: string;
    startTime: number;
    endTime: number;
    sourceSegmentIndex: number;
    /**
     * 时间戳置信度（新增）
     */
    confidence?: TimestampConfidence;
  }>;
}

interface TimedTextItem {
  text: string;
  startTime: number;
  endTime: number;
  sourceIndex: number;
  confidence?: TimestampConfidence;
}

/**
 * 转录合并器
 */
export class TranscriptionMerger {
  private config: Required<MergeConfig> & { deduplication: { charRepeatThreshold: number; patternRepeatThreshold: number; maxPatternLength: number } };

  constructor(config: MergeConfig, language?: string) {
    this.config = createMergeConfig(config, language);
  }

  /**
   * 合并多个转录片段
   * 
   * @param segments 转录片段列表（按时间顺序）
   * @returns 合并结果
   */
  async merge(segments: TranscriptionSegment[]): Promise<MergeResult> {
    if (segments.length === 0) {
      return {
        text: '',
        method: 'timestamp',
        stats: {
          inputSegments: 0,
          deduplicationCount: 0,
          avgOverlapConfidence: 0,
        },
      };
    }

    if (segments.length === 1) {
      return {
        text: segments[0].text,
        method: 'timestamp',
        stats: {
          inputSegments: 1,
          deduplicationCount: 0,
          avgOverlapConfidence: 1,
        },
      };
    }

    logger.info(`开始合并 ${segments.length} 个转录片段`);

    // 按时间排序（防御性编程）
    const sortedSegments = [...segments].sort((a, b) => a.audioStartTime - b.audioStartTime);

    // 检测时间戳类型
    const timestampType = this.detectTimestampType(sortedSegments);

    // 策略 1: 基于时间戳的合并（根据时间戳类型选择实现）
    if (this.config.useTimestampMerging && timestampType !== 'none') {
      if (timestampType === 'word') {
        logger.info('使用时间戳合并 (单词级)');
        return await this.mergeWithWordTimestamps(sortedSegments);
      } else if (timestampType === 'sentence') {
        logger.info('使用时间戳合并 (句子级)');
        return await this.mergeWithSentenceTimestamps(sortedSegments);
      }
    }

    // 策略 2: 降级到文本对齐
    if (this.config.useTextAlignmentMerging) {
      logger.info('使用文本对齐合并 (无时间戳)');
      return await this.mergeWithTextAlignment(sortedSegments);
    }

    // 兜底：简单拼接（不推荐）
    logger.warn('使用简单拼接策略（可能存在重复）');
    return {
      text: sortedSegments.map(s => s.text).join(' '),
      method: 'timestamp',
      stats: {
        inputSegments: sortedSegments.length,
        deduplicationCount: 0,
        avgOverlapConfidence: 0,
      },
    };
  }

  /**
   * 检测时间戳的类型
   * @returns 'word' | 'sentence' | 'none'
   */
  private detectTimestampType(segments: TranscriptionSegment[]): 'word' | 'sentence' | 'none' {
    if (segments.length === 0) return 'none';

    // 检查是否所有片段都有单词级时间戳
    const hasWords = segments.every(s => s.words && s.words.length > 0);
    if (hasWords) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[合并] 检测到单词级时间戳');
      }
      return 'word';
    }

    // 检查是否所有片段都有句子级时间戳
    const hasSentences = segments.every(s => s.segments && s.segments.length > 0);
    if (hasSentences) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[合并] 检测到句子级时间戳');
      }
      return 'sentence';
    }

    // 没有时间戳信息
    if (process.env.NODE_ENV === 'development') {
      console.log('[合并] 未检测到时间戳信息');
    }
    return 'none';
  }

  /**
   * 基于单词级时间戳的合并（改进版）
   * @description 适用于返回 words 数组的模型（如某些高级 Whisper API）
   * 
   * 改进点：
   * 1. 使用复合键去重（时间分桶 + 单词内容）
   * 2. 允许同一时间点的不同词共存
   * 3. 支持时间戳抖动容差
   */
  private async mergeWithWordTimestamps(segments: TranscriptionSegment[]): Promise<MergeResult> {
    const mergedWords: TimedTextItem[] = [];
    let deduplicationCount = 0;
    const confidences: number[] = [];
    const addedWordKeys = new Set<string>();

    // 时间分桶辅助函数
    const bucketTime = (timeS: number): number => {
      return Math.round(timeS * 1000 / this.config.wordBucketMs) * this.config.wordBucketMs;
    };

    // 标准化单词（去除空格和标点，统一大小写）
    const normalizeWord = (word: string): string => {
      return word.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const words = segment.words || [];

      for (const wordInfo of words) {
        // 计算单词在原始音频中的绝对时间
        const absoluteStartTime = segment.audioStartTime + wordInfo.start;
        const absoluteEndTime = segment.audioStartTime + wordInfo.end;
        
        // 创建复合键：时间分桶 + 标准化单词 + 结束时间分桶
        const startBucket = bucketTime(absoluteStartTime);
        const endBucket = bucketTime(absoluteEndTime);
        const normalizedWord = normalizeWord(wordInfo.word);
        const wordKey = `${startBucket}-${normalizedWord}-${endBucket}`;

        if (!addedWordKeys.has(wordKey)) {
          mergedWords.push({
            text: wordInfo.word,
            startTime: absoluteStartTime,
            endTime: absoluteEndTime,
            sourceIndex: segment.index,
            confidence: 'high',
          });
          addedWordKeys.add(wordKey);
        } else {
          deduplicationCount++;
        }
      }

      confidences.push(1.0); // 时间戳合并的置信度为 100%
    }

    // 按时间排序
    mergedWords.sort((a, b) => a.startTime - b.startTime);
    
    // 组合成段落
    const { mergedSegments, rawText } = this._groupIntoSegments(mergedWords);

    // 应用去重处理（修复 ASR 幻觉重复）
    const text = this.applyDeduplication(rawText);
    
    if (rawText !== text) {
      logger.info(`文本去重: ${rawText.length} 字符 -> ${text.length} 字符`);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[合并] 去重详情: 减少 ${rawText.length - text.length} 字符`);
      }
    }

    return {
      text,
      method: 'timestamp',
      stats: {
        inputSegments: segments.length,
        deduplicationCount,
        avgOverlapConfidence: confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1,
      },
      mergedSegments,
    };
  }

  /**
   * 基于句子级时间戳的合并（改进版）
   * @description 适用于返回 segments 数组的模型（如标准 Whisper API）
   * 
   * 改进点：
   * 1. 使用"覆盖区追踪"而非固定的非重叠起点
   * 2. 支持时间戳抖动容差
   * 3. 检测时间戳回退并启用文本对齐兜底
   * 4. 改进去重ID（时间戳 + 文本前缀）
   */
  private async mergeWithSentenceTimestamps(segments: TranscriptionSegment[]): Promise<MergeResult> {
    const mergedSentences: TimedTextItem[] = [];
    let deduplicationCount = 0;
    let timestampRegressions = 0;
    let textAlignCorrections = 0;
    const confidences: number[] = [];
    
    // 用于跟踪已添加句子的唯一ID，避免重复
    const addedSentenceIds = new Set<string>();
    
    // 追踪已覆盖的时间边界（滚动更新）
    let coveredUntil = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const sentences = segment.segments || [];

      // 检测时间戳回退（与理论非重叠起点比较，避免把“正常重叠”误判为回退）
      const prevSegmentForRegression = i > 0 ? segments[i - 1] : undefined;
      const nonOverlapStart = prevSegmentForRegression
        ? prevSegmentForRegression.audioEndTime - this.config.overlapDurationS
        : 0;
      const regressionAmount = nonOverlapStart - segment.audioStartTime;
      const hasRegression = i > 0 && regressionAmount > this.config.timestampJitterToleranceS;
      if (hasRegression) {
        timestampRegressions++;
        // 仅当超过 1 秒才以 warn 级别提示，其他小幅度按开发环境输出，视为正常抖动/切分重叠
        if (regressionAmount > 1.0) {
          logger.warn(`检测到时间戳回退: 片段 ${i}, Δ=${regressionAmount.toFixed(2)}s`);
        } else if (process.env.NODE_ENV === 'development') {
          console.log(`[合并] 轻微时间戳回退(可忽略): 片段 ${i}, Δ=${regressionAmount.toFixed(2)}s`);
        }
      }

      for (const sentence of sentences) {
        // 计算句子在原始音频中的绝对时间
        const absoluteStartTime = segment.audioStartTime + sentence.start;
        const absoluteEndTime = segment.audioStartTime + sentence.end;
        const midpoint = (absoluteStartTime + absoluteEndTime) / 2;

        // 创建更精确的去重ID（时间戳 + 文本前缀）
        const timeHash = `${Math.round(absoluteStartTime * 100)}-${Math.round(absoluteEndTime * 100)}`;
        const textPrefix = sentence.text.trim().slice(0, 8);
        const sentenceId = `${timeHash}-${textPrefix}`;

        // 如果是第一个片段，直接添加所有句子
        if (i === 0) {
          if (!addedSentenceIds.has(sentenceId)) {
            mergedSentences.push({
              text: sentence.text,
              startTime: absoluteStartTime,
              endTime: absoluteEndTime,
              sourceIndex: segment.index,
              confidence: 'high',
            });
            addedSentenceIds.add(sentenceId);
            coveredUntil = Math.max(coveredUntil, absoluteEndTime);
          }
        } else {
          // 判断句子中点是否在已覆盖区域之外（考虑抖动容差）
          const isOutsideCoveredRegion = midpoint >= coveredUntil - this.config.timestampJitterToleranceS;
          
          if (isOutsideCoveredRegion) {
            // 句子在新区域，添加
            if (!addedSentenceIds.has(sentenceId)) {
              mergedSentences.push({
                text: sentence.text,
                startTime: absoluteStartTime,
                endTime: absoluteEndTime,
                sourceIndex: segment.index,
                confidence: 'high',
              });
              addedSentenceIds.add(sentenceId);
              coveredUntil = Math.max(coveredUntil, absoluteEndTime);
            } else {
              deduplicationCount++;
            }
          } else if (this.config.useHybridWhenRegression && hasRegression) {
            // 时间戳回退且句子在重叠区，尝试文本对齐兜底
            // 获取前一个片段的尾部文本和当前片段的头部文本
            const prevSegment = segments[i - 1];
            const prevText = prevSegment.text;
            const currentText = segment.text;
            
            // 简单的文本对齐检查：如果当前句子不在前一个片段中，则添加
            if (!prevText.includes(sentence.text.trim())) {
              if (process.env.NODE_ENV === 'development') {
                console.log(`[合并] 文本对齐兜底: 添加句子 "${sentence.text.slice(0, 20)}..."`);
              }
              if (!addedSentenceIds.has(sentenceId)) {
                mergedSentences.push({
                  text: sentence.text,
                  startTime: absoluteStartTime,
                  endTime: absoluteEndTime,
                  sourceIndex: segment.index,
                  confidence: 'medium', // 兜底的置信度降低
                });
                addedSentenceIds.add(sentenceId);
                textAlignCorrections++;
                coveredUntil = Math.max(coveredUntil, absoluteEndTime);
              }
            } else {
              deduplicationCount++;
            }
          } else {
            // 这个句子在已覆盖区域内，跳过
            deduplicationCount++;
          }
        }
      }
      confidences.push(1.0);
    }

    // 按时间排序
    mergedSentences.sort((a, b) => a.startTime - b.startTime);

    // 组合成段落
    const { mergedSegments, rawText } = this._groupIntoSegments(mergedSentences);
    
    // 应用去重处理（修复 ASR 幻觉重复）
    const text = this.applyDeduplication(rawText);
    
    if (rawText !== text) {
      logger.info(`文本去重: ${rawText.length} 字符 -> ${text.length} 字符`);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[合并] 去重详情: 减少 ${rawText.length - text.length} 字符`);
      }
    }

    return {
      text,
      method: timestampRegressions > 0 ? 'hybrid' : 'timestamp',
      stats: {
        inputSegments: segments.length,
        deduplicationCount,
        avgOverlapConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
        timestampRegressions,
        textAlignCorrections,
      },
      mergedSegments,
    };
  }

  /**
   * 基于文本对齐的合并（改进版）
   * 
   * @description
   * 适用于无时间戳的 ASR 模型（如 Qwen ASR）
   * 
   * 改进点：
   * 1. 使用 LCS 精确裁剪重叠文本
   * 2. 估算每个片段的时间偏移
   * 3. 生成带有 low confidence 的段落信息
   */
  private async mergeWithTextAlignment(segments: TranscriptionSegment[]): Promise<MergeResult> {
    let mergedText = segments[0].text;
    let deduplicationCount = 0;
    const confidences: number[] = [];
    const estimatedOffsets: number[] = [];
    const mergedSegments: NonNullable<MergeResult['mergedSegments']> = [];

    // 第一个片段直接添加
    mergedSegments.push({
      text: segments[0].text.trim(),
      startTime: segments[0].audioStartTime,
      endTime: segments[0].audioEndTime,
      sourceSegmentIndex: segments[0].index,
      confidence: 'low', // 无时间戳的片段标记为 low
    });

    for (let i = 1; i < segments.length; i++) {
      const currentSegment = segments[i];
      const prevSegment = segments[i - 1];

      // 估算语速：字符数 / 时长 = 字符每秒
      const prevDuration = prevSegment.audioEndTime - prevSegment.audioStartTime;
      const prevTextLength = prevSegment.text.length;
      const charsPerSecond = prevTextLength / prevDuration;

      const estimatedOverlapChars = Math.floor(this.config.overlapDurationS * charsPerSecond);

      // 提取前一个片段的尾部和当前片段的头部（扩大搜索范围）
      const searchWindow = Math.min(this.config.textAlignment.maxSearchWindowChars, estimatedOverlapChars * 2);
      const prevTail = prevSegment.text.slice(-searchWindow);
      const currentHead = currentSegment.text.slice(0, searchWindow);

      // 寻找最佳对齐点
      const alignment = this.findBestAlignment(prevTail, currentHead);

      if (alignment.confidence >= this.config.textAlignment.minConfidence) {
        // 找到了对齐点，精确裁剪
        const uniquePartOfCurrent = currentSegment.text.slice(alignment.offsetInCurrent);
        mergedText += ' ' + uniquePartOfCurrent;
        deduplicationCount++;
        confidences.push(alignment.confidence);
        
        // 估算时间偏移
        const estimatedOffsetS = alignment.overlapChars / charsPerSecond;
        estimatedOffsets.push(estimatedOffsetS * 1000); // 转换为毫秒
        
        // 计算估算的起始时间
        const estimatedStartTime = prevSegment.audioEndTime - this.config.overlapDurationS + estimatedOffsetS;
        
        mergedSegments.push({
          text: uniquePartOfCurrent.trim(),
          startTime: estimatedStartTime,
          endTime: currentSegment.audioEndTime,
          sourceSegmentIndex: currentSegment.index,
          confidence: 'low',
        });
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`[合并] 片段 ${i} 对齐成功，置信度: ${alignment.confidence.toFixed(2)}, 估算偏移: ${estimatedOffsetS.toFixed(2)}s`);
        }
      } else {
        // 未找到可靠对齐，保守地添加整个片段
        mergedText += ' ' + currentSegment.text;
        confidences.push(0);
        
        // 使用理论上的非重叠起点
        const fallbackStartTime = prevSegment.audioEndTime - this.config.overlapDurationS;
        
        mergedSegments.push({
          text: currentSegment.text.trim(),
          startTime: fallbackStartTime,
          endTime: currentSegment.audioEndTime,
          sourceSegmentIndex: currentSegment.index,
          confidence: 'low',
        });
        
        logger.warn(`片段 ${i} 对齐失败，置信度过低: ${alignment.confidence.toFixed(2)}，使用保守拼接`);
      }
    }

    // 应用去重处理（修复 ASR 幻觉重复）
    const finalText = this.applyDeduplication(mergedText);
    
    if (mergedText !== finalText) {
      logger.info(`文本去重: ${mergedText.length} 字符 -> ${finalText.length} 字符`);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[合并] 去重详情: 减少 ${mergedText.length - finalText.length} 字符`);
      }
    }

    return {
      text: finalText,
      method: 'text_alignment',
      stats: {
        inputSegments: segments.length,
        deduplicationCount,
        avgOverlapConfidence: confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0,
        estimatedOffsetsAvgMs: estimatedOffsets.length > 0
          ? estimatedOffsets.reduce((a, b) => a + b, 0) / estimatedOffsets.length
          : undefined,
      },
      mergedSegments,
    };
  }

  /**
   * 寻找两段文本的最佳对齐点（改进版）
   * 
   * @description
   * 使用最长公共子串（LCS）算法找到最佳匹配位置
   * 
   * 改进点：
   * 1. 使用真正的 LCS 而非字符集合相似度
   * 2. 返回精确的重叠字符数和偏移位置
   * 3. 支持顺序敏感的匹配
   * 
   * @param prevTail 前一个片段的尾部文本
   * @param currentHead 当前片段的头部文本
   * @returns 对齐结果：重叠字符数、当前文本的裁剪偏移、置信度
   */
  private findBestAlignment(
    prevTail: string,
    currentHead: string
  ): { overlapChars: number; offsetInCurrent: number; confidence: number } {
    const maxSearchWindow = this.config.textAlignment.maxSearchWindowChars;
    const minMatchChars = this.config.textAlignment.minMatchChars;

    // 限制搜索窗口大小
    const tail = prevTail.slice(-maxSearchWindow);
    const head = currentHead.slice(0, maxSearchWindow);

    // 寻找最长公共子串
    const lcs = this.findLongestCommonSubstring(tail, head);
    
    if (lcs.length < minMatchChars) {
      // 匹配太短，认为对齐失败
      return {
        overlapChars: 0,
        offsetInCurrent: 0,
        confidence: 0,
      };
    }

    // 找到 LCS 在 currentHead 中的位置
    const offsetInCurrent = head.indexOf(lcs) + lcs.length;
    
    // 计算置信度：LCS 长度 / 较短文本长度
    const confidence = lcs.length / Math.min(tail.length, head.length);

    return {
      overlapChars: lcs.length,
      offsetInCurrent,
      confidence,
    };
  }

  /**
   * 计算两段文本的相似度（简化版 Levenshtein 距离）
   * 
   * @returns 相似度分数 (0-1)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0;

    // 简化：使用字符级别的重叠率
    const set1 = new Set(str1.toLowerCase().split(''));
    const set2 = new Set(str2.toLowerCase().split(''));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * 将词语或句子等带有时间戳的条目组合成较大时间区间的段落（改进版）
   * 
   * 改进点：
   * 1. 透传 confidence 信息
   * 2. 聚合时保留最低的 confidence 级别
   */
  private _groupIntoSegments(items: TimedTextItem[]): {
    mergedSegments: NonNullable<MergeResult['mergedSegments']>;
    rawText: string;
  } {
    const finalMergedSegments: NonNullable<MergeResult['mergedSegments']> = [];

    if (items.length === 0) {
      return { mergedSegments: [], rawText: '' };
    }

    const minDuration = this.config.minSegmentDurationS;
    const maxDuration = this.config.maxSegmentDurationS;
    let targetDuration = minDuration + Math.random() * (maxDuration - minDuration);

    let currentSegmentText = '';
    let currentSegmentStartTime = items[0].startTime;
    let currentSegmentSourceIndex = items[0].sourceIndex;
    let currentSegmentConfidence: TimestampConfidence = items[0].confidence || 'high';

    // 辅助函数：获取最低的 confidence 级别
    const getLowestConfidence = (c1: TimestampConfidence, c2: TimestampConfidence): TimestampConfidence => {
      const order: Record<TimestampConfidence, number> = { high: 3, medium: 2, low: 1 };
      return order[c1] < order[c2] ? c1 : c2;
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const duration = item.endTime - currentSegmentStartTime;

      // 如果当前段落非空，并且已经达到目标时长，则结束当前段落
      if (currentSegmentText && duration >= targetDuration) {
        const lastItemEndTime = items[i - 1].endTime;

        finalMergedSegments.push({
          text: currentSegmentText.trim(),
          startTime: currentSegmentStartTime,
          endTime: lastItemEndTime,
          sourceSegmentIndex: currentSegmentSourceIndex,
          confidence: currentSegmentConfidence,
        });

        // 开始新段落
        currentSegmentText = item.text;
        currentSegmentStartTime = item.startTime;
        currentSegmentSourceIndex = item.sourceIndex;
        currentSegmentConfidence = item.confidence || 'high';
        // 为下一个段落设置新的随机目标时长
        targetDuration = minDuration + Math.random() * (maxDuration - minDuration);
      } else {
        currentSegmentText += (currentSegmentText ? ' ' : '') + item.text;
        // 更新 confidence 为最低级别
        if (item.confidence) {
          currentSegmentConfidence = getLowestConfidence(currentSegmentConfidence, item.confidence);
        }
      }
    }

    // 添加最后一个段落
    if (currentSegmentText) {
      const lastItem = items[items.length - 1];
      finalMergedSegments.push({
        text: currentSegmentText.trim(),
        startTime: currentSegmentStartTime,
        endTime: lastItem.endTime,
        sourceSegmentIndex: currentSegmentSourceIndex,
        confidence: currentSegmentConfidence,
      });
    }

    const rawText = finalMergedSegments.map(s => s.text).join(' ');
    return { mergedSegments: finalMergedSegments, rawText };
  }

  /**
   * 应用文本去重（第二层去重：修复 ASR 幻觉）
   * 
   * @param text 输入文本
   * @returns 去重后的文本
   */
  private applyDeduplication(text: string): string {
    const { deduplication } = this.config;
    
    return deduplicateText(
      text,
      deduplication.charRepeatThreshold,
      deduplication.patternRepeatThreshold,
      deduplication.maxPatternLength
    );
  }

  /**
   * 辅助方法：寻找最长公共子串
   */
  private findLongestCommonSubstring(str1: string, str2: string): string {
    const m = str1.length;
    const n = str2.length;
    let maxLength = 0;
    let endIndex = 0;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
          if (dp[i][j] > maxLength) {
            maxLength = dp[i][j];
            endIndex = i;
          }
        }
      }
    }

    return str1.slice(endIndex - maxLength, endIndex);
  }
}

/**
 * 便捷函数：使用默认配置合并
 */
export async function mergeTranscriptions(
  segments: TranscriptionSegment[],
  overlapDurationS: number = 5
): Promise<MergeResult> {
  const merger = new TranscriptionMerger({ overlapDurationS });
  return merger.merge(segments);
}

