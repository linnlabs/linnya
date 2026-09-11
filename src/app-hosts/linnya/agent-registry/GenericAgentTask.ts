/**
 * @file src/app-hosts/linnya/agent-registry/GenericAgentTask.ts
 * @description 通用 Agent 任务实现
 *
 * 目标：
 * - 作为一个通用的 IAgentTask 实现，直接消费 AgentDefinition 中的配置
 * - 替代为每个简单 Agent 编写独立 Task 类的模式
 */

import type { AgentDefinition } from './types';
import * as contextManager from '@linnlabs/linnkit/context-manager';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { appendSkillCatalogSection } from 'src/features/skills/agentSkillExposure';
import { linnyaFenceRegistry } from 'src/app-hosts/linnya/context/agent/registerLinnyaFences';

export class GenericAgentTask
  extends contextManager.agentTasks.BaseAgentTask
  implements contextManager.agentTasks.IAgentTask
{
  readonly name: string;
  readonly supportsFrozenSystemPrompt = true;
  private readonly definition: AgentDefinition;

  constructor(definition: AgentDefinition) {
    super({ fenceRegistry: linnyaFenceRegistry });
    this.definition = definition;
    this.name = `GenericAgentTask(${definition.id})`;
  }

  protected getSystemPrompt(request: AgentInvokeRequest): string {
    if (request.frozenSystemPrompt !== undefined) return request.frozenSystemPrompt;
    const builder = this.definition.task?.systemPromptBuilder;
    const basePrompt = builder ? builder(request) : '';
    return appendSkillCatalogSection({
      basePrompt,
      enabled: this.definition.config?.skill?.enabled === true,
    });
  }

  processResponse(rawResponse: string): string {
    const processor = this.definition.task?.responseProcessor;
    if (processor) {
      return processor(rawResponse);
    }
    return super.processResponse(rawResponse);
  }

  processStreamChunk(chunk: string): string {
    const processor = this.definition.task?.streamChunkProcessor;
    if (processor) {
      return processor(chunk);
    }
    return super.processStreamChunk(chunk);
  }

  getPreferredModelCapability(): string {
    return this.definition.config?.preferredModelCapability || 'tool_calling';
  }
}
