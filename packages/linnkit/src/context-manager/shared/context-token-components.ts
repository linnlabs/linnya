import type {
  AiMessage,
  ContextTokenComponent,
  ContextTokenComponentKind,
  PersistentMetadata,
} from '../../contracts';
import type { MessageProcessingState } from './providers/base';
import type { MessageImageInputEstimate } from './image-input-estimation';

function isKept(action: MessageProcessingState['action']): boolean {
  return action.startsWith('keep_');
}

function classifyMessage(message: AiMessage): ContextTokenComponentKind {
  const metadata = message.metadata;
  if (metadata?.fenceKind) {
    return 'fence';
  }
  if (message.type === 'history_summary' || metadata?.messageType === 'summary') {
    return 'history-summary';
  }
  if (message.role === 'tool') {
    return 'tool';
  }
  if (message.role === 'assistant' && (message.type === 'tool_calls' || message.type === 'tool_code')) {
    return 'tool';
  }
  if (
    message.type === 'context_injection'
    || message.type === 'context_before'
    || message.type === 'context_after'
  ) {
    return 'context-injection';
  }
  if (message.role === 'system') {
    return 'system';
  }
  if (message.role === 'user') {
    return 'user';
  }
  if (message.role === 'assistant') {
    return 'assistant';
  }
  return 'other';
}

function buildLabel(message: AiMessage, metadata: PersistentMetadata | undefined): string {
  return metadata?.fenceKind
    ?? metadata?.tool_name
    ?? metadata?.messageType
    ?? message.type;
}

function buildTruncationFields(state: MessageProcessingState, messageTokens: number): Pick<
  ContextTokenComponent,
  'truncatedAtExecution' | 'originalTokensEstimate' | 'droppedTokensEstimate'
> {
  const truncation = state.message.metadata?.observationTruncation;
  if (!truncation || truncation.originalChars <= truncation.previewChars || truncation.previewChars === 0) {
    return {};
  }

  // 执行期只保存字符计量；这里用 build 期已校准的 preview token 按字符比例反推原始 token。
  const originalTokensEstimate = Math.max(
    messageTokens,
    Math.ceil((messageTokens * truncation.originalChars) / truncation.previewChars),
  );
  const droppedTokensEstimate = Math.max(0, originalTokensEstimate - messageTokens);

  return {
    truncatedAtExecution: true,
    originalTokensEstimate,
    droppedTokensEstimate,
  };
}

export function buildContextTokenComponents(
  states: ReadonlyArray<MessageProcessingState>,
  estimateImageInputs: (message: AiMessage) => readonly MessageImageInputEstimate[] = () => [],
): ContextTokenComponent[] {
  return states.flatMap((state) => {
    const imageInputs = estimateImageInputs(state.message);
    const imageTokens = imageInputs.reduce(
      (total, attachment) => total + attachment.estimatedTokens,
      0,
    );
    const messageTokens = Math.max(0, state.tokens - imageTokens);
    const messageComponent: ContextTokenComponent = {
      componentId: `${state.originalIndex}:${state.message.id}`,
      kind: classifyMessage(state.message),
      tokens: messageTokens,
      source: 'local-estimate',
      confidence: 'estimate',
      label: buildLabel(state.message, state.message.metadata),
      messageId: state.message.id,
      role: state.message.role,
      action: state.action,
      kept: isKept(state.action),
      ...buildTruncationFields(state, messageTokens),
    };
    const attachmentComponents: ContextTokenComponent[] = imageInputs.map(attachment => ({
      componentId: `${state.originalIndex}:${state.message.id}:image:${attachment.attachmentIndex}`,
      kind: 'image-attachment',
      tokens: attachment.estimatedTokens,
      source: 'local-estimate',
      confidence: 'estimate',
      label: 'image-attachment',
      messageId: state.message.id,
      role: state.message.role,
      action: state.action,
      kept: isKept(state.action),
      attachmentId: attachment.attachmentId,
      resourceId: attachment.resourceId,
      placement: attachment.placement,
      attachmentIndex: attachment.attachmentIndex,
      width: attachment.width,
      height: attachment.height,
      profileId: attachment.profileId,
      estimatorVersion: attachment.estimatorVersion,
    }));
    return [messageComponent, ...attachmentComponents];
  });
}
