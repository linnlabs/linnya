import {
  SetModelPickerModelVisibilityCommandSchema,
  SetModelPickerProviderVisibilityCommandSchema,
} from '@app/schemas/model-picker';
import { Router, type Request, type Response } from 'express';

import {
  ModelPickerError,
  type ModelPickerUseCase,
} from 'src/app-hosts/linnya/application/model-picker';

function readPathId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function handleModelPickerError(error: unknown, response: Response): void {
  if (error instanceof ModelPickerError) {
    response.status(error.statusCode).json({ code: error.code, message: error.message });
    return;
  }
  console.error('[ModelPickerRouter] 模型选择器操作失败', error);
  response.status(500).json({
    code: 'model_picker.operation_failed',
    message: '模型选择器操作失败',
  });
}

/** 模型快捷选择器与 Settings 模型页共用的 HTTP adapter。 */
export function createModelPickerRouter(useCase: ModelPickerUseCase): Router {
  const router = Router();

  router.get('/', (_request: Request, response: Response) => {
    try {
      response.json(useCase.read());
    } catch (error: unknown) {
      handleModelPickerError(error, response);
    }
  });

  router.put('/providers/:configuredProviderId/visibility', async (request, response) => {
    const configuredProviderId = readPathId(request.params.configuredProviderId);
    const command = SetModelPickerProviderVisibilityCommandSchema.safeParse(request.body);
    if (!configuredProviderId || !command.success) {
      response.status(400).json({ code: 'model_picker.invalid_command' });
      return;
    }
    try {
      response.json(
        await useCase.setProviderVisibility(configuredProviderId, command.data.visible)
      );
    } catch (error: unknown) {
      handleModelPickerError(error, response);
    }
  });

  router.put('/models/:modelConfigId/visibility', async (request, response) => {
    const modelConfigId = readPathId(request.params.modelConfigId);
    const command = SetModelPickerModelVisibilityCommandSchema.safeParse(request.body);
    if (!modelConfigId || !command.success) {
      response.status(400).json({ code: 'model_picker.invalid_command' });
      return;
    }
    try {
      response.json(await useCase.setModelVisibility(modelConfigId, command.data.visible));
    } catch (error: unknown) {
      handleModelPickerError(error, response);
    }
  });

  router.post(
    '/providers/:configuredProviderId/models/:providerModelId/activation',
    async (request, response) => {
      const configuredProviderId = readPathId(request.params.configuredProviderId);
      const providerModelId = readPathId(request.params.providerModelId);
      if (!configuredProviderId || !providerModelId) {
        response.status(400).json({ code: 'model_picker.invalid_command' });
        return;
      }
      try {
        response
          .status(201)
          .json(await useCase.activateProviderModel(configuredProviderId, providerModelId));
      } catch (error: unknown) {
        handleModelPickerError(error, response);
      }
    }
  );

  return router;
}
