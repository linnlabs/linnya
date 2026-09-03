import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { hideThinkTagChunk, SingleTurnAgentTask, stripThinkAndReasoning } from '../shared/task';
import { TRANSLATION_SINGLE_TURN_PROMPT } from './prompt';

export class TranslationSingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'TranslationSingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(TRANSLATION_SINGLE_TURN_PROMPT, {});
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const prompt = request.query;
    if (prompt.includes('<text_to_translate>') && prompt.includes('<target_language>')) {
      return prompt;
    }

    const textToTranslate = request.context_before || prompt;
    const targetLanguage = request.currentBlockContent || 'English';
    return `<text_to_translate>\n${textToTranslate.trim()}\n</text_to_translate>\n\n<target_language>\n${targetLanguage.trim()}\n</target_language>`;
  }

  processResponse(rawResponse: string): string {
    return stripThinkAndReasoning(rawResponse)
      .replace(/^\s*translation[:：]\s*/gim, '')
      .replace(/^\s*翻译[:：]\s*/gim, '')
      .replace(/^Here is the translation[:：]?\s*/gim, '')
      .replace(/^翻译如下[:：]?\s*/gim, '')
      .replace(/^The translation is[:：]?\s*/gim, '')
      .trim();
  }

  processStreamChunk(chunk: string): string {
    return hideThinkTagChunk(chunk);
  }
}
