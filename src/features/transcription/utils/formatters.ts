/**
 * @file src/transcription/formatters.ts
 * 
 * @brief 转录结果格式转换器
 * 
 * @description
 * 提供统一的格式转换功能，将各种 ASR 输出格式转换为前端期望的格式。
 * 职责：
 * - 格式化时间戳（秒 → "HH:MM:SS"）
 * - 统一字段名（start/end → startTime/endTime/timestamp）
 * - 处理无 segments 的短音频场景
 * 
 * 设计原则：
 * - 单一职责：只负责格式转换，不涉及业务逻辑
 * - 纯函数：输入相同则输出相同，无副作用
 * - 类型安全：使用明确的类型定义
 */

import { Logger } from '@shared/logger';

const logger = new Logger('transcriptionFormatters');

/**
 * 前端期望的段落格式
 */
export interface FormattedSegment {
  /** 段落文本 */
  text: string;
  
  /** 格式化的时间戳字符串（如 "00:01:23"） */
  timestamp: string;
  
  /** 开始时间（秒） */
  startTime: number;
  
  /** 结束时间（秒，可选） */
  endTime?: number;
  
  /** 翻译文本（可选） */
  translation?: string;
}

/**
 * 前端期望的转录结果格式
 */
export interface FormattedTranscriptionResult {
  /** 完整的转录文本 */
  text: string;
  
  /** 分段信息（带时间戳） */
  segments: FormattedSegment[];
  
  /** 元信息（可选） */
  metadata?: {
    language?: string;
    duration?: number;
    model?: string;
  };
}

/**
 * ASR 原始段落格式（Whisper verbose_json）
 */
export interface RawASRSegment {
  /** 段落文本 */
  text: string;
  
  /** 开始时间（秒） */
  start: number;
  
  /** 结束时间（秒） */
  end: number;
  
}

/**
 * 将秒数转换为 "HH:MM:SS" 格式
 * 
 * @param seconds 秒数（可以是小数）
 * @returns 格式化的时间戳字符串
 * 
 * @example
 * formatTimestamp(0) // "00:00:00"
 * formatTimestamp(65) // "00:01:05"
 * formatTimestamp(3661.5) // "01:01:01"
 */
export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
  ].join(':');
}

/**
 * 将 ASR 原始段落格式转换为前端格式
 * 
 * @param segment ASR 原始段落
 * @param offsetSeconds 时间偏移（用于长音频合并场景）
 * @returns 格式化的段落
 */
export function formatSegment(
  segment: RawASRSegment,
  offsetSeconds: number = 0
): FormattedSegment {
  const startTime = segment.start + offsetSeconds;
  const endTime = segment.end + offsetSeconds;
  
  return {
    text: segment.text.trim(),
    timestamp: formatTimestamp(startTime),
    startTime,
    endTime,
  };
}

/**
 * 将 ASR 转录结果转换为前端期望格式
 * 
 * @param transcriptionResult ASR 原始结果
 * @param options 转换选项
 * @returns 格式化的转录结果
 * 
 * @example
 * // 有 segments 的情况（Whisper verbose_json）
 * const result = formatTranscriptionResult({
 *   text: "Hello world",
 *   segments: [
 *     { text: "Hello", start: 0, end: 0.5 },
 *     { text: "world", start: 0.5, end: 1.0 }
 *   ]
 * });
 * 
 * // 无 segments 的情况（降级处理）
 * const result = formatTranscriptionResult({
 *   text: "Hello world"
 * });
 * // 返回: { text: "Hello world", segments: [{ text: "Hello world", timestamp: "00:00:00", startTime: 0 }] }
 */
export function formatTranscriptionResult(
  transcriptionResult: {
    text: string;
    segments?: RawASRSegment[];
    language?: string;
    duration?: number;
  },
  options: {
    /** 时间偏移（用于长音频场景） */
    offsetSeconds?: number;
    /** 如果无 segments，是否创建单个段落 */
    createSingleSegmentIfEmpty?: boolean;
    /** 模型名称（用于元信息） */
    modelName?: string;
  } = {}
): FormattedTranscriptionResult {
  const {
    offsetSeconds = 0,
    createSingleSegmentIfEmpty = true,
    modelName,
  } = options;

  let formattedSegments: FormattedSegment[] = [];

  // 情况 1: ASR 返回了 segments（推荐）
  if (transcriptionResult.segments && transcriptionResult.segments.length > 0) {
    formattedSegments = transcriptionResult.segments.map(segment =>
      formatSegment(segment, offsetSeconds)
    );
    
    logger.debug(`格式化了 ${formattedSegments.length} 个段落`);
  } 
  // 情况 2: ASR 未返回 segments，创建单个段落（降级方案）
  else if (createSingleSegmentIfEmpty && transcriptionResult.text) {
    formattedSegments = [{
      text: transcriptionResult.text.trim(),
      timestamp: formatTimestamp(offsetSeconds),
      startTime: offsetSeconds,
      endTime: offsetSeconds + (transcriptionResult.duration || 0),
    }];
    
    logger.debug('ASR 未返回 segments，创建了单个段落');
  }
  // 情况 3: 完全没有内容
  else {
    logger.warn('转录结果为空或无 segments');
  }

  return {
    text: transcriptionResult.text || '',
    segments: formattedSegments,
    metadata: {
      language: transcriptionResult.language,
      duration: transcriptionResult.duration,
      model: modelName,
    },
  };
}

