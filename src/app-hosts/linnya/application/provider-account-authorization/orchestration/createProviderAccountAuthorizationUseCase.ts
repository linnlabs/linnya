import {
  CHATGPT_OAUTH_CONFIG,
  CHATGPT_PROVIDER_ACCOUNT_ID,
  CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
  prepareChatGptOAuthFlow,
  type ProviderAccount,
} from 'src/domains/provider-account';
import { getLogger } from 'src/shared/logger';
import type {
  ProviderAccountAuthorizationDependencies,
  ProviderAccountAuthorizationUseCase,
} from '../definitions/providerAccountAuthorization';
import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';

const logger = getLogger('ProviderAccountAuthorization');

export function createProviderAccountAuthorizationUseCase(
  dependencies: ProviderAccountAuthorizationDependencies
): ProviderAccountAuthorizationUseCase {
  let activeAuthorization: Promise<unknown> | null = null;

  return {
    async authorizeChatGpt() {
      if (activeAuthorization) {
        throw new ProviderAccountAuthorizationError(
          'provider_account.authorization_in_progress',
          'ChatGPT 授权正在进行中',
          409
        );
      }
      logger.info('authorization.started', {
        provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
      });
      const authorization = (async () => {
        const prepared = prepareChatGptOAuthFlow();
        let callback;
        try {
          callback = await dependencies.loopback.listen({
            expected_state: prepared.state,
            timeout_ms: CHATGPT_OAUTH_CONFIG.callback_timeout_ms,
          });
        } catch {
          throw new ProviderAccountAuthorizationError(
            'provider_account.callback_unavailable',
            '无法启动 ChatGPT 授权回调，请确认本机 1455 端口未被占用',
            409
          );
        }
        logger.info('authorization.callback_ready', {
          provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          callback_port: CHATGPT_OAUTH_CONFIG.callback_port,
        });
        try {
          await dependencies.browser.open(prepared.authorization_url);
          logger.info('authorization.browser_opened', {
            provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          });
          const code = await callback.authorization_code;
          logger.info('authorization.callback_received', {
            provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          });
          let credential;
          try {
            credential = await dependencies.chatGptTokens.exchangeAuthorizationCode(
              code,
              prepared.code_verifier
            );
          } catch {
            throw new ProviderAccountAuthorizationError(
              'provider_account.token_exchange_failed',
              'ChatGPT 授权凭据交换失败，请重新登录',
              502
            );
          }
          logger.info('authorization.token_exchanged', {
            provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          });
          let account: ProviderAccount;
          try {
            account = await dependencies.accounts.putOAuthCredential(
              {
                id: CHATGPT_PROVIDER_ACCOUNT_ID,
                provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
                auth_method: 'oauth_pkce',
              },
              credential
            );
          } catch {
            throw new ProviderAccountAuthorizationError(
              'provider_account.credential_persistence_failed',
              'ChatGPT 已授权，但本机安全存储失败',
              500
            );
          }
          try {
            dependencies.accountModels.synchronize(
              CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
              CHATGPT_PROVIDER_ACCOUNT_ID
            );
            await dependencies.providerModels.synchronizeConnectedProviderModels(
              CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID
            );
          } catch {
            // 凭据已经安全落盘；下次启动会沿同一同步用例自动恢复，不能把它误报成授权失败。
            throw new ProviderAccountAuthorizationError(
              'provider_account.model_synchronization_failed',
              'ChatGPT 已授权，但本地模型同步失败；重启 Linnya 后会自动重试',
              500
            );
          }
          logger.info('authorization.models_synchronized', {
            provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          });
          return {
            account_id: account.id,
            provider_connection_definition_id: account.provider_connection_definition_id,
            status: 'connected' as const,
          };
        } catch (error: unknown) {
          if (error instanceof ProviderAccountAuthorizationError) throw error;
          const isTimeout = error instanceof Error && error.name === 'OAuthCallbackTimeoutError';
          throw new ProviderAccountAuthorizationError(
            isTimeout
              ? 'provider_account.authorization_expired'
              : 'provider_account.authorization_cancelled',
            isTimeout ? 'ChatGPT 授权已超时，请重试' : 'ChatGPT 授权未完成',
            400
          );
        } finally {
          await callback.close();
        }
      })();
      activeAuthorization = authorization;
      try {
        const result = await authorization;
        logger.info('authorization.completed', {
          provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          account_id: result.account_id,
        });
        return result;
      } catch (error: unknown) {
        logger.warn('authorization.failed', {
          provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
          code:
            error instanceof ProviderAccountAuthorizationError
              ? error.code
              : 'provider_account.authorization_unknown',
        });
        throw error;
      } finally {
        activeAuthorization = null;
      }
    },

    getChatGptStatus() {
      return {
        account_id: CHATGPT_PROVIDER_ACCOUNT_ID,
        provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
        status: dependencies.accounts.hasCredential(CHATGPT_PROVIDER_ACCOUNT_ID)
          ? 'connected'
          : 'disconnected',
      };
    },

    async disconnectChatGpt() {
      await dependencies.accounts.remove(CHATGPT_PROVIDER_ACCOUNT_ID);
      dependencies.accountModels.remove(CHATGPT_PROVIDER_ACCOUNT_ID);
      return {
        account_id: CHATGPT_PROVIDER_ACCOUNT_ID,
        provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
        status: 'disconnected',
      };
    },
  };
}
