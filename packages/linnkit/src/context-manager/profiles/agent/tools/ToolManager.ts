import type { AgentProfileRequest } from '../contracts';
import type { ToolSummaryProvider } from '../../../shared/preprocessors/base';
import type { ToolArgs } from '../../../../runtime-kernel';

export interface ToolManagerRegistry extends ToolSummaryProvider {
  getAvailableToolNames(toolNames?: string[]): string[];
  validateToolCall(
    toolName: string,
    args: ToolArgs,
  ): { success: boolean; error?: string };
}

export interface DynamicToolContext {
  request: AgentProfileRequest;
}

export class ToolManager {
  private readonly registry: ToolManagerRegistry;

  constructor(registry: ToolManagerRegistry) {
    this.registry = registry;
  }

  getAvailableToolNames(context: DynamicToolContext): string[] {
    return this.registry.getAvailableToolNames(context.request.availableTools);
  }

  validateToolCall(
    toolName: string,
    args: ToolArgs,
    context: DynamicToolContext
  ): { success: boolean; error?: string } {
    void context;
    return this.registry.validateToolCall(toolName, args);
  }

  getSummaryProvider(): ToolSummaryProvider {
    return this.registry;
  }
}
