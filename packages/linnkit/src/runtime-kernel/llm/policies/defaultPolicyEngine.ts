/**
 * @file src/agent/runtime-kernel/llm/policies/defaultPolicyEngine.ts
 *
 * @description
 * Linnkit 的默认 PolicyEngine 不注册任何失败路由策略。
 *
 * Host 可以复用 `LLMPolicyEngine` 并显式注入自己的路由 policies；
 * Provider wire 适配仍必须通过 canonical inference port 注入。
 */

import { LLMPolicyEngine } from './policyEngine';

export const defaultPolicyEngine = new LLMPolicyEngine([]);
