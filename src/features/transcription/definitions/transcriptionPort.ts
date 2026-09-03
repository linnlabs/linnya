/**
 * Transcription feature 对上层公开的稳定合同。
 *
 * 这里不暴露 ASR SDK、供应商响应或模型注册表类型；调用方只需要知道
 * “提交音频并得到已归一化结果”这一项能力。
 */

export interface TranscriptionParams {
  language?: string;
  prompt?: string;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  temperature?: number;
}

export interface TranscriptionSegmentResult {
  start: number;
  end: number;
  text: string;
}

/** ASR adapter 完成供应商响应归一化后的业务数据。 */
export interface TranscriptionOutput {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegmentResult[];
}

/** Feature port 返回值额外携带最终实际使用的模型。 */
export interface TranscriptionResult extends TranscriptionOutput {
  modelId: string;
}

export interface TranscriptionPort {
  transcribe(
    modelId: string | undefined,
    audioFile: Uint8Array,
    filename: string,
    params?: TranscriptionParams,
  ): Promise<TranscriptionResult>;
}
