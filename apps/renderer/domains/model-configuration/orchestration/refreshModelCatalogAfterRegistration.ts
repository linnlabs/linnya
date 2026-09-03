import { loadModelCatalog } from '../features/model-catalog';
import { loadModelPicker } from '../features/model-picker';

/** Host onboarding 已原子写入模型；Renderer 随后重读目录和 Host 组合选择投影。 */
export async function refreshModelCatalogAfterRegistration(): Promise<void> {
  await Promise.all([loadModelCatalog(), loadModelPicker()]);
}
