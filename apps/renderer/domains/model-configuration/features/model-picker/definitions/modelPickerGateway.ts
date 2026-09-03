import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

export interface ModelPickerGateway {
  load(): Promise<ModelPickerSnapshot>;
  setProviderVisibility(
    configuredProviderId: string,
    visible: boolean
  ): Promise<ModelPickerSnapshot>;
  setModelVisibility(modelConfigId: string, visible: boolean): Promise<ModelPickerSnapshot>;
  activateProviderModel(
    configuredProviderId: string,
    providerModelId: string
  ): Promise<ModelPickerSnapshot>;
}
