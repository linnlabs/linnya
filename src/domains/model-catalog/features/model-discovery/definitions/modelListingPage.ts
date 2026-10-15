import type { DiscoveredModel } from '@app/schemas';

/** 单页只有在分页合同通过校验后，才能参与完整目录的装配。 */
export interface ModelListingPage {
  readonly models: readonly DiscoveredModel[];
  readonly nextAfterId?: string;
}
