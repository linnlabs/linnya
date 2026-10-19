import type { CustomApiFormat } from '@app/schemas/custom-api-onboarding';
import { ModelDiscoveryError } from '../definitions/modelDiscoveryError';
import {
  ModelListingIdentityResponseSchema,
  type ModelListingIdentity,
} from '../definitions/modelListingIdentity';
import type { ModelListingPage } from '../definitions/modelListingPage';
import { parseModelListingNextAfterId } from './parseModelListingPage';

export function parseModelIdentityListingPage(input: {
  readonly body: unknown;
  readonly apiFormat: CustomApiFormat;
  readonly visitedAfterIds: ReadonlySet<string>;
}): ModelListingPage<ModelListingIdentity> {
  const parsed = ModelListingIdentityResponseSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的列表格式无效', 502);
  }
  return {
    models: parsed.data.data,
    nextAfterId: parseModelListingNextAfterId({ ...input, modelCount: parsed.data.data.length }),
  };
}

/** 全部分页完成后再校验唯一性，不能让去重掩盖正式目录的身份冲突。 */
export function assertUniqueModelListingIdentities(models: readonly ModelListingIdentity[]): void {
  if (new Set(models.map(model => model.id)).size !== models.length) {
    throw new ModelDiscoveryError('model_discovery.failed', '供应商模型列表包含重复模型 ID', 502);
  }
}
