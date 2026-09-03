import { PromptKeys } from '@app/schemas';
import type { SSETransportEndEvent } from 'linnkit/contracts';
import type {
  ExecuteTableFillRunDependencies,
  TableFillWorkflowInput,
} from '../definitions/tableFillWorkflow';
import {
  assertCompletedBatchUnitsWereWritten,
  readTableFillWriteCommand,
} from '../functions/tableFillStreamContracts';

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function createAbortError(): Error {
  const error = new Error('Table fill was cancelled');
  error.name = 'AbortError';
  return error;
}

export async function executeTableFillRun(
  input: TableFillWorkflowInput,
  dependencies: ExecuteTableFillRunDependencies,
): Promise<void> {
  const controller = new AbortController();
  dependencies.executionState.begin(controller);

  const sessionId = dependencies.createSessionId();
  const successfulWriteCounts = new Map<string, number>();
  let sessionStarted = false;
  let failure: Error | null = null;
  let streamEnd: SSETransportEndEvent | undefined;

  try {
    const rowPlans = dependencies.buildRowPlans({
      editor: input.editor,
      table: input.table,
      outputRect: input.outputRect,
      activeInputRefs: input.activeInputRefs,
      promptTemplate: input.prompt,
    });
    const batch = dependencies.buildBatchPlan(rowPlans.rows);

    const activeConversationId = dependencies.readActiveConversationId();
    if (activeConversationId) {
      await dependencies.ensureHistoryTail(activeConversationId);
    }

    const prepared = await dependencies.prepareRunCommand({
      signal: controller.signal,
    });
    if (!prepared.ok) {
      if (prepared.reason === 'cancelled') throw createAbortError();
      throw new Error(prepared.message);
    }
    const userInputAdmission = dependencies.createUserInputAdmission({
      run: prepared.run,
      prompt: input.prompt,
    });

    await dependencies.requestSave();
    dependencies.writeSessions.beginSession({
      sessionId,
      editor: input.editor,
      table: rowPlans.table,
      units: batch.writeTargets,
      signal: controller.signal,
    });
    sessionStarted = true;

    await dependencies.invokeAssistant(
      {
        userMessage: { text: input.prompt },
        projectId: prepared.run.projectId,
        options: {
          promptKey: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
          conversationId: prepared.run.conversationId,
          messageId: prepared.run.messageId,
          projectMetadata: prepared.run.projectMetadata,
          activity: { runId: prepared.run.runId, feature: 'table_fill' },
          context: {
            ...(input.imageGenerationModelId
              ? { imageGenerationModelId: input.imageGenerationModelId }
              : {}),
          },
          hostToolCall: {
            tool_name: 'subrun_batch',
            args: {
              worker_prompt_key: batch.args.worker_prompt_key,
              subruns: batch.args.subruns,
            },
          },
        },
      },
      {
        onUserInputCommitted: (event) => {
          userInputAdmission.accept(event);
        },
        onSubRunTrace: async (event) => {
          try {
            const command = readTableFillWriteCommand({
              event,
              sessionId,
              unitIdBySubrunId: batch.unitIdBySubrunId,
            });
            if (!command) return;
            await dependencies.writePort.enqueueWrite(command);
            successfulWriteCounts.set(
              command.unitId,
              (successfulWriteCounts.get(command.unitId) ?? 0) + 1,
            );
          } catch (error) {
            failure = toError(error);
            throw failure;
          }
        },
        onToolOutput: (event) => {
          if (!('status' in event)) return;
          try {
            assertCompletedBatchUnitsWereWritten({
              event,
              expectedUnitIds: batch.unitIds,
              successfulWriteCounts,
            });
          } catch (error) {
            failure = toError(error);
            throw failure;
          }
        },
        onError: (error) => {
          if (error.name !== 'AbortError' && !failure) failure = error;
        },
        onTransportEnd: (event) => {
          streamEnd = event;
        },
      },
      controller.signal,
    );

    if (controller.signal.aborted) throw createAbortError();
    if (failure) throw failure;
    if (!userInputAdmission.committedMessage) {
      throw new Error('Table fill completed without a durable user input commit');
    }
    if (streamEnd?.reason && streamEnd.reason !== 'complete') {
      throw new Error(streamEnd.reason_message || `Table fill ended with ${streamEnd.reason}`);
    }
  } catch (error) {
    failure = toError(error);
  } finally {
    const cancelled = controller.signal.aborted || failure?.name === 'AbortError';
    if (sessionStarted) {
      if (cancelled) {
        try {
          // signal listener 负责尽快阻止新写入；编排层仍显式确认取消终态，避免 session 生命周期依赖隐式监听。
          await dependencies.writePort.cancelSession(sessionId);
        } catch (error) {
          failure ??= toError(error);
        }
      } else {
        try {
          await dependencies.writePort.flush(sessionId);
        } catch (error) {
          failure ??= toError(error);
        }
      }
      try {
        await dependencies.writePort.endSession(sessionId);
      } catch (error) {
        failure ??= toError(error);
      }
    }

    dependencies.executionState.settle({
      controller,
      completedSuccessfully: !failure && !cancelled,
      errorMessage: failure && !cancelled
        ? dependencies.resolveProcessingFailureMessage()
        : null,
    });
  }

  if (failure) throw failure;
}
