import {
  refreshCustomApiProvider,
  type CustomApiProviderRefreshGateway,
} from '../features/custom-model-registration';
import { loadModelCatalog, type ModelCatalogGateway } from '../features/model-catalog';
import { refreshModelPickerSource, type ModelPickerGateway } from '../features/model-picker';

/** 刷新可能新增模型，必须同时重读目录和选择投影，并让同一操作负责错误状态。 */
export function refreshCustomApiProviderModels(
  providerName: string,
  sourceLabel: string,
  refreshGateway?: CustomApiProviderRefreshGateway,
  catalogGateway?: ModelCatalogGateway,
  pickerGateway?: ModelPickerGateway
): Promise<void> {
  return refreshModelPickerSource(
    sourceLabel,
    async () => {
      await refreshCustomApiProvider(providerName, refreshGateway);
      await loadModelCatalog(catalogGateway);
    },
    pickerGateway
  );
}
