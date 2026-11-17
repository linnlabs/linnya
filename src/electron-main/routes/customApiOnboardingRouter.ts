import { Router, type Request, type Response } from 'express';
import {
  CustomCapabilityModelCommandSchema,
  CustomCapabilityProviderUpdateCommandSchema,
  CustomApiModelRegistrationCommandSchema,
  CustomApiProviderUpdateCommandSchema,
  CustomApiProviderRemovalCommandSchema,
  CustomApiProviderRefreshCommandSchema,
  type CustomApiOnboardingErrorResponse,
  ModelDiscoveryRequestSchema,
  type ModelDiscoveryErrorResponse,
} from '@app/schemas';
import {
  CustomApiOnboardingError,
  type CustomApiOnboardingUseCase,
} from 'src/app-hosts/linnya/application/custom-api-onboarding';
import { ModelDiscoveryService, ModelDiscoveryError } from 'src/domains/model-catalog';

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

  for (const action of ['models', 'test'] as const) {
    router.post(`/capabilities/${action}`, async (request: Request, response: Response) => {
      const parsed = CustomCapabilityModelCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, {
          code: 'custom_api_onboarding.invalid_command',
          message: parsed.error.issues[0]?.message ?? '模型配置内容无效',
        });
        return;
      }
      const controller = new AbortController();
      response.on('close', () => {
        if (!response.writableEnded) controller.abort();
      });
      try {
        const result =
          action === 'test'
            ? await useCase.testCapabilityModel(parsed.data, controller.signal)
            : await useCase.registerCapabilityModel(parsed.data);
        response.status(action === 'test' ? 200 : 201).json(result);
      } catch (error: unknown) {
        if (error instanceof CustomApiOnboardingError) {
          sendError(response, error.statusCode, { code: error.code, message: error.message });
          return;
        }
        sendError(response, 500, {
          code: 'custom_api_onboarding.registration_failed',
          message: '模型操作失败，请检查连接后重试',
        });
      }
    });
  }

  router.put('/capabilities/providers', async (request: Request, response: Response) => {
    const parsed = CustomCapabilityProviderUpdateCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'custom_api_onboarding.invalid_command',
        message: '连接配置无效',
      });
      return;
    }
    try {
      response.json(await useCase.updateCapabilityProvider(parsed.data));
    } catch (error: unknown) {
      if (error instanceof CustomApiOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'custom_api_onboarding.update_failed',
        message: '连接保存失败，请重试',
      });
    }
  });

  router.delete('/providers', async (request: Request, response: Response) => {
    const parsed = CustomApiProviderRemovalCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'custom_api_onboarding.invalid_command',
        message: '自定义模型分组删除参数无效',
      });
      return;
    }
    try {
      response.json(await useCase.removeProvider(parsed.data));
    } catch (error: unknown) {
      if (error instanceof CustomApiOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'custom_api_onboarding.removal_failed',
        message: '自定义模型分组删除失败',
      });
    }
  });

  router.post('/providers/refresh', async (request: Request, response: Response) => {
    const parsed = CustomApiProviderRefreshCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'custom_api_onboarding.invalid_command',
        message: '自定义模型分组刷新参数无效',
      });
      return;
    }
    try {
      response.json(await useCase.refreshProvider(parsed.data));
    } catch (error: unknown) {
      if (error instanceof CustomApiOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'custom_api_onboarding.refresh_failed',
        message: '自定义模型分组刷新失败',
      });
    }
  });

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
        message: '模型列表探测失败',
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

  router.put('/providers', async (request: Request, response: Response) => {
    const parsed = CustomApiProviderUpdateCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, {
        code: 'custom_api_onboarding.invalid_command',
        message: '自定义模型分组配置内容无效',
      });
      return;
    }

    try {
      const result = await useCase.updateProvider(parsed.data);
      response.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof CustomApiOnboardingError) {
        sendError(response, error.statusCode, { code: error.code, message: error.message });
        return;
      }
      sendError(response, 500, {
        code: 'custom_api_onboarding.update_failed',
        message: '自定义模型分组更新失败',
      });
    }
  });

  return router;
}
