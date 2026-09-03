/**
 * @file apps/renderer/features/AudioBlock/utils/segmentBatcher.js
 * 
 * @brief Segment 分批工具
 * 
 * @description
 * 用于将转录 segments 按字符数分组，确保每批不超过指定限制。
 * 主要用于翻译等需要分批处理的场景。
 */

/**
 * 将 segments 分组，每组不超过指定字符数
 * 
 * @param {Array} segments - 原始 segments
 * @param {number} maxCharsPerBatch - 每批最大字符数（建议 2000）
 * @param {number} contextSize - 上下文段落数（默认 1，即包含上一批的最后 1 个段落作为上下文）
 * @returns {Array<Object>} 分组后的批次数组，每个批次包含:
 *   - segments: 要发送给 AI 的 segments（包含上下文）
 *   - skipCount: 提取结果时要跳过的段落数（上下文段落）
 *   - startIndex: 在原始数组中的起始索引
 * 
 * @description
 * 重要：按**完整 segment** 分批，绝不会在段落中间截断。
 * 
 * 分批策略（带上下文）：
 * - 第一批：正常分批，无上下文
 * - 后续批次：包含上一批的最后 N 个段落作为上下文
 * - AI 翻译时有上下文参考，但结果提取时跳过上下文部分
 * 
 * @example
 * const batches = splitSegmentsIntoBatches(segments, 2000, 1);
 * // 批次1: { segments: [1,2,3], skipCount: 0, startIndex: 0 }
 * // 批次2: { segments: [3,4,5], skipCount: 1, startIndex: 3 } // 3是上下文
 * // 批次3: { segments: [5,6,7], skipCount: 1, startIndex: 5 } // 5是上下文
 */
export function splitSegmentsIntoBatches(segments, maxCharsPerBatch = 2000, contextSize = 1) {
  const batches = [];
  let currentIndex = 0;
  
  while (currentIndex < segments.length) {
    const isFirstBatch = batches.length === 0;
    let currentBatch = [];
    let currentLength = 0;
    
    // 如果不是第一批，添加上下文段落
    let contextSegments = [];
    let skipCount = 0;
    
    if (!isFirstBatch && currentIndex > 0) {
      // 计算上下文起始位置
      const contextStart = Math.max(0, currentIndex - contextSize);
      contextSegments = segments.slice(contextStart, currentIndex);
      skipCount = contextSegments.length;
      
      // 将上下文加入当前批次
      currentBatch = [...contextSegments];
      currentLength = contextSegments.reduce((sum, seg) => {
        return sum + `${seg.timestamp} ${seg.text}\n`.length;
      }, 0);
      
      console.log(`📦 [分批策略] 批次 ${batches.length + 1}: 添加 ${skipCount} 个上下文段落`);
    }
    
    // 添加新段落，直到达到字符限制
    let segmentsAdded = 0;
    for (let i = currentIndex; i < segments.length; i++) {
      const segment = segments[i];
      const segmentText = `${segment.timestamp} ${segment.text}\n`;
      const segmentLength = segmentText.length;
      
      // 如果加入会超出限制，且已经添加了至少一个新段落，则结束
      if (currentLength + segmentLength > maxCharsPerBatch && segmentsAdded > 0) {
        break;
      }
      
      currentBatch.push(segment);
      currentLength += segmentLength;
      segmentsAdded++;
      
      // 处理超长 segment
      if (segmentLength > maxCharsPerBatch) {
        console.warn(`⚠️ [分批策略] segment ${i} 长度 ${segmentLength} 超过限制 ${maxCharsPerBatch}`);
        // 超长 segment 单独成批
        segmentsAdded = 1;
        break;
      }
    }
    
    // 记录批次信息
    batches.push({
      segments: currentBatch,
      skipCount: skipCount,
      startIndex: currentIndex,
      totalCount: currentBatch.length,
      newCount: segmentsAdded
    });
    
    console.log(`📦 [分批策略] 批次 ${batches.length}: ${currentBatch.length} 个段落（${skipCount} 上下文 + ${segmentsAdded} 新增），${currentLength} 字符`);
    
    // 更新索引
    currentIndex += segmentsAdded;
  }
  
  console.log(`📦 [分批策略] 总计: ${segments.length} 个段落 → ${batches.length} 批`);
  
  return batches;
}

/**
 * 计算 segments 的总字符数
 * 
 * @param {Array} segments - segments 数组
 * @returns {number} 总字符数
 */
export function calculateSegmentsLength(segments) {
  return segments.reduce((total, segment) => {
    const segmentText = `${segment.timestamp} ${segment.text}\n`;
    return total + segmentText.length;
  }, 0);
}

/**
 * 检查是否需要分批处理
 * 
 * @param {Array} segments - segments 数组
 * @param {number} threshold - 阈值字符数（默认 3000）
 * @returns {boolean} 是否需要分批
 */
export function needsBatching(segments, threshold = 3000) {
  const totalLength = calculateSegmentsLength(segments);
  return totalLength > threshold;
}

