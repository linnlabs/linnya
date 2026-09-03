/**
 * @file src/app-hosts/linnya/agent-registry/system/llm_fallback/index.ts
 *
 * @description
 * 系统级 LLM 兜底策略（单一真实来源）：
 * - 这是“系统运行时容错”的 fallback 顺序，不是某个 chat/agent 角色的默认选模；
 * - 因此不走前端 determineModelId，也不写在 chats/* 或 agents/*；
 * - 但同样要求：**所有硬编码模型 id 必须集中到 agent-registry 体系内**，便于统一管理/审计。
 */

import { CLOUD_DEEPSEEK_REASONER_MODEL_ID } from 'src/domains/model-catalog';

/**
 * 降级聊天模型优先级（按偏好从高到低）
 *
 * 约束：
 * - 这里只是“优先级名单”，最终是否可用仍由调用侧检查 enabled/api_key/provider 等。
 */
export const LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER: readonly string[] = [
  // 优先：非 openrouter 的 Gemini（如果配置了 key）
  'gemini-3-pro-preview',
  // 其次：系统默认的 GPT
  'gpt-5.2',
  // 再其次：常见直连/国内可用模型
  'deepseek-chat',
  'deepseek-reasoner',
  'glm-4.5-air',
];

/**
 * 云端模型限额降级目标（同一个 run 内续跑专用）
 *
 * 中文说明：
 * - 当某个云端模型在 run 中途触发 quota/限额错误时，LlmCaller 会静默切到此模型继续；
 * - 选择 deepseek-reasoner 的理由：限额相对宽松、OpenAI-compat 协议通用、推理能力足够续跑；
 * - ID 前缀 `cloud-` 对应 cloud-models.ts 的命名规则（`cloud-${item.id}`）。
 */
export const CLOUD_QUOTA_FALLBACK_MODEL_ID = CLOUD_DEEPSEEK_REASONER_MODEL_ID;
