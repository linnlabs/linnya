/**
 * @file src/audio-preprocessing/types.ts
 * 
 * @brief 音频预处理相关的类型定义
 */

/**
 * 音频数据表示
 * 使用 Float32Array 存储归一化的音频样本（-1.0 到 1.0）
 */
export type AudioData = Float32Array;

/**
 * 音频片段
 * 
 * @description
 * 表示一个被切分出来的音频片段，包含时间范围和数据
 */
export interface AudioSegment {
  /**
   * 起始采样点位置
   */
  startSample: number;

  /**
   * 结束采样点位置
   */
  endSample: number;

  /**
   * 音频数据
   */
  data: AudioData;

  /**
   * 起始时间（秒）
   */
  startTime: number;

  /**
   * 结束时间（秒）
   */
  endTime: number;

  /**
   * 持续时长（秒）
   */
  duration: number;
}

/**
 * 语音时间戳（VAD 输出）
 */
export interface SpeechTimestamp {
  /**
   * 语音开始的采样点
   */
  start: number;

  /**
   * 语音结束的采样点
   */
  end: number;
}

/**
 * 音频加载结果
 */
export interface AudioLoadResult {
  /**
   * 音频波形数据
   */
  data: AudioData;

  /**
   * 采样率
   */
  sampleRate: number;

  /**
   * 声道数
   */
  channels: number;

  /**
   * 持续时长（秒）
   */
  duration: number;

  /**
   * 原始格式信息
   */
  originalFormat?: string;

  /**
   * 加载方式（用于调试）
   */
  loadMethod: 'native' | 'opus-decoder' | 'opus-decoder-worker';
}

/**
 * VAD 处理结果
 */
export interface VadProcessResult {
  /**
   * 切分后的音频片段列表
   */
  segments: AudioSegment[];

  /**
   * 检测到的语音时间戳
   */
  speechTimestamps: SpeechTimestamp[];

  /**
   * 是否使用了 VAD（false 表示降级为固定切分）
   */
  usedVad: boolean;

  /**
   * 处理方法描述
   */
  method: 'vad' | 'fixed';
}

/**
 * 音频保存选项
 */
export interface AudioSaveOptions {
  /**
   * 输出文件路径
   */
  outputPath: string;

  /**
   * 音频格式
   */
  format?: 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a';

  /**
   * 采样率
   */
  sampleRate: number;

  /**
   * 是否覆盖已存在的文件
   */
  overwrite?: boolean;
}

/**
 * 预处理管道选项
 */
export interface PreprocessingPipelineOptions {
  /**
   * 输入音频路径
   */
  inputPath: string;

  /**
   * 输出目录
   */
  outputDir: string;

  /**
   * 是否返回音频数据（而不仅仅是文件路径）
   */
  returnAudioData?: boolean;

  /**
   * 输出文件名前缀
   */
  outputPrefix?: string;

  /**
   * 进度回调函数（流式处理）
   */
  onProgress?: (percent: number, stage: string) => void;
}

/**
 * 预处理结果
 */
export interface PreprocessingResult {
  /**
   * 切分后的片段信息
   */
  segments: Array<{
    /**
     * 片段索引
     */
    index: number;

    /**
     * 输出文件路径
     */
    filePath: string;

    /**
     * 起始时间（秒）
     */
    startTime: number;

    /**
     * 结束时间（秒）
     */
    endTime: number;

    /**
     * 持续时长（秒）
     */
    duration: number;

    /**
     * 音频数据（如果 returnAudioData 为 true）
     */
    data?: AudioData;
  }>;

  /**
   * 原始音频总时长
   */
  totalDuration: number;

  /**
   * 是否使用了 VAD
   */
  usedVad: boolean;

  /**
   * 处理统计信息
   */
  stats: {
    /**
     * 片段总数
     */
    segmentCount: number;

    /**
     * 平均片段时长（秒）
     */
    avgSegmentDuration: number;

    /**
     * 最长片段时长（秒）
     */
    maxSegmentDuration: number;

    /**
     * 最短片段时长（秒）
     */
    minSegmentDuration: number;
  };
}

