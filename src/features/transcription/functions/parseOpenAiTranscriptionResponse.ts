import { z } from 'zod';
import type { TranscriptionOutput } from '../definitions/transcriptionPort';

const TranscriptionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

const OpenAiTranscriptionResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(TranscriptionSegmentSchema).optional(),
});

/** 将 OpenAI transcription JSON/verbose_json 响应投影为业务合同。 */
export function parseOpenAiTranscriptionResponse(response: unknown): TranscriptionOutput {
  return OpenAiTranscriptionResponseSchema.parse(response);
}
