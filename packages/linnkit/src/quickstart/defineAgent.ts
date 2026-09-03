import {
  AgentSpec,
  defineContextPolicy,
} from '../contracts';
import type { DefinedAgent, DefineAgentInput } from './types';
import { serializeToolParameters } from './toolSchema';

function normalizeId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error('[linnkit] defineAgent requires a non-empty id.');
  }
  return normalized;
}

function normalizeSystemPrompt(systemPrompt: string): string {
  const normalized = systemPrompt.trim();
  if (!normalized) {
    throw new Error('[linnkit] defineAgent requires a non-empty systemPrompt.');
  }
  return normalized;
}

/**
 * Quickstart 级 Agent 构造器。
 *
 * 中文备注：
 * - 这里不是新的业务 registry，只是把 AgentSpec 的必填项压成低门槛入口；
 * - 生产 host 仍可直接维护自己的 AgentDefinition -> AgentSpec 映射。
 */
export function defineAgent(input: DefineAgentInput): DefinedAgent {
  const id = normalizeId(input.id);
  const systemPrompt = normalizeSystemPrompt(input.systemPrompt);
  const tools = [...(input.tools ?? [])];
  const toolIds = new Set<string>();

  for (const tool of tools) {
    const toolId = normalizeId(tool.name);
    if (toolIds.has(toolId)) {
      throw new Error(`[linnkit] defineAgent(${id}) received duplicate tool: ${toolId}`);
    }
    toolIds.add(toolId);
  }

  const spec = AgentSpec.parse({
    id,
    version: input.version ?? '0.0.0',
    role: input.role,
    description: input.description,
    capabilities: input.capabilities ?? ['agent'],
    tools: tools.map((tool) => ({
      toolId: tool.name,
      argsSchema: serializeToolParameters(tool.parameters),
    })),
    contextPolicy: defineContextPolicy(input.contextPolicy),
    metadata: input.metadata,
  });

  return {
    spec,
    systemPrompt,
    modelId: input.modelId,
    tools,
  };
}
