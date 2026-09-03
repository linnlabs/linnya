/**
 * @file apps/renderer/features/AudioBlock/services/audioContentAiService.js
 * 
 * @brief 音频内容 AI 服务
 * 
 * @description
 * 提供音频转录内容的 AI 增强功能：
 * - 翻译：将转录内容翻译为目标语言
 * - 纪要/摘要：生成结构化的会议纪要或内容摘要
 * 
 * 使用 unifiedAPI 调用后端，不需要对话历史（单次任务）。
 */

import { generateTextStream } from '@shared/services/aiService/unifiedApiService.js';
import { TRANSLATION_PROMPT_KEY, AUDIO_SUMMARY_PROMPT_KEY } from '@app/schemas';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import { splitSegmentsIntoBatches, calculateSegmentsLength } from '../utils/segmentBatcher.js';

/**
 * 将转录 segments 格式化为带时间戳的文本
 * 
 * @param {Array} segments - 转录段落数组
 * @returns {string} 格式化的文本
 * 
 * @example
 * formatSegmentsToText([
 *   { timestamp: '00:00:00', text: 'Hello' },
 *   { timestamp: '00:00:05', text: 'World' }
 * ])
 * // 返回:
 * // "00:00:00 Hello
 * //  00:00:05 World"
 */
function formatSegmentsToText(segments) {
  if (!segments || segments.length === 0) {
    return '';
  }
  
  return segments
    .map(segment => `${segment.timestamp} ${segment.text}`)
    .join('\n');
}

/**
 * 将 HTML 格式的笔记转换为纯文本
 * 
 * @param {string} html - TipTap 编辑器生成的 HTML 内容
 * @returns {string} 转换后的纯文本
 * 
 * @description
 * 将 TipTap 编辑器生成的 HTML 内容转换为简洁的纯文本格式，
 * 保留时间戳信息，便于 AI 理解用户关注的重点。
 */
function htmlNotesToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  
  // 创建临时 DOM 元素来解析 HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // 处理时间戳标签（保留时间戳信息）
  const timestamps = tempDiv.querySelectorAll('.timestamp-tag');
  timestamps.forEach(timestamp => {
    const label = timestamp.textContent;
    timestamp.replaceWith(`[${label}]`);
  });
  
  // 获取纯文本内容
  let text = tempDiv.textContent || tempDiv.innerText || '';
  
  // 清理多余的空白字符
  text = text.trim().replace(/\n{3,}/g, '\n\n');
  
  return text;
}

/**
 * 将翻译结果文本解析为 segments
 * 
 * @param {string} translatedText - 翻译后的文本（可能带或不带时间戳）
 * @param {Array} originalSegments - 原始 segments（用于精确匹配）
 * @returns {Array} 包含翻译的 segments
 */
function parseTranslatedTextToSegments(translatedText, originalSegments) {
  const translatedLines = translatedText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  // 更宽松的时间戳正则：可能有或没有时间戳
  const timestampRegex = /^(\d{2}:\d{2}:\d{2})\s+(.+)$/;
  
  // 构建时间戳到翻译的映射
  const timestampMap = new Map();
  const pureTranslations = []; // 没有时间戳的翻译行
  
  translatedLines.forEach(line => {
    const match = line.match(timestampRegex);
    if (match) {
      const [, timestamp, translation] = match;
      timestampMap.set(timestamp, translation.trim());
    } else {
      // 没有时间戳，直接存储
      pureTranslations.push(line);
    }
  });
  
  console.log('📝 [AudioContentAI] 解析结果: 带时间戳', timestampMap.size, '个, 纯翻译', pureTranslations.length, '个');
  
  // 将翻译映射到原始 segments
  return originalSegments.map((segment, index) => {
    // 策略1：精确匹配时间戳
    let translation = timestampMap.get(segment.timestamp);
    
    if (translation) {
      return { ...segment, translation };
    }
    
    // 策略2：按索引匹配（AI可能没有输出时间戳）
    if (pureTranslations[index]) {
      return { ...segment, translation: pureTranslations[index] };
    }
    
    // 策略3：使用translatedLines的对应索引（最后的fallback）
    if (translatedLines[index]) {
      const fallbackText = translatedLines[index].replace(timestampRegex, '$2').trim() || translatedLines[index];
      return { ...segment, translation: fallbackText };
    }
    
    // 实在没办法，保持原文
    console.warn(`⚠️ [AudioContentAI] 索引 ${index} 未找到翻译，保持原文`);
    return { ...segment, translation: segment.text };
  });
}

