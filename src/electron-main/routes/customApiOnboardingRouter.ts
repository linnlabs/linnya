import { Router, type Request, type Response } from 'express';
import {
  CustomApiModelRegistrationCommandSchema,
  type CustomApiOnboardingErrorResponse,
} from '@app/schemas/custom-api-onboarding';
import {
  CustomApiOnboardingError,
  type CustomApiOnboardingUseCase,
} from 'src/app-hosts/linnya/application/custom-api-onboarding';

function sendError(
  response: Response,
  statusCode: number,
  error: CustomApiOnboardingErrorResponse
): void {
  response.status(statusCode).json(error);
}

/** 自定义 API onboarding 的 HTTP adapter；不读取或拼接任何 runtime route 字段。 */
export function createCustomApiOnboardingRouter(useCase: CustomApiOnboardingUseCase): Router {
  const router = Router();

  router.post('/models', async (request: Request, response: Response) => {
    const parsed = CustomApiModelRegistrationCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'custom_api_onboarding.invalid_command',
        message: '自定义 API 模型配置内容无效',
      });
      return;
    }

    try {
      const result = await useCase.registerModel(parsed.data);
      response.status(201).json(result);
    } catch (error: unknown) {
      if (error instanceof CustomApiOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'custom_api_onboarding.registration_failed',
        message: '自定义 API 模型注册失败',
      });
    }
  });

  return router;
}
