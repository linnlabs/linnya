import { z } from 'zod';
import type { TranscriptionOutput } from '../definitions/transcriptionPort';

const QwenAudioAnnotationSchema = z.object({
  type: z.literal('audio_info'),
  language: z.string(),
});

const QwenAsrResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
      annotations: z.array(QwenAudioAnnotationSchema).optional(),
    }),
  })).min(1),
});

/**
 * 只接受 Qwen3-ASR-Flash 官方非流式响应合同。
 * 协议变化必须在 schema 与测试中显式升级，不能靠字段猜测静默吞掉。
 */
export function parseQwenAsrResponse(response: unknown): TranscriptionOutput {
  const parsed = QwenAsrResponseSchema.parse(response);
  const message = parsed.choices[0].message;
  const language = message.annotations?.[0]?.language;

  return {
    text: message.content,
    ...(language ? { language } : {}),
  };
}