/**
 * 翻译转录内容（支持智能分段）
 * 
 * @param {Object} transcriptContent - 转录内容对象 { segments: [...], metadata: {...} }
 * @param {string} targetLanguage - 目标语言（如 'English', '日本語', '한국어'）
 * @param {Object} callbacks - 流式回调
 * @param {Function} callbacks.onTextChunk - 接收到文本块时的回调
 * @param {Function} callbacks.onStreamEnd - 流结束时的回调
 * @param {Function} callbacks.onError - 发生错误时的回调
 * @param {Function} callbacks.onBatchProgress - 批次进度回调 (current, total)
 * @param {AbortSignal} [signal] - 用于取消请求的信号
 * @param {Object} [glossary] - 专有词表（可选）
 * @returns {Promise<Array>} 返回包含翻译的 segments
 */
export async function translateTranscript(transcriptContent, targetLanguage, callbacks = {}, signal = null, glossary = null) {
  console.log('🌐 [AudioContentAI] 开始翻译转录内容，目标语言:', targetLanguage);
  
  // 提取 segments
  const segments = transcriptContent?.segments || [];
  if (segments.length === 0) {
    throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.emptyTranscriptForTranslation'));
  }
  
  // 计算总字符数
  const totalChars = calculateSegmentsLength(segments);
  
  console.log('📝 [AudioContentAI] 待翻译文本长度:', totalChars, '字符');
  console.log('📝 [AudioContentAI] segments 数量:', segments.length);
  
  // 判断是否需要分批翻译（超过 3k 字符，考虑到输出可能更长）
  const shouldBatch = totalChars > 3000;
  
  if (shouldBatch) {
    console.log('📦 [AudioContentAI] 文本较长，启用分批翻译');
    return await translateInBatches(segments, targetLanguage, callbacks, signal, glossary);
  } else {
    console.log('📄 [AudioContentAI] 文本适中，整体翻译');
    return await translateWhole(segments, targetLanguage, callbacks, signal, glossary);
  }
}

/**
 * 整体翻译（适用于 <20k 字符）
 */
async function translateWhole(segments, targetLanguage, callbacks, signal, glossary) {
  const textToTranslate = formatSegmentsToText(segments);
  
  // 构建 prompt
  let prompt = `<text_to_translate>
${textToTranslate}
</text_to_translate>

<target_language>
${targetLanguage}
</target_language>`;

  // 如果有专有词表，添加到 prompt
  if (glossary && Object.keys(glossary).length > 0) {
    const glossaryText = Object.entries(glossary)
      .map(([term, translation]) => `${term} → ${translation}`)
      .join('\n');
    
    prompt += `

<glossary>
${glossaryText}
</glossary>`;
    
    console.log('📚 [AudioContentAI] 已添加专有词表，包含', Object.keys(glossary).length, '个术语');
  }
  
  let translatedText = '';
  
  // 调用统一 API
  try {
    await generateTextStream(
      {
        prompt,
        prompt_key: TRANSLATION_PROMPT_KEY,
      },
      {
        onTextChunk: (chunk) => {
          translatedText += chunk;
          callbacks.onTextChunk?.(chunk);
        },
        onStreamEnd: (data) => {
          console.log('✅ [AudioContentAI] 翻译完成');
          
          // 解析翻译结果
          const translatedSegments = parseTranslatedTextToSegments(translatedText, segments);
          callbacks.onStreamEnd?.(translatedSegments);
        },
        onError: (error) => {
          console.error('❌ [AudioContentAI] 翻译失败:', error);
          callbacks.onError?.(error);
        },
      },
      signal
    );
  } catch (error) {
    console.error('❌ [AudioContentAI] 翻译请求失败:', error);
    throw error;
  }
}

