import type { AgentAutocompleteIntentKey, AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { buildPrompt } from '../../../prompt.builder';
import { AUTOCOMPLETE_SINGLE_TURN_PROMPT } from './prompt';
import { hideThinkTagChunk, SingleTurnAgentTask, stripThinkAndReasoning } from '../shared/task';

const intentDescriptions: Record<AgentAutocompleteIntentKey, string> = {
  continue_paragraph: '用户正在正常续写段落',
  list_next_item: '用户正在列点，需要继续下一个列表项',
  bridge_to_suffix_delimiter: '用户需要收束当前内容并平滑过渡到后缀分隔符',
  rewrite_after_large_delete: '用户刚删除大段文本后重写，需要更保守的建议',
  structure_editing: '用户正在进行结构性编辑（不应触发）',
};

export class AutocompleteSingleTurnAgentTask extends SingleTurnAgentTask {
  readonly name = 'AutocompleteSingleTurnAgentTask';

  protected buildSystemPrompt(): string {
    return buildPrompt(AUTOCOMPLETE_SINGLE_TURN_PROMPT, {});
  }

  protected buildUserMessage(request: AgentInvokeRequest): string {
    const {
      context_before: contextBefore = '',
      context_after: contextAfter = '',
      completionLengthHint,
      recentRejections,
      intentKey,
      intentConfidence,
      intentConstraints,
      behaviorSummary,
    } = request;

    const lengthHint = completionLengthHint || 'Output 2-3 sentences.';
    let message = `<completion_length>\n${lengthHint}\n</completion_length>\n\n<prefix>\n${contextBefore}\n</prefix>\n\n<suffix>\n${contextAfter}\n</suffix>`;

    if (intentKey && typeof intentConfidence === 'number' && Number.isFinite(intentConfidence)) {
      message += `\n\n<user_intent>\nIntent: ${intentKey}\nDescription: ${intentDescriptions[intentKey]}\nConfidence: ${(intentConfidence * 100).toFixed(0)}%\n</user_intent>`;

      if (intentConstraints && intentConstraints.length > 0) {
        const constraintsList = intentConstraints.map((constraint, index) => `${index + 1}. ${constraint}`).join('\n');
        message += `\n\n<intent_constraints>\nThe following constraints MUST be followed based on user intent:\n${constraintsList}\n</intent_constraints>`;
      }
    }

    if (behaviorSummary) {
      const summary: string[] = [];
      summary.push(`Total editing events: ${behaviorSummary.totalEvents}`);
      summary.push(`Inserted: ${behaviorSummary.totalInsertedChars} chars`);
      summary.push(`Deleted: ${behaviorSummary.totalDeletedChars} chars`);

      if (behaviorSummary.recentDeletedChars !== undefined) {
        summary.push(`Recent deletions: ${behaviorSummary.recentDeletedChars} chars`);
      }
      if (behaviorSummary.hasLargeRecentDelete) {
        summary.push('Large deletion detected');
      }
      if (behaviorSummary.typingSpeedCps !== undefined) {
        summary.push(`Typing speed: ${behaviorSummary.typingSpeedCps.toFixed(1)} chars/sec`);
      }

      message += `\n\n<behavior_context>\n${summary.join('\n')}\n</behavior_context>`;
    }

    if (recentRejections && recentRejections.length > 0) {
      const rejectionItems = recentRejections
        .slice(0, 2)
        .map((rejection, index) => {
          let item = `${index + 1}. "${rejection.suggestionText}"`;
          if (rejection.userContinuedWith) {
            item += ` (user then typed: "${rejection.userContinuedWith.slice(0, 50)}")`;
          }
          return item;
        })
        .join('\n');

      message += `\n\n<rejected_suggestions>\nThe following suggestions were rejected. Do NOT repeat them or suggest anything similar:\n${rejectionItems}\n</rejected_suggestions>`;
    }

    return message;
  }

  processResponse(rawResponse: string): string {
    return stripThinkAndReasoning(rawResponse);
  }

  processStreamChunk(chunk: string): string {
    return hideThinkTagChunk(chunk);
  }
}
