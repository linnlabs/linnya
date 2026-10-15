import { z } from 'zod';
import type { DiscoveredModel } from '@app/schemas';
import { inferModelCapabilitiesById } from '../../catalog-admission';
import { ModelDiscoveryError } from '../definitions/modelDiscoveryError';

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

const ListingEntrySchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().nullish(),
  display_name: z.string().nullish(),
  displayName: z.string().nullish(),
  context_length: z.unknown(),
  context_window: z.unknown(),
  contextWindow: z.unknown(),
  max_input_tokens: z.unknown(),
  max_tokens: z.unknown(),
  max_output_tokens: z.unknown(),
  maxOutputTokens: z.unknown(),
  limit: z.object({ context: z.unknown(), output: z.unknown() }).nullish(),
  top_provider: z
    .object({ max_completion_tokens: z.unknown(), context_length: z.unknown() })
    .nullish(),
  supports_image_input: z.unknown(),
  multimodal: z.unknown(),
  architecture: z.object({ modality: z.unknown() }).nullish(),
});
const IdentifiedEntrySchema = ListingEntrySchema.extend({ id: z.string().trim().min(1) });
const ListingSchema = z.union([
  z.object({ data: z.array(IdentifiedEntrySchema) }).transform(body => body.data),
  z.object({ models: z.array(IdentifiedEntrySchema) }).transform(body => body.models),
  z
    .object({ models: z.record(ListingEntrySchema) })
    .transform(body =>
      Object.entries(body.models).map(([id, entry]) => ({ ...entry, id: entry.id ?? id }))
    ),
]);

/**
 * 解析响应中的模型数据
 */
export function parseModelListingResponse(body: unknown): DiscoveredModel[] {
  const parsed = ListingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的列表格式无效', 502);
  }
  const entries = parsed.data;
  const results = new Map<string, DiscoveredModel>();

  for (const entry of entries) {
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : undefined;
    if (!rawId)
      throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的模型 ID 无效', 502);

    const rawName =
      (typeof entry.name === 'string' && entry.name.trim()) ||
      (typeof entry.display_name === 'string' && entry.display_name.trim()) ||
      (typeof entry.displayName === 'string' && entry.displayName.trim()) ||
      rawId;

    // 尝试读取提供方报告的容量
    const reportedContextWindow = positiveInteger(
      entry.context_window ??
        entry.contextWindow ??
        entry.context_length ??
        entry.max_input_tokens ??
        entry.limit?.context ??
        entry.top_provider?.context_length
    );

    const reportedMaxOutput = positiveInteger(
      entry.max_output_tokens ??
        entry.maxOutputTokens ??
        entry.max_tokens ??
        entry.limit?.output ??
        entry.top_provider?.max_completion_tokens
    );

    const reportedImageSupport =
      typeof entry.supports_image_input === 'boolean'
        ? entry.supports_image_input
        : typeof entry.multimodal === 'boolean'
          ? entry.multimodal
          : typeof entry.architecture?.modality === 'string' &&
              entry.architecture.modality.includes('image')
            ? true
            : undefined;

    // 兼容端点通常不报告容量；沿用目录的唯一推断规则，并显式标注 confidence。
    const inferred = inferModelCapabilitiesById(rawId);

    const finalContextWindow = reportedContextWindow ?? inferred.context_window_tokens ?? 32768;
    const finalMaxOutput = reportedMaxOutput ?? inferred.max_output_tokens ?? 4096;
    const finalImageSupport = reportedImageSupport ?? inferred.supports_image_input ?? false;

    const confidence =
      reportedContextWindow !== undefined && reportedMaxOutput !== undefined
        ? 'reported'
        : inferred.context_window_tokens !== undefined
          ? 'inferred'
          : 'fallback';

    results.set(rawId, {
      id: rawId,
      name: rawName,
      context_window_tokens: finalContextWindow,
      max_output_tokens: finalMaxOutput,
      supports_image_input: finalImageSupport,
      confidence,
    });
  }

  return [...results.values()];
}
