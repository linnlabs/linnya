/**
 * @file src/transcription/utils/textDeduplicator.ts
 * 
 * @brief 文本去重工具
 * 
 * @description
 * 修复 ASR 转录结果中的重复问题：
 * 1. 单字符重复：如 "好好好好好" -> "好"
 * 2. 模式重复：如 "你好你好你好" -> "你好"
 * 
 * @note 去重职责划分
 * - **本模块**：处理 ASR 模型幻觉导致的字符/模式重复（纯文本分析）
 * - **transcriptionMerger**：处理音频切分导致的片段重叠（基于时间戳或文本对齐）
 * - 两层去重是互补的，通常在 transcriptionMerger 完成片段合并后调用本模块进行最终清理
 * 
 * 灵感来源：Qwen ASR Kit 的 post_text_process
 * https://github.com/QwenLM/Qwen-ASR-Kit
 */

/**
 * 修复单字符重复
 * 
 * @param text 输入文本
 * @param threshold 重复阈值（超过此次数视为异常重复）
 * @returns 去重后的文本
 * 
 * @example
 * fixCharRepeats("好好好好好", 3) // "好"
 * fixCharRepeats("你好好好好", 3) // "你好"
 */
function fixCharRepeats(text: string, threshold: number): string {
  const result: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    let count = 1;
    // 统计连续相同字符的数量
    while (i + count < n && text[i + count] === text[i]) {
      count++;
    }

    if (count > threshold) {
      // 超过阈值，只保留一个
      result.push(text[i]);
    } else {
      // 未超过阈值，保持原样
      result.push(text.substring(i, i + count));
    }
    
    i += count;
  }

  return result.join('');
}

/**
 * 宽松的模式重复修复
 * 
 * 允许重复单元之间夹杂空白符（空格、制表符、换行），
 * 用于处理 "哈喽！ 哈喽！"、"hello \n hello" 这类被空白打断的重复。
 */
function fixPatternRepeatsLoose(
  text: string,
  threshold: number,
  maxPatternLength: number = 20
): string {
  const n = text.length;
  const minRepeatChars = threshold * 2;

  if (n < minRepeatChars) {
    return text;
  }

  let i = 0;
  const result: string[] = [];

  // 预编译一个“可忽略空白”的比较函数
  const normalize = (s: string) => s.replace(/\s+/g, '');
  const startsInsideLatinWord = (index: number) =>
    index > 0 && /[A-Za-z0-9]/.test(text[index - 1]) && /[A-Za-z0-9]/.test(text[index]);

  while (i <= n - minRepeatChars) {
    let found = false;

    // 单字符连续重复由 fixCharRepeats 按更高阈值处理；这里从两个字符开始，
    // 避免把 “Hello” 的 ll、“今天”后的天等正常双字符误判为模式幻觉。
    for (let patternLen = 2; patternLen <= maxPatternLength; patternLen++) {
      if (i + patternLen > n) break;
      if (startsInsideLatinWord(i)) continue;

      const rawPattern = text.substring(i, i + patternLen);
      const normPattern = normalize(rawPattern);
      if (normPattern.length === 0) continue;

      // 从当前位置开始，允许各重复单元之间存在任意数量的空白符
      let reps = 1;
      let cursor = i + patternLen;
      while (cursor < n) {
        // 跳过空白
        const wsMatch = text.substring(cursor).match(/^\s+/);
        if (wsMatch) cursor += wsMatch[0].length;

        const candidate = text.substring(cursor, cursor + patternLen);
        if (normalize(candidate) === normPattern) {
          reps++;
          cursor += patternLen;
        } else {
          break;
        }
      }

      if (reps >= threshold) {
        // 只保留一个模式，将后续部分递归处理
        result.push(rawPattern);
        result.push(fixPatternRepeatsLoose(text.substring(cursor), threshold, maxPatternLength));
        i = n; // 结束外层循环
        found = true;
        break;
      }
    }

    if (found) {
      break;
    } else {
      result.push(text[i]);
      i++;
    }
  }

  if (i < n) {
    result.push(text.substring(i));
  }

  return result.join('');
}

