import { Router, type Request, type Response } from 'express';
import {
  OllamaModelRegistrationCommandSchema,
  type OllamaOnboardingErrorResponse,
} from '@app/schemas/ollama-onboarding';
import {
  OllamaOnboardingError,
  type OllamaOnboardingUseCase,
} from 'src/app-hosts/linnya/application/ollama-onboarding';

function sendError(
  response: Response,
  statusCode: number,
  error: OllamaOnboardingErrorResponse
): void {
  response.status(statusCode).json(error);
}

export function createOllamaOnboardingRouter(useCase: OllamaOnboardingUseCase): Router {
  const router = Router();
  router.post('/models', async (request: Request, response: Response) => {
    const parsed = OllamaModelRegistrationCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'ollama_onboarding.invalid_command',
        message: 'Ollama 模型配置内容无效',
      });
      return;
    }
    try {
      response.status(201).json(await useCase.registerModel(parsed.data));
    } catch (error: unknown) {
      if (error instanceof OllamaOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'ollama_onboarding.registration_failed',
        message: 'Ollama 模型注册失败',
      });
    }
  });
  return router;
}
