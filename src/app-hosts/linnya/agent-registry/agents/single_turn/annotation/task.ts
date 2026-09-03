import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { ANNOTATION_SINGLE_TURN_PROMPT } from './prompt';
import { SingleTurnAgentTask } from '../shared/task';

export class AnnotationSingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'AnnotationSingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(ANNOTATION_SINGLE_TURN_PROMPT, {});
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const {
      query = '',
      context_before: contextBefore = '',
      context_after: contextAfter = '',
      current_paragraph: currentParagraph = '',
    } = request;

    return `<context_before>\n${contextBefore.trim()}\n</context_before>\n<current_paragraph>\n${currentParagraph.trim()}\n</current_paragraph>\n<context_after>\n${contextAfter.trim()}\n</context_after>\n<user_request>\n${query.trim()}\n</user_request>`;
  }
}
