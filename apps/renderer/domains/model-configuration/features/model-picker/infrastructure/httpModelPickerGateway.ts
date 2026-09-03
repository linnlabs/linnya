import { ModelPickerSnapshotSchema } from '@app/schemas/model-picker';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';

async function readHttpError(response: Response, operation: string): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null) {
    const message = Reflect.get(payload, 'message');
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(`${operation}失败（HTTP ${response.status}）`);
}

async function updateVisibility(path: string, visible: boolean) {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible }),
  });
  if (!response.ok) throw await readHttpError(response, '更新模型可见性');
  return ModelPickerSnapshotSchema.parse(await response.json());
}

export const httpModelPickerGateway: ModelPickerGateway = {
  async load() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/model-picker`);
    if (!response.ok) throw await readHttpError(response, '加载模型选择器');
    return ModelPickerSnapshotSchema.parse(await response.json());
  },

  setProviderVisibility(configuredProviderId, visible) {
    return updateVisibility(
      `/api/v1/model-picker/providers/${encodeURIComponent(configuredProviderId)}/visibility`,
      visible
    );
  },

  setModelVisibility(modelConfigId, visible) {
    return updateVisibility(
      `/api/v1/model-picker/models/${encodeURIComponent(modelConfigId)}/visibility`,
      visible
    );
  },

  async activateProviderModel(configuredProviderId, providerModelId) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(
      `${baseUrl}/api/v1/model-picker/providers/${encodeURIComponent(configuredProviderId)}/models/${encodeURIComponent(providerModelId)}/activation`,
      { method: 'POST' }
    );
    if (!response.ok) throw await readHttpError(response, '启用 Provider 模型');
    return ModelPickerSnapshotSchema.parse(await response.json());
  },
};
