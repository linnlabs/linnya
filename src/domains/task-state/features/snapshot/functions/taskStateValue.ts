import {
  FileLocatorSchema,
  TaskStateSchema,
  type TaskState,
  type TaskStatePhase,
} from '@app/schemas';

export type TaskPhase = TaskStatePhase;
export type { TaskState } from '@app/schemas';

export function parseTaskState(raw: Record<string, unknown>): TaskState {
  const references = parseTaskStateReferences(raw['references']);
  return TaskStateSchema.parse({
    goal: raw['goal'],
    constraints: raw['constraints'] ?? [],
    current_phase: raw['current_phase'],
    current_plan: raw['current_plan'],
    progress: raw['progress'],
    next_steps: raw['next_steps'],
    references,
  });
}

export function formatTaskStateObservation(state: TaskState, version: number): string {
  return (
    `TaskState 已更新 (v${version}): `
    + `phase=${state.current_phase}, `
    + `${state.current_plan.length} plan items, `
    + `${state.next_steps.length} next steps`
  );
}

function parseTaskStateReferences(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('taskstate: references is required and must be an array');
  }
  const references = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`taskstate: references[${index}] must be a string`);
    }
    const normalized = item.trim();
    if (!normalized) {
      throw new Error(`taskstate: references[${index}] must not be empty`);
    }
    return normalized;
  });

  if (references.length === 1 && references[0] === 'none') {
    return references;
  }
  if (references.some(reference => reference.toLowerCase() === 'none')) {
    throw new Error('taskstate: references must be exactly ["none"] or a list of refs');
  }
  references.forEach((reference, index) => {
    if (!isActiveTaskStateReference(reference)) {
      throw new Error(`taskstate: references[${index}] is not an active path or reference: "${reference}"`);
    }
  });
  return references;
}

function isActiveTaskStateReference(value: string): boolean {
  if (FileLocatorSchema.safeParse(value).success) return true;
  if (/^[0-9a-f]{16}$/i.test(value)) return true;
  if (/^tool_output:\/\/blobs\/[0-9a-f]{16}$/i.test(value)) return true;
  if (/^workspace:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return true;
  if (/^\[@[^\]\s]+\]$/.test(value)) return true;
  if (/^kb:\/\/documents\/.+/.test(value)) return true;
  if (/^https?:\/\/.+/.test(value)) return true;
  return false;
}
