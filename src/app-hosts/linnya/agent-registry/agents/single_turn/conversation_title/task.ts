import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { hideThinkTagChunk, SingleTurnAgentTask, stripThinkAndReasoning } from '../shared/task';
import { CONVERSATION_TITLE_SINGLE_TURN_PROMPT } from './prompt';

const MAX_TITLE_LENGTH = 40;

function trimTitleLength(title: string): string {
  return Array.from(title).slice(0, MAX_TITLE_LENGTH).join('').trim();
}

export class ConversationTitleSingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'ConversationTitleSingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(CONVERSATION_TITLE_SINGLE_TURN_PROMPT, {});
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const prompt = request.query.trim();
    if (prompt.includes('<conversation>')) {
      return prompt;
    }

    return `<conversation>\n${prompt}\n</conversation>`;
  }

  processResponse(rawResponse: string): string {
    const lines = stripThinkAndReasoning(rawResponse)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const firstLine = lines[0] ?? '';

    const cleaned = firstLine
      .replace(/^title[:：]\s*/i, '')
      .replace(/^标题[:：]\s*/i, '')
      .replace(/^对话标题[:：]\s*/i, '')
      .replace(/^["“”'‘’`]+|["“”'‘’`]+$/g, '')
      .replace(/[。.!！?？；;：:]+$/g, '')
      .trim();

    return trimTitleLength(cleaned);
  }

  processStreamChunk(chunk: string): string {
    return hideThinkTagChunk(chunk);
  }
}