/**
 * 合并多个格式化的转录结果（用于长音频场景）
 * 
 * @param results 多个转录结果
 * @returns 合并后的结果
 * 
 * @description
 * 注意：此函数假设 segments 已经去重（由 TranscriptionMerger 完成）
 * 此函数只负责简单的拼接和格式化
 */
export function mergeFormattedResults(
  results: FormattedTranscriptionResult[]
): FormattedTranscriptionResult {
  if (results.length === 0) {
    return {
      text: '',
      segments: [],
    };
  }

  if (results.length === 1) {
    return results[0];
  }

  // 合并文本
  const text = results.map(r => r.text).join(' ').trim();

  // 合并 segments（按时间排序）
  const allSegments = results.flatMap(r => r.segments);
  allSegments.sort((a, b) => a.startTime - b.startTime);

  // 合并元信息（取第一个有效值）
  const metadata = {
    language: results.find(r => r.metadata?.language)?.metadata?.language,
    duration: Math.max(...results.map(r => r.metadata?.duration || 0)),
    model: results.find(r => r.metadata?.model)?.metadata?.model,
  };

  return {
    text,
    segments: allSegments,
    metadata,
  };
}

/**
 * 单词级时间戳（某些高级 ASR 支持）
 */
export interface WordTimestamp {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * 将单词级时间戳聚合为句子级时间戳
 * 
 * @param words 单词级时间戳数组
 * @param options 聚合选项
 * @returns 句子级 segments
 * 
 * @description
 * **使用场景**：某些 ASR（如 Azure Speech, FunASR）返回单词级时间戳，
 * 但前端展示时应该按句子聚合，提供更好的阅读体验。
 * 
 * **聚合规则**：
 * - 按标点符号（。！？）分句
 * - 如果没有标点，按固定单词数（默认 10-15 个）分组
 * - 每个句子的 startTime 是第一个单词的 start
 * - 每个句子的 endTime 是最后一个单词的 end
 * 
 * @example
 * const words = [
 *   { text: "今天", start: 0.0, end: 0.5 },
 *   { text: "天气", start: 0.5, end: 1.0 },
 *   { text: "不错", start: 1.0, end: 1.5 },
 *   { text: "。", start: 1.5, end: 1.6 }
 * ];
 * 
 * const segments = aggregateWordsToSentences(words);
 * // 返回: [{ text: "今天天气不错。", startTime: 0.0, endTime: 1.6, timestamp: "00:00:00" }]
 */
export function aggregateWordsToSentences(
  words: WordTimestamp[],
  options: {
    /** 句子结束标点（中文） */
    sentenceEndPunctuation?: string[];
    /** 如果没有标点，每个句子的最大单词数 */
    maxWordsPerSentence?: number;
  } = {}
): FormattedSegment[] {
  const {
    sentenceEndPunctuation = ['。', '！', '？', '.', '!', '?', '…'],
    maxWordsPerSentence = 15,
  } = options;

  if (!words || words.length === 0) {
    logger.warn('单词列表为空，无法聚合');
    return [];
  }

  const sentences: FormattedSegment[] = [];
  let currentSentenceWords: WordTimestamp[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentSentenceWords.push(word);

    // 判断是否应该结束当前句子
    const shouldEndSentence =
      // 条件1: 遇到句子结束标点
      sentenceEndPunctuation.some(punct => word.text.includes(punct)) ||
      // 条件2: 达到最大单词数
      currentSentenceWords.length >= maxWordsPerSentence ||
      // 条件3: 这是最后一个单词
      i === words.length - 1;

    if (shouldEndSentence && currentSentenceWords.length > 0) {
      // 构建句子
      const sentenceText = currentSentenceWords.map(w => w.text).join('').trim();
      const startTime = currentSentenceWords[0].start;
      const endTime = currentSentenceWords[currentSentenceWords.length - 1].end;

      sentences.push({
        text: sentenceText,
        timestamp: formatTimestamp(startTime),
        startTime,
        endTime,
      });

      // 重置当前句子
      currentSentenceWords = [];
    }
  }

  logger.info(`将 ${words.length} 个单词聚合为 ${sentences.length} 个句子级段落`);
  return sentences;
}

/**
 * 验证格式化结果的完整性
 * 
 * @param result 格式化结果
 * @returns 是否有效
 */
export function validateFormattedResult(
  result: FormattedTranscriptionResult
): boolean {
  // 基本检查
  if (!result || typeof result !== 'object') {
    logger.error('结果不是有效对象');
    return false;
  }

  if (typeof result.text !== 'string') {
    logger.error('text 字段不是字符串');
    return false;
  }

  if (!Array.isArray(result.segments)) {
    logger.error('segments 字段不是数组');
    return false;
  }

  // 检查每个 segment 的完整性
  for (let i = 0; i < result.segments.length; i++) {
    const segment = result.segments[i];
    
    if (typeof segment.text !== 'string') {
      logger.error(`段落 ${i} 的 text 字段无效`);
      return false;
    }

    if (typeof segment.startTime !== 'number' || segment.startTime < 0) {
      logger.error(`段落 ${i} 的 startTime 字段无效`);
      return false;
    }

    if (typeof segment.timestamp !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(segment.timestamp)) {
      logger.error(`段落 ${i} 的 timestamp 格式无效`);
      return false;
    }
  }

  return true;
}