/**
 * 分批翻译（适用于 ≥3k 字符）
 * 每批包含上下文，完成后立即更新UI
 */
async function translateInBatches(segments, targetLanguage, callbacks, signal, glossary) {
  // 使用带上下文的分批，contextSize=1 表示包含上一批的最后1个段落
  const batches = splitSegmentsIntoBatches(segments, 2000, 1);
  console.log('📦 [AudioContentAI] 分为', batches.length, '批进行翻译（带上下文）');
  
  const allTranslatedSegments = [...segments]; // 克隆原始segments，逐步填充翻译
  
  for (let i = 0; i < batches.length; i++) {
    const batchInfo = batches[i];
    const { segments: batchSegments, skipCount, startIndex, newCount } = batchInfo;
    
    console.log(`📦 [AudioContentAI] 翻译第 ${i + 1}/${batches.length} 批: ${batchSegments.length} 个段落（跳过前 ${skipCount} 个上下文）`);
    
    // 通知进度
    callbacks.onBatchProgress?.(i + 1, batches.length);
    
    // 格式化批次文本（包含上下文）
    const batchText = formatSegmentsToText(batchSegments);
    
    // 构建 prompt
    let prompt = `<text_to_translate>
${batchText}
</text_to_translate>

<target_language>
${targetLanguage}
</target_language>`;

    // 如果有专有词表，添加到 prompt
    if (glossary && Object.keys(glossary).length > 0) {
      const glossaryText = Object.entries(glossary)
        .map(([term, translation]) => `${term} → ${translation}`)
        .join('\n');
      
      prompt += `

<glossary>
${glossaryText}
</glossary>`;
    }
    
    let batchTranslatedText = '';
    
    // 翻译当前批次
    await generateTextStream(
      {
        prompt,
        prompt_key: TRANSLATION_PROMPT_KEY,
      },
      {
        onTextChunk: (chunk) => {
          batchTranslatedText += chunk;
          callbacks.onTextChunk?.(chunk);
        },
        onStreamEnd: () => {
          // 解析翻译结果（包含上下文部分）
          const translatedBatch = parseTranslatedTextToSegments(batchTranslatedText, batchSegments);
          
          // 只提取新翻译的部分（跳过上下文）
          const newTranslations = translatedBatch.slice(skipCount);
          
          console.log(`📝 [AudioContentAI] 提取 ${newTranslations.length} 个新翻译（跳过 ${skipCount} 个上下文）`);
          
          // 将新翻译填充到正确位置
          newTranslations.forEach((translatedSegment, index) => {
            const globalIndex = startIndex + index;
            allTranslatedSegments[globalIndex] = translatedSegment;
          });
          
          // 每批完成后立即通知更新（实时反馈）
          callbacks.onBatchComplete?.(allTranslatedSegments, i + 1, batches.length);
          
          console.log(`✅ [AudioContentAI] 第 ${i + 1}/${batches.length} 批翻译完成`);
        },
        onError: (error) => {
          console.error(`❌ [AudioContentAI] 第 ${i + 1} 批翻译失败:`, error);
          throw error;
        },
      },
      signal
    );
  }
  
  console.log('✅ [AudioContentAI] 所有批次翻译完成，总计', allTranslatedSegments.length, '个段落');
  callbacks.onStreamEnd?.(allTranslatedSegments);
  
  return allTranslatedSegments;
}

