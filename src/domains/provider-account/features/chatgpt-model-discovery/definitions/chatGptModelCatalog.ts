import type { ProviderAccountModelDefinition } from '../../../definitions/providerAccount';

export const CHATGPT_MODEL_CATALOG_CONFIG = {
  endpoint_url: 'https://chatgpt.com/backend-api/codex/models',
  // 上游按 Codex 客户端版本筛选可见模型；不能传 Linnya 产品版本，否则可能返回空目录。
  // 这是已验收的目录协议基线，不依赖用户安装 Codex，也不随产品版本递增。
  compatibility_version: '0.165.0',
  request_timeout_ms: 30_000,
  default_effective_context_window_percent: 95,
} as const;

export type ChatGptAccountModel = ProviderAccountModelDefinition;
