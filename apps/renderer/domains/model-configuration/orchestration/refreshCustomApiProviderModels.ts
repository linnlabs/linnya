import {
  refreshCustomApiProvider,
  type CustomApiProviderRefreshGateway,
} from '../features/custom-model-registration';
import {
  loadModelCatalog,
  removeCommittedModelsFromCatalog,
  type ModelCatalogGateway,
} from '../features/model-catalog';
import { refreshModelPickerSource, type ModelPickerGateway } from '../features/model-picker';
import { clearBindingsForModel } from '../features/purpose-model-bindings';

/** Host 已提交远端快照后先清理删除绑定，重读失败不能撤销提交事实或残留失效选择。 */
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
      const result = await refreshCustomApiProvider(providerName, refreshGateway);
      for (const modelId of result.removed_model_ids) clearBindingsForModel(modelId);
      await removeCommittedModelsFromCatalog(result.removed_model_ids);
      return result.removed_model_ids;
    },
    () => loadModelCatalog(catalogGateway),
    pickerGateway
  );
}
