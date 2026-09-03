import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { hideThinkTagChunk, SingleTurnAgentTask, stripThinkAndReasoning } from '../shared/task';
import { AUDIO_SUMMARY_SINGLE_TURN_PROMPT } from './prompt';

export class AudioSummarySingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'AudioSummarySingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(AUDIO_SUMMARY_SINGLE_TURN_PROMPT, {});
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const prompt = request.query;
    if (prompt.includes('<audio_transcript>')) {
      return prompt;
    }

    const audioTranscript = request.context_before || prompt;
    return `<audio_transcript>\n${audioTranscript.trim()}\n</audio_transcript>`;
  }

  processResponse(rawResponse: string): string {
    return stripThinkAndReasoning(rawResponse)
      .replace(/^Here is the summary[:：]?\s*/gim, '')
      .replace(/^纪要如下[:：]?\s*/gim, '')
      .replace(/^摘要如下[:：]?\s*/gim, '')
      .replace(/^The summary is[:：]?\s*/gim, '')
      .trim();
  }

  processStreamChunk(chunk: string): string {
    return hideThinkTagChunk(chunk);
  }
}