/**
 * 修复模式重复
 * 
 * @param text 输入文本
 * @param threshold 重复阈值（模式至少重复多少次才视为异常）
 * @param maxPatternLength 最大模式长度
 * @returns 去重后的文本
 * 
 * @example
 * fixPatternRepeats("你好你好你好", 3) // "你好"
 * fixPatternRepeats("今天天气好今天天气好", 2) // "今天天气好"
 */
function fixPatternRepeats(
  text: string, 
  threshold: number, 
  maxPatternLength: number = 20
): string {
  const n = text.length;
  const minRepeatChars = threshold * 2;

  // 文本太短，无需处理
  if (n < minRepeatChars) {
    return text;
  }

  let i = 0;
  const result: string[] = [];
  const startsInsideLatinWord = (index: number) =>
    index > 0 && /[A-Za-z0-9]/.test(text[index - 1]) && /[A-Za-z0-9]/.test(text[index]);

  while (i <= n - minRepeatChars) {
    let found = false;

    // 尝试不同长度的模式
    // 单字符重复不属于模式去重，否则中文正常叠字和英文双写字母会被破坏。
    for (let patternLen = 2; patternLen <= maxPatternLength; patternLen++) {
      if (i + patternLen * threshold > n) {
        break;
      }
      if (startsInsideLatinWord(i)) continue;

      const pattern = text.substring(i, i + patternLen);

      // 检查模式是否重复了至少 threshold 次
      let valid = true;
      for (let rep = 1; rep < threshold; rep++) {
        const startIdx = i + rep * patternLen;
        const segment = text.substring(startIdx, startIdx + patternLen);
        if (segment !== pattern) {
          valid = false;
          break;
        }
      }

      if (valid) {
        // 找到重复模式，计算总共重复了多少次
        let totalReps = threshold;
        let endIndex = i + threshold * patternLen;
        
        while (endIndex + patternLen <= n) {
          const nextSegment = text.substring(endIndex, endIndex + patternLen);
          if (nextSegment === pattern) {
            totalReps++;
            endIndex += patternLen;
          } else {
            break;
          }
        }

        // 只保留一个模式，递归处理剩余部分
        result.push(pattern);
        result.push(fixPatternRepeats(text.substring(endIndex), threshold, maxPatternLength));
        i = n; // 结束外层循环
        found = true;
        break;
      }
    }

    if (found) {
      break;
    } else {
      // 未找到重复模式，保留当前字符
      result.push(text[i]);
      i++;
    }
  }

  if (i < n) {
    result.push(text.substring(i));
  }

  return result.join('');
}

/**
 * 文本去重处理（主函数）
 * 
 * @param text 输入文本
 * @param charRepeatThreshold 字符重复阈值（默认20）
 * @param patternRepeatThreshold 模式重复阈值（默认3）
 * @param maxPatternLength 最大模式长度（默认20）
 * @returns 去重后的文本
 * 
 * @example
 * deduplicateText("好好好好好，你好你好你好") 
 * // "好，你好"
 */
export function deduplicateText(
  text: string,
  charRepeatThreshold: number = 20,
  patternRepeatThreshold: number = 3,
  maxPatternLength: number = 20
): string {
  if (!text) {
    return text;
  }

  // 步骤1: 修复单字符重复
  let processed = fixCharRepeats(text, charRepeatThreshold);
  
  // 步骤2: 宽松模式去重（允许重复单元之间出现空白符）
  processed = fixPatternRepeatsLoose(processed, patternRepeatThreshold, maxPatternLength);

  // 步骤3: 严格模式去重（连续紧邻的重复单元）
  processed = fixPatternRepeats(processed, patternRepeatThreshold, maxPatternLength);
  
  return processed;
}

/**
 * 为中文优化的去重参数
 */
export const CHINESE_DEDUP_PARAMS = {
  charRepeatThreshold: 5,     // 中文单字重复超过5次视为异常
  patternRepeatThreshold: 2,  // 模式重复超过2次视为异常
  maxPatternLength: 10,       // 中文模式通常较短
};

/**
 * 为英文优化的去重参数
 */
export const ENGLISH_DEDUP_PARAMS = {
  charRepeatThreshold: 10,    // 英文字母重复容忍度稍高
  patternRepeatThreshold: 3,  // 模式重复超过3次视为异常
  maxPatternLength: 30,       // 英文模式可能较长
};
