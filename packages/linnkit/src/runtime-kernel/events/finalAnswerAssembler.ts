import {
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  generateRuntimeEventId,
  type FinalAnswerCompletionReason,
  type FinalAnswerChunkEvent,
  type FinalAnswerEvent,
  type AssistantReplayPart,
  type ProviderContinuation,
} from '../../contracts';

/**
 * 非流式答案也必须进入统一 live chunk 链，完整 final_answer 只承担 durable 封口。
 */
export function createStandaloneFinalAnswerChunk(
  event: FinalAnswerEvent,
): FinalAnswerChunkEvent {
  return createFinalAnswerChunkEvent(
    generateRuntimeEventId(),
    event.conversation_id,
    event.turn_id,
    event.answer_id,
    0,
    event.content,
    {
      timestamp: event.timestamp,
      ephemeral: true,
      is_last: true,
      ...(event.run_id ? { run_id: event.run_id } : {}),
      ...(event.parent_run_id ? { parent_run_id: event.parent_run_id } : {}),
      ...(event.lane ? { lane: event.lane } : {}),
      ...(event.visibility ? { visibility: event.visibility } : {}),
    },
  );
}

/**
 * 把一个 answer segment 的 chunk 聚合成完整事实。
 *
 * 它只负责确定性的文本聚合，不发布、不持久化，也不生成新的 answer identity。
 */
export class FinalAnswerAssembler {
  private firstChunk: FinalAnswerChunkEvent | undefined;
  private readonly chunks: string[] = [];

  push(chunk: FinalAnswerChunkEvent): void {
    if (this.firstChunk && this.firstChunk.answer_id !== chunk.answer_id) {
      throw new Error('FinalAnswerAssembler cannot mix chunks from different answer segments.');
    }
    this.firstChunk ??= chunk;
    this.chunks.push(chunk.content);
  }

  finalize(options: {
    completionReason: FinalAnswerCompletionReason;
    providerContinuations?: ProviderContinuation[];
    assistantReplayParts?: AssistantReplayPart[];
  }): FinalAnswerEvent | null {
    const firstChunk = this.firstChunk;
    if (!firstChunk) return null;

    const content = this.chunks.join('');
    const chunkCount = this.chunks.length;
    this.reset();
    if (content.length === 0) return null;

    return createFinalAnswerEvent(
      firstChunk.answer_id,
      firstChunk.conversation_id,
      firstChunk.turn_id,
      content,
      {
        timestamp: Date.now(),
        completion_reason: options.completionReason,
        provider_continuations: options.providerContinuations,
        assistant_replay_parts: options.assistantReplayParts,
        meta: {
          chunk_count: chunkCount,
          ...(options.completionReason === 'interrupted' ? { partial: true } : {}),
        },
        ...(firstChunk.run_id ? { run_id: firstChunk.run_id } : {}),
        ...(firstChunk.parent_run_id ? { parent_run_id: firstChunk.parent_run_id } : {}),
        ...(firstChunk.lane ? { lane: firstChunk.lane } : {}),
        ...(firstChunk.visibility ? { visibility: firstChunk.visibility } : {}),
      },
    );
  }

  hasContent(): boolean {
    return this.firstChunk !== undefined;
  }

  reset(): void {
    this.firstChunk = undefined;
    this.chunks.length = 0;
  }
}
