export interface TaskStateStepRow {
  /** TaskState next_steps 是快照内唯一的业务项，文本本身就是其稳定身份。 */
  readonly id: string;
  readonly text: string;
}

export function buildTaskStateStepRows(steps: readonly string[]): TaskStateStepRow[] {
  const seen = new Set<string>();
  return steps.map((text) => {
    if (seen.has(text)) {
      throw new Error(`TaskState next_steps contains duplicate item: ${text}`);
    }
    seen.add(text);
    return { id: text, text };
  });
}
