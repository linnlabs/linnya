import {
  TranscriptionRouteSchema,
  type TranscriptionRoute,
} from '@app/schemas/transcription';

export function readTranscriptionRoute(
  value: unknown,
  source: {
    modelName: string;
    hasAudioTranscriptionCapability: boolean;
  }
): TranscriptionRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasAudioTranscriptionCapability) {
      throw new Error(
        '[ModelConfigProcessor] audio_transcription 模型必须声明 transcription_route。'
      );
    }
    return undefined;
  }
  if (!source.hasAudioTranscriptionCapability) {
    throw new Error(
      '[ModelConfigProcessor] 只有声明 audio_transcription capability 的模型才能配置 transcription_route。'
    );
  }

  const result = TranscriptionRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length
      ? `transcription_route.${issue.path.join('.')}`
      : 'transcription_route';
    throw new Error(`[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`);
  }
  if (result.data.endpoint_model_id !== source.modelName) {
    throw new Error(
      '[ModelConfigProcessor] transcription_route.endpoint_model_id 必须与 model_name 一致。'
    );
  }
  return result.data;
}
