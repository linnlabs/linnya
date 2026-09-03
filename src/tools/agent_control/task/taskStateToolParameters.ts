import {
  TASK_STATE_CONSTRAINTS_MAX_ITEMS,
  TASK_STATE_GOAL_MAX_LENGTH,
  TASK_STATE_ITEM_MAX_LENGTH,
  TASK_STATE_MAX_SERIALIZED_CHARS,
  TASK_STATE_NEXT_STEPS_MAX_ITEMS,
  TASK_STATE_PLAN_MAX_ITEMS,
  TASK_STATE_PROGRESS_MAX_LENGTH,
  TASK_STATE_REFERENCES_MAX_ITEMS,
  TASK_STATE_REFERENCE_MAX_LENGTH,
} from '@app/schemas';
import type { ToolParameterProperty, ToolParameterSchema } from '../../types';

const itemProperty: ToolParameterProperty = {
  type: 'string',
  description: 'Non-empty task state item',
  minLength: 1,
  maxLength: TASK_STATE_ITEM_MAX_LENGTH,
};

export const TASK_STATE_PARAMETER_PROPERTIES: Record<string, ToolParameterProperty> = {
  goal: {
    type: 'string',
    description: 'One-sentence task objective',
    minLength: 1,
    maxLength: TASK_STATE_GOAL_MAX_LENGTH,
  },
  constraints: {
    type: 'array',
    items: itemProperty,
    maxItems: TASK_STATE_CONSTRAINTS_MAX_ITEMS,
    description: 'Boundary conditions and constraints',
  },
  current_phase: {
    type: 'string',
    enum: ['plan', 'execute', 'verify', 'recover'],
    description: 'Current task phase',
  },
  current_plan: {
    type: 'array',
    items: itemProperty,
    minItems: 1,
    maxItems: TASK_STATE_PLAN_MAX_ITEMS,
    description: 'Current high-level plan; keep it compact',
  },
  progress: {
    type: 'string',
    description: 'Completed work, current position, and blockers',
    minLength: 1,
    maxLength: TASK_STATE_PROGRESS_MAX_LENGTH,
  },
  next_steps: {
    type: 'array',
    items: itemProperty,
    minItems: 1,
    maxItems: TASK_STATE_NEXT_STEPS_MAX_ITEMS,
    description: 'Immediate concrete next actions',
  },
  references: {
    type: 'array',
    items: {
      type: 'string',
      description: 'Canonical read_file locator, Workspace inode, ToolOutput blob, canonical [@ref], URL, or "none"',
      minLength: 1,
      maxLength: TASK_STATE_REFERENCE_MAX_LENGTH,
    },
    minItems: 1,
    maxItems: TASK_STATE_REFERENCES_MAX_ITEMS,
    description: 'Active references only. Use exactly ["none"] when no reference exists.',
  },
};

export const TASK_STATE_REQUIRED_PARAMETERS = [
  'goal',
  'current_phase',
  'current_plan',
  'progress',
  'next_steps',
  'references',
];

export const TASK_STATE_TOOL_PARAMETER_SCHEMA: ToolParameterSchema = {
  type: 'object',
  properties: TASK_STATE_PARAMETER_PROPERTIES,
  required: TASK_STATE_REQUIRED_PARAMETERS,
  additionalProperties: false,
};

export const TASK_STATE_PARAMETER_BUDGET_DESCRIPTION =
  `The complete TaskState must stay within ${TASK_STATE_MAX_SERIALIZED_CHARS} serialized characters.`;
