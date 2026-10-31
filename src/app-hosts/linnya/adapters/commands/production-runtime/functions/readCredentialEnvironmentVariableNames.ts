import { modelCatalog } from 'src/domains/model-catalog';
import { WEB_READ_SERVICE_DEFINITIONS } from 'src/tools/web/webread';
import { WEB_SEARCH_SERVICE_DEFINITIONS } from 'src/tools/web/websearch';

/** 每次 launch 读取当前引用，避免 App 启动后新增的模型凭据变量被旧快照遗漏。 */
export function readCredentialEnvironmentVariableNames(): readonly string[] {
  const references = [
    ...modelCatalog.getModels().map(model => modelCatalog.getCredentialReference(model.id)),
    ...modelCatalog.getInferenceEndpoints().map(endpoint => endpoint.credential_reference),
  ];
  const names = new Set<string>();
  for (const reference of references) {
    if (reference?.kind === 'environment_variable') names.add(reference.environment_variable);
  }
  for (const definition of [
    ...Object.values(WEB_READ_SERVICE_DEFINITIONS),
    ...Object.values(WEB_SEARCH_SERVICE_DEFINITIONS),
  ]) {
    if (definition.environmentVariable) names.add(definition.environmentVariable);
  }
  return [...names];
}
