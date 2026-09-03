import { AgentSpec as AgentSpecSchema } from 'linnkit/contracts';
import type { AgentSpec } from 'linnkit/contracts';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';

function resolveTools(definition: AgentDefinition): AgentSpec['tools'] {
  const availableTools = definition.config?.availableTools;

  if (!Array.isArray(availableTools)) {
    return [];
  }

  return availableTools.map((toolId) => ({ toolId }));
}

function resolveCapabilities(definition: AgentDefinition): AgentSpec['capabilities'] {
  const capabilities = new Set<string>();
  capabilities.add(definition.defaultMode);

  if (definition.config?.enableTools !== false) {
    capabilities.add('tools');
  }

  const preferredModelCapability = definition.config?.preferredModelCapability;
  if (typeof preferredModelCapability === 'string' && preferredModelCapability.length > 0) {
    capabilities.add(preferredModelCapability);
  }

  return Array.from(capabilities);
}

/**
 * 把 Linnya host 的 AgentDefinition 物化为 linnkit AgentSpec。
 *
 * 中文备注：
 * - 这里严格输出当前 framework `AgentSpec` schema，不把 host 的 modelPolicy/stepPolicy
 *   临时塞成协议字段；
 * - host 特有配置只进入 metadata，供管理/审计读取，不参与 framework 行为判断；
 * - tools 只传 toolId，避免把运行时 zod schema 混进可序列化协议。
 */
export function runnableDefinitionToAgentSpec(definition: AgentDefinition): AgentSpec {
  return AgentSpecSchema.parse({
    id: definition.id,
    version: '0.0.0',
    role: definition.defaultMode,
    description: definition.description,
    capabilities: resolveCapabilities(definition),
    tools: resolveTools(definition),
    contextPolicy: definition.config?.contextPolicy ?? { profileId: 'agent' },
    metadata: {
      promptKey: definition.promptKey,
      ...(definition.config?.modelPolicy ? { modelPolicy: definition.config.modelPolicy } : {}),
      ...(definition.config?.stepPolicy
        ? { stepPolicy: definition.config.stepPolicy }
        : {}),
      ...(definition.config?.skill
        ? { skill: definition.config.skill }
        : {}),
    },
  });
}

export const agentDefinitionToAgentSpec = runnableDefinitionToAgentSpec;

export function resolveRunnableDefinitionForAgentSpec(
  promptKey: string,
): AgentDefinition | undefined {
  return findRegisteredAgentDefinitionByPromptKey(promptKey);
}
