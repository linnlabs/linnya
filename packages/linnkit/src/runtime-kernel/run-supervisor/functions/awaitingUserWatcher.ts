import type { EventEnvelope, RoutedRuntimeEvent, RunId, RuntimeEvent } from '../../../contracts';
import { Logger } from '../../../shared/logger';
import type { EventBus } from '../../execution/event-bus';
import type { RunAwaitingUserPatch } from '../runHandle';

const logger = new Logger('RunSupervisorAwaitingUserWatcher');

export interface AwaitingUserWatcher {
  watch(runId: RunId, eventBus: EventBus): () => void;
}

export interface AwaitingUserWatcherOptions {
  markAwaitingUser: (runId: RunId, patch: RunAwaitingUserPatch) => Promise<void>;
  onDisposed?: (runId: RunId) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readAwaitingUserReason(event: RuntimeEvent): string | undefined {
  if (event.type !== 'requires_user_interaction') {
    return undefined;
  }

  if (typeof event.prompt === 'string' && event.prompt.trim().length > 0) {
    return event.prompt;
  }

  if (isRecord(event.form)) {
    const prompt = readStringField(event.form, 'prompt');
    if (prompt && prompt.trim().length > 0) {
      return prompt;
    }
  }

  return undefined;
}

export function createAwaitingUserWatcher(
  options: AwaitingUserWatcherOptions
): AwaitingUserWatcher {
  function watch(runId: RunId, eventBus: EventBus): () => void {
    let disposed = false;
    const onEvent = (envelope: EventEnvelope<RoutedRuntimeEvent>): void => {
      const event = envelope.payload;
      if (event.type !== 'requires_user_interaction') {
        return;
      }

      if (event.run_id !== runId) {
        return;
      }

      // EventBus 是同步通知模型；生命周期写入异步执行，避免阻塞事件分发链路。
      void options
        .markAwaitingUser(runId, {
          currentNode: 'wait_user',
          eventId: event.id,
          reason: readAwaitingUserReason(event),
          interaction: {
            interactionId: event.interaction_id,
            toolCallId: event.tool_call_id,
            checkpointRevision: event.checkpoint_revision,
            resumeToken: event.resume_token,
          },
        })
        .catch((error: unknown) => {
          logger.warn('failed to mark awaiting_user from requires_user_interaction', { error });
        });
    };
    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      eventBus.off('event', onEvent);
      eventBus.off('close', onClose);
      options.onDisposed?.(runId);
    };

    const onClose = (): void => {
      dispose();
    };

    eventBus.on('event', onEvent);
    eventBus.on('close', onClose);
    return dispose;
  }

  return { watch };
}
