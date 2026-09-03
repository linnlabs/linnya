/**
 * @file src/transcription/config.example.ts
 * 
 * @brief 转录配置使用示例
 * 
 * @description
 * 展示前端如何调用转录 API（简单，用户友好）
 * 
 * @note 前端集成
 * - 当前：用户点击"一键转录"，前端只需传入音频路径和用户选择的模型
 * - 未来：用户可选择中文/英文，前端传入 language 参数即可
 */

import { transcribeLongAudio } from './index';

/**
 * 示例 1: 一键转录（当前前端集成方式）
 * 
 * 用户在 UI 中：
 * 1. 选择音频文件
 * 2. 选择 ASR 模型（Whisper / Qwen ASR / etc.）
 * 3. 点击"转录"按钮
 */
async function example1_oneClickTranscription(
  audioFile: string,
  userSelectedModel: string
) {
  const result = await transcribeLongAudio(audioFile, userSelectedModel);
  
  // 系统自动处理：
  // ✅ 音频切分（带重叠）
  // ✅ 分段转录
  // ✅ 智能合并（去除重叠）
  // ✅ 文本去重（修复 ASR 幻觉，中文优化）
  
  return result;
}

/**
 * 示例 2: 未来添加中英文选择（未来扩展）
 * 
 * 用户在 UI 中：
 * 1. 选择音频文件
 * 2. 选择 ASR 模型
 * 3. 选择语言：中文 / 英文
 * 4. 点击"转录"按钮
 */
async function example2_withLanguageSelection(
  audioFile: string,
  userSelectedModel: string,
  userSelectedLanguage: 'zh' | 'en' // 未来添加的语言选择
) {
  const result = await transcribeLongAudio(
    audioFile,
    userSelectedModel,
    {
      transcriptionParams: {
        language: userSelectedLanguage,
      },
    }
  );
  
  // 系统会根据语言自动应用对应的去重配置：
  // - 中文：charRepeatThreshold=5, patternRepeatThreshold=2
  // - 英文：charRepeatThreshold=10, patternRepeatThreshold=3
  
  return result;
}

/**
 * 示例 3: 带进度回调（可选）
 */
async function example3_withProgress(
  audioFile: string,
  userSelectedModel: string,
  onProgressUpdate: (progress: number, message: string) => void
) {
  const result = await transcribeLongAudio(
    audioFile,
    userSelectedModel,
    {
      onProgress: (percent, stage, message) => {
        onProgressUpdate(Math.round(percent), message || stage);
      },
    }
  );
  
  return result;
}

export {
  example1_oneClickTranscription,
  example2_withLanguageSelection,
  example3_withProgress,
};
