import { Router, type Request, type Response } from 'express';
import {
  DirectProviderConnectionOnboardingCommandSchema,
  DirectProviderCredentialReplacementCommandSchema,
  type ProviderOnboardingErrorResponse,
} from '@app/schemas/provider-onboarding';
import {
  ProviderOnboardingError,
  type ProviderOnboardingUseCase,
} from 'src/app-hosts/linnya/application/provider-onboarding';

function sendError(
  response: Response,
  statusCode: number,
  error: ProviderOnboardingErrorResponse
): void {
  response.status(statusCode).json(error);
}

/** Provider onboarding 的 HTTP adapter；不读取或拼接任何 runtime route 字段。 */
export function createProviderOnboardingRouter(
  useCase: Pick<
    ProviderOnboardingUseCase,
    'configureDirectProvider' | 'replaceDirectProviderCredential'
  >
): Router {
  const router = Router();

  router.post('/direct-providers', async (request: Request, response: Response) => {
    const parsed = DirectProviderConnectionOnboardingCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'provider_onboarding.invalid_command',
        message: 'Provider 连接内容无效',
      });
      return;
    }

    try {
      const result = await useCase.configureDirectProvider(parsed.data);
      response.status(201).json(result);
    } catch (error: unknown) {
      if (error instanceof ProviderOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'provider_onboarding.registration_failed',
        message: 'Provider 连接失败',
      });
    }
  });

  router.put('/direct-providers/credential', async (request: Request, response: Response) => {
    const parsed = DirectProviderCredentialReplacementCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'provider_onboarding.invalid_command',
        message: 'Provider 密钥内容无效',
      });
      return;
    }

    try {
      await useCase.replaceDirectProviderCredential(parsed.data);
      response.status(204).send();
    } catch (error: unknown) {
      if (error instanceof ProviderOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'provider_onboarding.credential_replacement_failed',
        message: 'Provider API Key 更新失败',
      });
    }
  });

  return router;
}
