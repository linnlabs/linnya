import {
  ProviderAccountAuthorizationErrorResponseSchema,
  ProviderAccountAuthorizationResponseSchema,
  ProviderAccountAuthorizationStatusResponseSchema,
} from '@app/schemas/provider-account';
import { Router, type Request, type Response } from 'express';
import {
  ProviderAccountAuthorizationError,
  type ProviderAccountAuthorizationUseCase,
} from 'src/app-hosts/linnya/application/provider-account-authorization';

export function createProviderAccountRouter(
  useCase: ProviderAccountAuthorizationUseCase
): Router {
  const router = Router();

  router.get('/chatgpt', (_request: Request, response: Response) => {
    response.json(
      ProviderAccountAuthorizationStatusResponseSchema.parse(useCase.getChatGptStatus())
    );
  });

  router.post('/chatgpt/authorize', async (_request: Request, response: Response) => {
    try {
      response.json(
        ProviderAccountAuthorizationResponseSchema.parse(await useCase.authorizeChatGpt())
      );
    } catch (error: unknown) {
      const failure =
        error instanceof ProviderAccountAuthorizationError
          ? error
          : new ProviderAccountAuthorizationError(
              'provider_account.token_exchange_failed',
              'ChatGPT 授权失败',
              500
            );
      response.status(failure.statusCode).json(
        ProviderAccountAuthorizationErrorResponseSchema.parse({
          code: failure.code,
          message: failure.message,
        })
      );
    }
  });

  router.delete('/chatgpt', async (_request: Request, response: Response) => {
    response.json(
      ProviderAccountAuthorizationStatusResponseSchema.parse(await useCase.disconnectChatGpt())
    );
  });

  return router;
}
