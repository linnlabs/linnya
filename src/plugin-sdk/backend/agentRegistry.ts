/**
 * @file agentRegistry.ts
 * @description 插件可依赖的 Agent 注册契约门面。
 *
 * 中文说明：
 * - 插件包不直接 import app-hosts 内部目录；
 * - host 在这里明确暴露 prompt 类型、agent 定义、prompt 构建与时间变量能力；
 * - 该文件只承接 agent 注册相关契约，避免形成大而全的全局对象。
 */

export {
  PromptType,
} from 'src/app-hosts/linnya/agent-registry/prompt.types';
import {
  fillTemplate,
} from 'src/app-hosts/linnya/agent-registry/prompt.builder';
import type {
  PromptTemplate,
  TemplateVariables,
} from '@linnya/plugin-host-contract/backend/agentRegistry';
export type {
  AgentConfiguration,
  AgentDefinition,
  AgentModelPolicy,
  AgentSkillPolicy,
  AgentStepPolicy,
  AgentTaskConfiguration,
  PromptKey,
  PromptTemplate,
  PromptTemplateType,
  SubagentTypeContribution,
  TemplateVariables,
} from '@linnya/plugin-host-contract/backend/agentRegistry';
export {
  getCurrentTimeForPromptByDay,
} from 'src/app-hosts/linnya/agent-registry/utils/currentTime';

export function buildPrompt(template: PromptTemplate, variables: TemplateVariables = {}): string {
  return fillTemplate(template.content, variables);
}
