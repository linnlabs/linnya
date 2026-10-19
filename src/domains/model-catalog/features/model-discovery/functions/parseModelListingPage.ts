import { z } from 'zod';
import type { CustomApiFormat } from '@app/schemas/custom-api-onboarding';
import { ModelDiscoveryError } from '../definitions/modelDiscoveryError';
import type { ModelListingPage } from '../definitions/modelListingPage';
import { parseModelListingResponse } from './parseModelListingResponse';

const PaginationSchema = z.object({
  has_more: z.boolean().optional(),
  last_id: z.string().trim().min(1).nullish(),
});

export function parseModelListingPage(input: {
  readonly body: unknown;
  readonly apiFormat: CustomApiFormat;
  readonly visitedAfterIds: ReadonlySet<string>;
}): ModelListingPage {
  const models = parseModelListingResponse(input.body);
  return {
    models,
    nextAfterId: parseModelListingNextAfterId({ ...input, modelCount: models.length }),
  };
}

/** 两种列表投影共用完整性规则，不能只在自定义 API 路径验收分页。 */
export function parseModelListingNextAfterId(input: {
  readonly body: unknown;
  readonly apiFormat: CustomApiFormat;
  readonly visitedAfterIds: ReadonlySet<string>;
  readonly modelCount: number;
}): string | undefined {
  const pagination = PaginationSchema.safeParse(input.body);
  if (!pagination.success) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的分页格式无效', 502);
  }
  const { has_more: hasMore, last_id: lastId } = pagination.data;

  // 第一页可采用兼容服务的完整非分页列表；开始分页后必须有明确的终止标记。
  if (input.visitedAfterIds.size > 0 && hasMore === undefined) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务未声明分页是否完成', 502);
  }
  if (hasMore !== true) return undefined;

  if (input.apiFormat !== 'anthropic_compatible') {
    throw new ModelDiscoveryError(
      'model_discovery.unsupported_protocol',
      '模型服务返回了尚不支持的分页列表，无法取得完整目录',
      502
    );
  }
  if (!lastId || input.modelCount === 0) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的续页信息不完整', 502);
  }
  if (input.visitedAfterIds.has(lastId)) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回了重复的分页游标', 502);
  }
  return lastId;
}
