import { isValidReasoningEffort, type ReasoningEffort } from 'linnkit/contracts';

const MODEL_REASONING_SELECTION_MARKER = '::reasoning::';

export interface ConversationModelReasoningSelection {
  readonly modelId: string;
  readonly effort: ReasoningEffort;
}

/**
 * 菜单叶子只表达一次“选择某模型的某个思考强度”的交互意图。
 * 真正的模型和强度仍分别写入 model-purpose-bindings，避免 UI 编码进入持久化契约。
 */
export function encodeConversationModelReasoningSelection(
  modelId: string,
  effort: ReasoningEffort
): string {
  return `${modelId}${MODEL_REASONING_SELECTION_MARKER}${effort}`;
}

export function readConversationModelReasoningSelection(
  value: string
): ConversationModelReasoningSelection | null {
  const markerIndex = value.lastIndexOf(MODEL_REASONING_SELECTION_MARKER);
  if (markerIndex <= 0) return null;

  const modelId = value.slice(0, markerIndex);
  const effort = value.slice(markerIndex + MODEL_REASONING_SELECTION_MARKER.length);
  if (!isValidReasoningEffort(effort)) return null;
  return { modelId, effort };
}
