import {
  HistoricalTaskStateReadResultSchema,
  HistoricalTaskStateWriteResultSchema,
  TaskStateReadArgsSchema,
  TaskStateReadResultSchema,
  TaskStateWriteArgsSchema,
  TaskStateWriteResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  TaskStatePresentationData,
  TaskStatePresentationOperation,
} from '../definitions/taskStatePresentation';
import { buildTaskStateStepRows } from './buildTaskStateStepRows';

export function projectTaskStatePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<TaskStatePresentationData> {
  const source = readTaskStatePresentationSource(input);
  const operation = source.operation;
  const title = createConversationToolTitleDescriptor(
    operation === 'read' ? 'conversation.tool.taskState.read' : 'conversation.tool.taskState.update'
  );
  if (input.status !== 'success') {
    return { data: { kind: 'lifecycle', operation }, title };
  }
  if (operation === 'read') {
    TaskStateReadArgsSchema.parse(input.args);
  } else {
    TaskStateWriteArgsSchema.parse(input.args);
  }

  if (operation === 'read') {
    const result = source.contract === 'canonical'
      ? TaskStateReadResultSchema.parse(input.result)
      : HistoricalTaskStateReadResultSchema.parse(input.result);
    if (!result.data.exists) {
      return {
        data: { kind: 'missing', operation },
        title: createConversationToolTitleDescriptor('conversation.tool.taskState.readMissing'),
      };
    }
    return {
      data: {
        kind: 'snapshot',
        operation,
        version: result.data.version,
        taskstate: result.data.taskstate,
        nextStepRows: buildTaskStateStepRows(result.data.taskstate.next_steps).slice(0, 3),
      },
      title: createConversationToolTitleDescriptor('conversation.tool.taskState.readVersion', {
        version: result.data.version,
      }),
    };
  }

  const result = source.contract === 'canonical'
    ? TaskStateWriteResultSchema.parse(input.result)
    : HistoricalTaskStateWriteResultSchema.parse(input.result);
  return {
    data: {
      kind: 'snapshot',
      operation,
      version: result.data.version,
      taskstate: result.data.taskstate,
      nextStepRows: buildTaskStateStepRows(result.data.taskstate.next_steps).slice(0, 3),
    },
    title: createConversationToolTitleDescriptor('conversation.tool.taskState.updateVersionPhase', {
      version: result.data.version,
      phase: result.data.taskstate.current_phase,
    }),
  };
}

interface TaskStatePresentationSource {
  readonly operation: TaskStatePresentationOperation;
  readonly contract: 'canonical' | 'historical';
}

function readTaskStatePresentationSource(
  input: ToolPresentationProjectorInput,
): TaskStatePresentationSource {
  if (input.sourceToolName !== input.uiKey) {
    throw new Error(
      `TaskState presentation does not accept aliases: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }
  if (input.uiKey === 'task_read') return { operation: 'read', contract: 'canonical' };
  if (input.uiKey === 'task_write') return { operation: 'write', contract: 'canonical' };
  if (input.uiKey === 'taskstate_read') return { operation: 'read', contract: 'historical' };
  if (input.uiKey === 'taskstate_write') return { operation: 'write', contract: 'historical' };
  throw new Error(`Unsupported TaskState presentation key: ${input.uiKey}`);
}
