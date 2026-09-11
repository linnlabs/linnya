import { Router, type Request, type Response } from 'express';
import {
  CustomApiModelRegistrationCommandSchema,
  type CustomApiOnboardingErrorResponse,
  ModelDiscoveryRequestSchema,
  type ModelDiscoveryErrorResponse,
} from '@app/schemas';
import {
  CustomApiOnboardingError,
  type CustomApiOnboardingUseCase,
} from 'src/app-hosts/linnya/application/custom-api-onboarding';
import {
  ModelDiscoveryService,
  ModelDiscoveryError,
} from 'src/domains/model-catalog';

function sendError(
  response: Response,
  statusCode: number,
  error: CustomApiOnboardingErrorResponse
): void {
  response.status(statusCode).json(error);
}

function sendDiscoveryError(
  response: Response,
  statusCode: number,
  error: ModelDiscoveryErrorResponse
): void {
  response.status(statusCode).json(error);
}

/** 自定义 API onboarding 的 HTTP adapter；不读取或拼接任何 runtime route 字段。 */
export function createCustomApiOnboardingRouter(
  useCase: CustomApiOnboardingUseCase,
  discoveryService: ModelDiscoveryService = new ModelDiscoveryService()
): Router {
  const router = Router();

  router.post('/discover', async (request: Request, response: Response) => {
    const parsed = ModelDiscoveryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendDiscoveryError(response, 400, {
        code: 'model_discovery.invalid_request',
        message: '模型探测请求参数无效，请检查 API 地址与格式',
      });
      return;
    }

    try {
      const result = await discoveryService.discover(parsed.data);
      response.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof ModelDiscoveryError) {
        sendDiscoveryError(response, error.statusCode, {
          code: error.code,
          message: error.message,
        });
        return;
      }
      sendDiscoveryError(response, 500, {
        code: 'model_discovery.failed',
        message: error instanceof Error ? error.message : '模型列表探测失败',
      });
    }
  });

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
