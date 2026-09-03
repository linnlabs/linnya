import type { ZodError } from 'zod';

import {
  ModelCatalogItemSchema,
  ModelCatalogSnapshotSchema,
  type ModelCatalogItem,
  type ModelCatalogSnapshot,
} from '../definitions/modelCatalog';

function describeInvalidPayload(error: ZodError): string {
  const firstIssue = error.issues[0];
  const location = firstIssue?.path.length ? firstIssue.path.join('.') : 'root';
  return `模型目录响应不符合合同：${location} ${firstIssue?.message ?? 'invalid payload'}`;
}

export function parseModelCatalogSnapshot(payload: unknown): ModelCatalogSnapshot {
  const parsed = ModelCatalogSnapshotSchema.safeParse(payload);
  if (!parsed.success) throw new Error(describeInvalidPayload(parsed.error));
  return {
    models: parsed.data.models,
    purposeDefaults: parsed.data.task_defaults,
    cloudModelsReady: parsed.data.cloud_models_ready,
  };
}

export function parseModelCatalogItem(payload: unknown): ModelCatalogItem {
  const parsed = ModelCatalogItemSchema.safeParse(payload);
  if (!parsed.success) throw new Error(describeInvalidPayload(parsed.error));
  return parsed.data;
}
