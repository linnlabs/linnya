import type { AgentProfileRequest } from '../contracts';
import type { AiMessage } from '../../../../contracts';

export interface IAgentTask {
  readonly name: string;
  buildMessages(
    request: AgentProfileRequest,
    history: AiMessage[]
  ): AiMessage[];
  processResponse(rawResponse: string): string;
  processStreamChunk(chunk: string): string;
  getPreferredModelCapability?(): string;
}

export type AgentTaskResolver = (promptKey: string) => IAgentTask;

export interface IAgentTaskRegistry {
  register(promptKey: string, task: IAgentTask): void;
  getTask(promptKey: string): IAgentTask | null;
  getAllTaskKeys(): string[];
}
