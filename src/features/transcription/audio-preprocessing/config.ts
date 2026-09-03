/**
 * @file src/audio-preprocessing/config.ts
 * 
 * @brief 音频预处理配置参数
 * 
 * @description
 * 集中管理所有音频预处理相关的配置参数，包括：
 * - 音频加载参数
 * - VAD 检测参数
 * - 切分策略参数
 */

/**
 * 深度 Partial 类型工具
 */
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/**
 * 音频预处理配置接口
 */
export interface AudioPreprocessingConfig {
  /**
   * 目标采样率（Hz）
   * @default 16000
   * @description 大多数语音识别模型使用 16kHz，高质量场景可使用 48000
   */
  sampleRate: number;

  /**
   * 目标声道数
   * @default 1
   * @description 1=单声道（推荐），2=立体声
   */
  channels: number;

  /**
   * VAD 配置
   */
  vad: {
    /**
     * 最小语音持续时长（毫秒）
     * @default 1500
     * @description 短于此时长的语音片段会被忽略，用于过滤短暂噪音
     */
    minSpeechDurationMs: number;

    /**
     * 最小静音持续时长（毫秒）
     * @default 500
     * @description 语音段之间的最小静音间隔，用于判断语音是否结束
     */
    minSilenceDurationMs: number;

    /**
     * 语音检测阈值
     * @default 0.5
     * @description 范围 0-1，越高越严格（只检测明确的语音）
     */
    threshold: number;
  };

  /**
   * 音频切分配置
   */
  segmentation: {
    /**
     * 目标切分时长（秒）
     * @default 120
     * @description 尝试在接近此时长处切分音频，会寻找最近的静音点
     */
    segmentThresholdS: number;

    /**
     * 最大切分时长（秒）
     * @default 180
     * @description 硬性上限，超过此时长会强制切分，无论是否在静音处
     */
    maxSegmentThresholdS: number;

    /**
     * 重叠时长（秒）
     * @default 5
     * @description 相邻片段之间的重叠时长，用于保证转录上下文完整性
     * 设置为 0 则不重叠（传统切分）
     */
    overlapS: number;

    /**
     * 是否启用 VAD 智能切分
     * @default true
     * @description false 时直接使用固定时长切分
     */
    enableVadSegmentation: boolean;
  };


  /**
   * 输出配置
   */
  output: {
    /**
     * 输出音频格式
     * @default 'wav'
     * @description 支持: 'wav', 'mp3', 'flac', 'ogg' 等
     */
    format: 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a';

    /**
     * 是否保留原始音频元数据
     * @default false
     */
    preserveMetadata: boolean;
  };
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: AudioPreprocessingConfig = {
  sampleRate: 16000,
  channels: 1,
  vad: {
    minSpeechDurationMs: 1500,
    minSilenceDurationMs: 500,
    threshold: 0.5,
  },
  segmentation: {
    // createSegments 会确保应用重叠后不超过此限制
    segmentThresholdS: 90,    // 目标 1.5 分钟（保持合理的片段大小）
    maxSegmentThresholdS: 120, // 最大 2 分钟（Qwen ASR 硬性限制）
    overlapS: 5,               // 5 秒重叠
    enableVadSegmentation: false, // 🔍 调试：暂时禁用 VAD，使用固定切分
  },
  output: {
    format: 'wav',
    preserveMetadata: false,
  },
};

/**
 * 环境变量配置覆盖
 * 
 * @description
 * 从环境变量读取配置，优先级高于默认配置
 */
export function getConfigFromEnv(): Partial<AudioPreprocessingConfig> {
  const config: Partial<AudioPreprocessingConfig> = {};

  if (process.env.AUDIO_SAMPLE_RATE) {
    config.sampleRate = parseInt(process.env.AUDIO_SAMPLE_RATE, 10);
  }

  if (process.env.VAD_MIN_SPEECH_DURATION_MS) {
    config.vad = {
      ...DEFAULT_CONFIG.vad,
      minSpeechDurationMs: parseInt(process.env.VAD_MIN_SPEECH_DURATION_MS, 10),
    };
  }

  if (process.env.SEGMENT_THRESHOLD_S) {
    config.segmentation = {
      ...DEFAULT_CONFIG.segmentation,
      segmentThresholdS: parseInt(process.env.SEGMENT_THRESHOLD_S, 10),
    };
  }

  if (process.env.MAX_SEGMENT_THRESHOLD_S) {
    config.segmentation = {
      ...DEFAULT_CONFIG.segmentation,
      maxSegmentThresholdS: parseInt(process.env.MAX_SEGMENT_THRESHOLD_S, 10),
    };
  }

  return config;
}

/**
 * 合并配置
 * 
 * @param userConfig 用户自定义配置（支持深度部分配置）
 * @returns 合并后的完整配置
 */
export function mergeConfig(
  userConfig?: DeepPartial<AudioPreprocessingConfig>
): AudioPreprocessingConfig {
  const envConfig = getConfigFromEnv();
  
  return {
    ...DEFAULT_CONFIG,
    ...envConfig,
    ...userConfig,
    vad: {
      ...DEFAULT_CONFIG.vad,
      ...envConfig.vad,
      ...userConfig?.vad,
    },
    segmentation: {
      ...DEFAULT_CONFIG.segmentation,
      ...envConfig.segmentation,
      ...userConfig?.segmentation,
    },
    output: {
      ...DEFAULT_CONFIG.output,
      ...envConfig.output,
      ...userConfig?.output,
    },
  };
}

