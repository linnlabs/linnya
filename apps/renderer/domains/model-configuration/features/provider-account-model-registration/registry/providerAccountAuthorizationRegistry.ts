import type { ProviderAccountAuthorizationOperations } from '../definitions/providerAccountAuthorizationOperations';
import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';
import { chatGptProviderAccountAuthorizationOperations } from '../orchestration/providerAccountAuthorizationOperations';

const operationsByConnectionId = new Map<string, ProviderAccountAuthorizationOperations>([
  ['openai-chatgpt-subscription', chatGptProviderAccountAuthorizationOperations],
]);

/**
 * 新增账号型 connection 时在这里注册独立授权实现，避免 UI 按供应商增加分支。
 */
export function resolveProviderAccountAuthorizationOperations(
  providerConnectionDefinitionId: string
): ProviderAccountAuthorizationOperations {
  const operations = operationsByConnectionId.get(providerConnectionDefinitionId);
  if (operations) return operations;

  throw new ProviderAccountAuthorizationError(
    'provider_account.unsupported_connection',
    '当前接入方案暂不支持账号授权'
  );
}
