import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import type { ProviderDiscoveredModel } from 'src/app-hosts/linnya/adapters/provider-model-discovery';

/** 同一份已取得候选供设置页和正式注册消费，不能由 Renderer 自行拼模型能力。 */
export interface ProviderModelDiscoveryReadPort {
  read(connectionId: string): readonly ProviderDiscoveredModel[] | undefined;
  readAvailable(connectionId: string): readonly ProviderModelDefinition[] | undefined;
  supports(connectionId: string): boolean;
}

export interface ProviderModelDiscoveryUseCase extends ProviderModelDiscoveryReadPort {
  refresh(connectionId: string, signal?: AbortSignal): Promise<void>;
}
