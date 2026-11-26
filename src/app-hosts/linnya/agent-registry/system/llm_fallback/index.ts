/**
 * @file src/app-hosts/linnya/agent-registry/system/llm_fallback/index.ts
 *
 * @description
 * 系统级 LLM 兜底策略（单一真实来源）：
 * - 这是“系统运行时容错”的 fallback 顺序，不是某个 chat/agent 角色的默认选模；
 * - 因此不走前端 determineModelId，也不写在 chats/* 或 agents/*；
 * - 但同样要求：**所有硬编码模型 id 必须集中到 agent-registry 体系内**，便于统一管理/审计。
 */

/**
 * 降级聊天模型优先级（按偏好从高到低）
 *
 * 约束：
 * - 这里只是“优先级名单”，最终是否可用仍由调用侧检查 enabled/api_key/provider 等。
 */
export const LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER: readonly string[] = [
  // 优先：系统默认的 GPT
  'gpt-5.2',
  // 再其次：常见直连/国内可用模型
  'deepseek-chat',
  'deepseek-reasoner',
  'glm-4.5-air',
];
