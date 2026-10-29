import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';
import type {
  ProviderAccountAuthorizationOperations,
  ProviderAccountAuthorizationOutcome,
} from '../definitions/providerAccountAuthorizationOperations';

export async function authorizeProviderAccount(
  operations: ProviderAccountAuthorizationOperations
): Promise<ProviderAccountAuthorizationOutcome> {
  try {
    return { status: (await operations.authorize()).status };
  } catch (error: unknown) {
    if (
      !(error instanceof ProviderAccountAuthorizationError) ||
      error.code !== 'provider_account.model_synchronization_failed'
    ) {
      throw error;
    }
    // 模型同步失败发生在凭据落盘之后。连接状态以 Host 为准，不能留在登录前状态，
    // 也不能吞掉同步错误，让用户误以为模型已经准备就绪。
    const account = await operations.getStatus();
    return { status: account.status, modelSynchronizationFailure: error };
  }
}
