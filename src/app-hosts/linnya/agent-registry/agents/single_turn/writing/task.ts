import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { getCurrentTimeForPromptByDay } from '../../../utils/currentTime';
import { SingleTurnAgentTask } from '../shared/task';
import { WRITING_SINGLE_TURN_PROMPT } from './prompt';

export class WritingSingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'WritingSingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(WRITING_SINGLE_TURN_PROMPT, {
      // 仅精确到“天”，避免秒级变化导致缓存失效。
      current_time: getCurrentTimeForPromptByDay(),
    });
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const {
      query = '',
      context_before: contextBefore = '',
      context_after: contextAfter = '',
    } = request;

    return `<context_before>\n${contextBefore.trim()}\n</context_before>\n<user_request>\n${query.trim()}\n</user_request>\n<context_after>\n${contextAfter.trim()}\n</context_after>`;
  }
}
