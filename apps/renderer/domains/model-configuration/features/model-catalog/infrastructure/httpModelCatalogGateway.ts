import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type {
  ModelCatalogItem,
  UpdateModelCommand,
} from '../definitions/modelCatalog';
import type { ModelCatalogGateway } from '../definitions/modelCatalogGateway';
import {
  parseModelCatalogItem,
  parseModelCatalogSnapshot,
} from '../functions/modelCatalogProjection';

async function readHttpError(response: Response, operation: string): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null) {
    for (const key of ['details', 'detail', 'error'] as const) {
      const value = Reflect.get(payload, key);
      if (typeof value === 'string' && value.trim()) return new Error(value);
    }
  }
  return new Error(`${operation}失败（HTTP ${response.status}）`);
}

function projectUpdateCommand(command: UpdateModelCommand): Record<string, unknown> {
  return {
    ...(command.display_name !== undefined ? { display_name: command.display_name } : {}),
    ...(command.model_name !== undefined ? { model_name: command.model_name } : {}),
    ...(command.capabilities !== undefined ? { capabilities: [...command.capabilities] } : {}),
    ...(command.inference_route !== undefined ? { inference_route: command.inference_route } : {}),
    ...(command.embedding_route !== undefined ? { embedding_route: command.embedding_route } : {}),
    ...(command.reranking_route !== undefined ? { reranking_route: command.reranking_route } : {}),
    ...(command.image_generation_route !== undefined
      ? { image_generation_route: command.image_generation_route }
      : {}),
    ...(command.document_ocr_route !== undefined
      ? { document_ocr_route: command.document_ocr_route }
      : {}),
    ...(command.transcription_route !== undefined
      ? { transcription_route: command.transcription_route }
      : {}),
  };
}

export const httpModelCatalogGateway: ModelCatalogGateway = {
  async load() {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/models`);
    if (!response.ok) throw await readHttpError(response, '加载模型目录');
    return parseModelCatalogSnapshot(await response.json());
  },

  async update(modelId, command): Promise<ModelCatalogItem> {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/models/${encodeURIComponent(modelId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectUpdateCommand(command)),
    });
    if (!response.ok) throw await readHttpError(response, '更新模型');
    return parseModelCatalogItem(await response.json());
  },

  async delete(modelId): Promise<void> {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/models/${encodeURIComponent(modelId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await readHttpError(response, '删除模型');
  },
};
