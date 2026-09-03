import type { AiMessage } from '../../../contracts';
import type { FenceDescriptor, FenceRegistry } from '../fences';
import { BasePreprocessor, type PreprocessorContext, type PreprocessorResult } from './base';
import { PREPROCESSOR_PRIORITY } from './priority';

export interface CurrentTurnMessageAssemblerOptions {
  fenceRegistry: FenceRegistry;
}

type UserFencePlacement = 'before-current-user' | 'after-current-user';

interface CollectedFence {
  index: number;
  message: AiMessage;
  descriptor: FenceDescriptor;
}

interface AssemblyResult {
  messages: AiMessage[];
  modifiedCount: number;
}

/**
 * 组装当前轮 prompt block。
 *
 * 中文说明：
 * - formatter 只负责把单条消息转成 wire 形态，不负责猜测相邻消息是否应该合并；
 * - 当前轮 system-side fence 在这里合入 system_prompt；
 * - 当前轮 user-side fence 在这里合入同一条 user_input，未注入的 fence 不产生空标签。
 */
export class CurrentTurnMessageAssembler extends BasePreprocessor {
  readonly name = 'CurrentTurnMessageAssembler';
  readonly description = 'Assembles current-turn fences into system_prompt and user_input messages';
  readonly priority = PREPROCESSOR_PRIORITY.currentTurnAssembly;

  private readonly fenceRegistry: FenceRegistry;

  constructor(options: CurrentTurnMessageAssemblerOptions) {
    super();
    this.fenceRegistry = options.fenceRegistry;
  }

  async process(messages: AiMessage[], _context: PreprocessorContext): Promise<PreprocessorResult> {
    const systemResult = assembleSystemPrompt({ messages, fenceRegistry: this.fenceRegistry });
    const userResult = assembleCurrentUserInput({
      messages: systemResult.messages,
      fenceRegistry: this.fenceRegistry,
    });
    const modifiedCount = systemResult.modifiedCount + userResult.modifiedCount;

    return this.createResult(
      messages,
      userResult.messages,
      modifiedCount > 0 ? ['current_turn_message_assembly'] : [],
      modifiedCount,
    );
  }
}

function assembleSystemPrompt(params: {
  messages: readonly AiMessage[];
  fenceRegistry: FenceRegistry;
}): AssemblyResult {
  const systemIndex = params.messages.findIndex(message =>
    message.role === 'system' && message.type === 'system_prompt'
  );
  if (systemIndex === -1) {
    return { messages: [...params.messages], modifiedCount: 0 };
  }

  const fences = collectAdjacentFences({
    messages: params.messages,
    startIndex: systemIndex + 1,
    direction: 1,
    fenceRegistry: params.fenceRegistry,
    matches: descriptor => descriptor.llmRole === 'system' && descriptor.placement === 'after-system',
  });
  if (fences.length === 0) {
    return { messages: [...params.messages], modifiedCount: 0 };
  }

  const indexesToRemove = new Set(fences.map(fence => fence.index));
  const systemPrompt = params.messages[systemIndex];
  const assembledSystemPrompt: AiMessage = {
    ...systemPrompt,
    content: [
      systemPrompt.content,
      ...fences.map(formatFence),
    ].join('\n\n'),
    metadata: {
      ...systemPrompt.metadata,
      assembledFenceKinds: fences
        .map(fence => fence.message.metadata?.fenceKind)
        .filter((kind): kind is string => typeof kind === 'string'),
    },
  };

  return {
    messages: params.messages.map((message, index) =>
      index === systemIndex ? assembledSystemPrompt : message
    ).filter((_, index) => !indexesToRemove.has(index)),
    modifiedCount: fences.length + 1,
  };
}

function assembleCurrentUserInput(params: {
  messages: readonly AiMessage[];
  fenceRegistry: FenceRegistry;
}): AssemblyResult {
  const currentUserIndex = findLastUserInputIndex(params.messages);
  if (currentUserIndex === -1) {
    return { messages: [...params.messages], modifiedCount: 0 };
  }

  const beforeFences = collectAdjacentFences({
    messages: params.messages,
    startIndex: currentUserIndex - 1,
    direction: -1,
    fenceRegistry: params.fenceRegistry,
    matches: descriptor => isUserCurrentTurnPlacement(descriptor, 'before-current-user'),
  }).reverse();
  const afterFences = collectAdjacentFences({
    messages: params.messages,
    startIndex: currentUserIndex + 1,
    direction: 1,
    fenceRegistry: params.fenceRegistry,
    matches: descriptor => isUserCurrentTurnPlacement(descriptor, 'after-current-user'),
  });

  if (beforeFences.length === 0 && afterFences.length === 0) {
    return { messages: [...params.messages], modifiedCount: 0 };
  }

  const indexesToRemove = new Set([
    ...beforeFences.map(fence => fence.index),
    ...afterFences.map(fence => fence.index),
  ]);
  const currentUser = params.messages[currentUserIndex];
  const assembledUser: AiMessage = {
    ...currentUser,
    content: [
      ...beforeFences.map(formatFence),
      wrapUserRequest(currentUser.content),
      ...afterFences.map(formatFence),
    ].join('\n\n'),
    metadata: {
      ...currentUser.metadata,
      assembledFenceKinds: [
        ...beforeFences.map(fence => fence.message.metadata?.fenceKind),
        ...afterFences.map(fence => fence.message.metadata?.fenceKind),
      ].filter((kind): kind is string => typeof kind === 'string'),
    },
  };

  return {
    messages: params.messages.map((message, index) =>
      index === currentUserIndex ? assembledUser : message
    ).filter((_, index) => !indexesToRemove.has(index)),
    modifiedCount: indexesToRemove.size + 1,
  };
}

function findLastUserInputIndex(messages: readonly AiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.type === 'user_input') {
      return index;
    }
  }
  return -1;
}

function collectAdjacentFences(params: {
  messages: readonly AiMessage[];
  startIndex: number;
  direction: -1 | 1;
  fenceRegistry: FenceRegistry;
  matches: (descriptor: FenceDescriptor) => boolean;
}): CollectedFence[] {
  const result: CollectedFence[] = [];

  for (
    let index = params.startIndex;
    index >= 0 && index < params.messages.length;
    index += params.direction
  ) {
    const message = params.messages[index];
    if (message.type !== 'context_injection') {
      break;
    }

    const fenceKind = message.metadata?.fenceKind;
    if (!fenceKind) {
      break;
    }

    const descriptor = params.fenceRegistry.get(fenceKind);
    if (!descriptor || !params.matches(descriptor)) {
      break;
    }

    result.push({ index, message, descriptor });
  }

  return result;
}

function isUserCurrentTurnPlacement(
  descriptor: FenceDescriptor,
  placement: UserFencePlacement,
): boolean {
  return descriptor.llmRole === 'user' && descriptor.placement === placement;
}

function formatFence(fence: CollectedFence): string {
  return fence.descriptor.formatter(fence.message.content, fence.message.metadata?.fenceAttrs ?? {});
}

function wrapUserRequest(content: string): string {
  const trimmed = content.trim();
  if (/<user_request(?:\s[^>]*)?>[\s\S]*<\/user_request>/.test(trimmed)) {
    return trimmed;
  }
  return `<user_request>\n${trimmed}\n</user_request>`;
}
