/**
 * @file autocomplete-options.extender.ts
 * @description Autocomplete（自动补全）请求字段透传：从 ConversationNextRequest.options 提取 Autocomplete 扩展字段
 *
 * 为什么需要：
 * - AutocompleteTask 需要 completionLengthHint 和 recentRejections 字段
 * - 这些字段从前端传入，需要透传到 AgentInvokeRequest 中
 */

import type {
  AgentAutocompleteBehaviorSummary,
  AgentAutocompleteIntentKey,
  AgentInvokeRequest,
} from 'src/app-hosts/linnya/context/agent/contracts';
import { PromptKeys } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type {
  HistoryBuilderOptionsExtender,
  HistoryBuilderOptionsExtenderContext,
} from '../history-builder-options-extender.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function getOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getFirstString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = getOptionalString(obj, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function getFirstNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = getOptionalNumber(obj, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

interface RejectedSuggestion {
  suggestionText: string;
  userContinuedWith?: string;
}

function isRejectedSuggestion(value: unknown): value is RejectedSuggestion {
  if (!isRecord(value)) return false;
  return typeof value.suggestionText === 'string';
}

function getOptionalRejections(obj: Record<string, unknown>, key: string): RejectedSuggestion[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;

  const validRejections = v.filter(isRejectedSuggestion);
  return validRejections.length > 0 ? validRejections : undefined;
}

function getFirstRejections(obj: Record<string, unknown>, keys: readonly string[]): RejectedSuggestion[] | undefined {
  for (const key of keys) {
    const value = getOptionalRejections(obj, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isAutocompleteIntentKey(value: unknown): value is AgentAutocompleteIntentKey {
  return (
    value === 'continue_paragraph' ||
    value === 'list_next_item' ||
    value === 'bridge_to_suffix_delimiter' ||
    value === 'rewrite_after_large_delete' ||
    value === 'structure_editing'
  );
}

function getIntentKey(obj: Record<string, unknown>): AgentAutocompleteIntentKey | undefined {
  const value = obj.intentKey ?? obj.intent_key;
  return isAutocompleteIntentKey(value) ? value : undefined;
}

function getStringArray(obj: Record<string, unknown>, keys: readonly string[]): string[] | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    const items = value.filter((item): item is string => typeof item === 'string');
    if (items.length > 0) return items;
  }
  return undefined;
}

function isBehaviorSummary(value: unknown): value is AgentAutocompleteBehaviorSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.totalEvents === 'number' &&
    typeof value.totalInsertedChars === 'number' &&
    typeof value.totalDeletedChars === 'number'
  );
}

function getBehaviorSummary(obj: Record<string, unknown>): AgentAutocompleteBehaviorSummary | undefined {
  const value = obj.behaviorSummary ?? obj.behavior_summary;
  return isBehaviorSummary(value) ? value : undefined;
}

export class AutocompleteOptionsExtender implements HistoryBuilderOptionsExtender {
  readonly name = 'AutocompleteOptionsExtender';

  isApplicable(ctx: HistoryBuilderOptionsExtenderContext): boolean {
    return ctx.resolvedPromptKey === PromptKeys.AUTOCOMPLETE;
  }

  extend(ctx: HistoryBuilderOptionsExtenderContext): Partial<AgentInvokeRequest> {
    const options = ctx.options;
    if (!options || !isRecord(options)) {
      return {};
    }

    return {
      completionLengthHint: getFirstString(options, ['completionLengthHint', 'completion_length_hint']),
      recentRejections: getFirstRejections(options, ['recentRejections', 'recent_rejections']),
      intentKey: getIntentKey(options),
      intentConfidence: getFirstNumber(options, ['intentConfidence', 'intent_confidence']),
      intentConstraints: getStringArray(options, ['intentConstraints', 'intent_constraints']),
      behaviorSummary: getBehaviorSummary(options),
    };
  }
}
