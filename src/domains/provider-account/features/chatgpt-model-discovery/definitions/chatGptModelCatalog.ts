import type { ProviderAccountModelDefinition } from '../../../definitions/providerAccount';

export const CHATGPT_MODEL_CATALOG_CONFIG = {
  endpoint_url: 'https://chatgpt.com/backend-api/codex/models',
  request_timeout_ms: 30_000,
  default_effective_context_window_percent: 95,
} as const;

export type ChatGptAccountModel = ProviderAccountModelDefinition;
