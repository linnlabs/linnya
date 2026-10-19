import type { DiscoveredModel } from '@app/schemas';
import type { CustomApiFormat } from '@app/schemas/custom-api-onboarding';

export interface ModelListingPageInput {
  readonly body: unknown;
  readonly apiFormat: CustomApiFormat;
  readonly visitedAfterIds: ReadonlySet<string>;
}

/** 单页只有在分页合同通过校验后，才能参与完整目录的装配。 */
export interface ModelListingPage<Model = DiscoveredModel> {
  readonly models: readonly Model[];
  readonly nextAfterId?: string;
}