/**
 * 生成音频转录纪要/摘要
 * 
 * @param {Object} transcriptContent - 转录内容对象 { segments: [...], metadata: {...} }
 * @param {Object} callbacks - 流式回调
 * @param {Function} callbacks.onTextChunk - 接收到文本块时的回调
 * @param {Function} callbacks.onStreamEnd - 流结束时的回调
 * @param {Function} callbacks.onError - 发生错误时的回调
 * @param {AbortSignal} [signal] - 用于取消请求的信号
 * @param {string} [userNotes] - 用户笔记内容（可选）
 * @returns {Promise<void>}
 */
export async function generateAudioSummary(transcriptContent, callbacks = {}, signal = null, userNotes = null) {
  console.log('📋 [AudioContentAI] 开始生成音频纪要');
  
  // 提取 segments
  const segments = transcriptContent?.segments || [];
  if (segments.length === 0) {
    throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.emptyTranscriptForSummary'));
  }
  
  // 格式化为带时间戳的文本
  const audioTranscript = formatSegmentsToText(segments);
  
  console.log('📝 [AudioContentAI] 转录文本长度:', audioTranscript.length);
  console.log('⏱️  [AudioContentAI] 音频时长:', transcriptContent.metadata?.duration, '秒');
  
  // 检查是否有用户笔记，并转换为纯文本
  let plainTextNotes = null;
  if (userNotes && userNotes.trim().length > 0) {
    plainTextNotes = htmlNotesToPlainText(userNotes);
    if (plainTextNotes.length > 0) {
      console.log('📝 [AudioContentAI] 包含用户笔记（已转换为纯文本），长度:', plainTextNotes.length);
    }
  }
  
  // 构建 prompt，如果有用户笔记则一并包含
  let prompt = `<audio_transcript>
${audioTranscript}
</audio_transcript>`;

  if (plainTextNotes && plainTextNotes.length > 0) {
    prompt += `

<user_notes>
${plainTextNotes}
</user_notes>`;
  }
  
  // 调用统一 API
  try {
    await generateTextStream(
      {
        prompt,
        prompt_key: AUDIO_SUMMARY_PROMPT_KEY,
      },
      {
        onTextChunk: (chunk) => {
          callbacks.onTextChunk?.(chunk);
        },
        onStreamEnd: (data) => {
          console.log('✅ [AudioContentAI] 纪要生成完成');
          callbacks.onStreamEnd?.(data);
        },
        onError: (error) => {
          console.error('❌ [AudioContentAI] 纪要生成失败:', error);
          callbacks.onError?.(error);
        },
      },
      signal
    );
  } catch (error) {
    console.error('❌ [AudioContentAI] 纪要生成请求失败:', error);
    throw error;
  }
}

/**
 * 从流式响应中收集完整文本
 * 
 * @param {Object} transcriptContent - 转录内容
 * @param {string} targetLanguage - 目标语言
 * @param {AbortSignal} [signal] - 取消信号
 * @returns {Promise<string>} 完整的翻译结果
 */
export async function translateTranscriptFullText(transcriptContent, targetLanguage, signal = null) {
  let fullText = '';
  
  await translateTranscript(
    transcriptContent,
    targetLanguage,
    {
      onTextChunk: (chunk) => {
        fullText += chunk;
      },
      onError: (error) => {
        throw error;
      },
    },
    signal
  );
  
  return fullText;
}

/**
 * 从流式响应中收集完整纪要
 * 
 * @param {Object} transcriptContent - 转录内容
 * @param {AbortSignal} [signal] - 取消信号
 * @returns {Promise<string>} 完整的纪要结果
 */
export async function generateAudioSummaryFullText(transcriptContent, signal = null) {
  let fullText = '';
  
  await generateAudioSummary(
    transcriptContent,
    {
      onTextChunk: (chunk) => {
        fullText += chunk;
      },
      onError: (error) => {
        throw error;
      },
    },
    signal
  );
  
  return fullText;
}
