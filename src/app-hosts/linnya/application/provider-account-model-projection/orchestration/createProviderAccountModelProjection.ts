import { CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID } from 'src/domains/provider-account';
import type {
  ProviderAccountModelProjection,
  ProviderAccountModelProjectionDependencies,
} from '../definitions/providerAccountModelProjection';
import { buildChatGptImageGenerationModel } from '../functions/buildChatGptImageGenerationModel';

export function createProviderAccountModelProjection(
  dependencies: ProviderAccountModelProjectionDependencies
): ProviderAccountModelProjection {
  return {
    synchronize(providerConnectionDefinitionId, accountId) {
      if (providerConnectionDefinitionId !== CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID) {
        throw new Error(`Provider account 模型投影尚未注册: ${providerConnectionDefinitionId}`);
      }
      const binding = dependencies.runtimeBindings.get(providerConnectionDefinitionId);
      if (!binding) {
        throw new Error(
          `Provider account 模型投影缺少 runtime binding: ${providerConnectionDefinitionId}`
        );
      }
      dependencies.modelCatalog.replaceAccountModels(accountId, [
        buildChatGptImageGenerationModel(accountId, binding),
      ]);
    },
    remove(accountId) {
      dependencies.modelCatalog.removeAccountModels(accountId);
    },
  };
}
