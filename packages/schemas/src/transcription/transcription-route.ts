import { z } from 'zod';

export const TRANSCRIPTION_CAPABILITY_IDS = {
  OPENAI_AUDIO_TRANSCRIPTIONS: 'host:openai-audio-transcriptions',
  DASHSCOPE_QWEN_ASR: 'host:dashscope-qwen-asr',
} as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const CanonicalBaseUrlSchema = NonEmptyStringSchema.transform(value => value.replace(/\/+$/, ''));

const TranscriptionRouteBaseSchema = z.object({
  endpoint_id: NonEmptyStringSchema,
  endpoint_model_id: NonEmptyStringSchema,
  base_url: CanonicalBaseUrlSchema,
});

export const OpenAiAudioTranscriptionsRouteSchema = TranscriptionRouteBaseSchema.extend({
  api_surface: z.literal('openai_audio_transcriptions'),
  capability_id: z.literal(TRANSCRIPTION_CAPABILITY_IDS.OPENAI_AUDIO_TRANSCRIPTIONS),
  auth_profile: z.literal('bearer'),
}).strict();

export const DashscopeQwenAsrRouteSchema = TranscriptionRouteBaseSchema.extend({
  api_surface: z.literal('dashscope_multimodal_generation'),
  capability_id: z.literal(TRANSCRIPTION_CAPABILITY_IDS.DASHSCOPE_QWEN_ASR),
  auth_profile: z.literal('bearer'),
}).strict();

export const TranscriptionRouteSchema = z.discriminatedUnion('api_surface', [
  OpenAiAudioTranscriptionsRouteSchema,
  DashscopeQwenAsrRouteSchema,
]);

export type TranscriptionRoute = z.infer<typeof TranscriptionRouteSchema>;

export function parseTranscriptionRoute(value: unknown): TranscriptionRoute {
  return TranscriptionRouteSchema.parse(value);
}
