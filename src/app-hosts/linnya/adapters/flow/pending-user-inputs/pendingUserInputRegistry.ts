import type { graph } from '@linnlabs/linnkit/runtime-kernel';

export type PendingUserInputWithdrawOutcome = 'withdrawn' | 'delivered' | 'not_found';

export interface DrainedPendingUserInput {
  readonly inputId: string;
  readonly content: string;
  readonly submittedAt: number;
}

interface Entry {
  readonly id: string;
  readonly conversationId: string;
  readonly content: string;
  readonly submittedAt: number;
  state: 'pending' | 'delivering';
}

interface RunEntries {
  readonly conversationId: string;
  readonly entries: Entry[];
  /** 已经送达的输入 id；撤回请求晚到时据此回答“已送达”。 */
  readonly delivered: Set<string>;
}

/**
 * 前台运行的待送达插话。只放在 App Server 内存里：输入框草稿本来就不跨重启保存，
 * 退出 App 时没送达的插话与没发出的草稿一样不保留。
 *
 * 送达由 Linnkit 在一批工具结算后通过 `portFor(runId)` 取用：取用期间（delivering）不能撤回，
 * 边界提交成功才算送达，失败时回到待送达。运行结束或暂停后，没送达的由 Renderer `drain` 取回。
 */
export class PendingUserInputRegistry {
  private readonly runs = new Map<string, RunEntries>();

  submit(input: {
    readonly runId: string;
    readonly conversationId: string;
    readonly inputId: string;
    readonly content: string;
    readonly submittedAt: number;
  }): void {
    const run = this.runs.get(input.runId) ?? {
      conversationId: input.conversationId,
      entries: [],
      delivered: new Set<string>(),
    };
    if (run.conversationId !== input.conversationId) {
      throw new Error('Pending user input conversation does not match its run');
    }
    // 回执丢失后的重发按同一身份幂等接受。
    if (run.delivered.has(input.inputId) || run.entries.some(entry => entry.id === input.inputId)) return;
    run.entries.push({
      id: input.inputId,
      conversationId: input.conversationId,
      content: input.content,
      submittedAt: input.submittedAt,
      state: 'pending',
    });
    this.runs.set(input.runId, run);
  }

  withdraw(runId: string, inputId: string): PendingUserInputWithdrawOutcome {
    const run = this.runs.get(runId);
    if (!run) return 'not_found';
    if (run.delivered.has(inputId)) return 'delivered';
    const index = run.entries.findIndex(entry => entry.id === inputId);
    if (index === -1) return 'not_found';
    // 已被取用、正在随工具边界提交：结果只能是送达或放回，不能在中途撤销。
    if (run.entries[index].state === 'delivering') return 'delivered';
    run.entries.splice(index, 1);
    this.forgetIfEmpty(runId, run);
    return 'withdrawn';
  }

  /** 取回所有还没送达的输入（按提交顺序）；运行结束或暂停后由 Renderer 调用。 */
  drain(runId: string): DrainedPendingUserInput[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    const drained = run.entries.filter(entry => entry.state === 'pending');
    run.entries.splice(0, run.entries.length, ...run.entries.filter(entry => entry.state !== 'pending'));
    this.runs.delete(runId);
    return drained.map(entry => ({
      inputId: entry.id,
      content: entry.content,
      submittedAt: entry.submittedAt,
    }));
  }

  /** 列表为空（从未插话或已全部取回）时任何对话都可以安全地读到空结果。 */
  belongsTo(runId: string, conversationId: string): boolean {
    const run = this.runs.get(runId);
    return !run || run.conversationId === conversationId;
  }

  list(runId: string): DrainedPendingUserInput[] {
    return (this.runs.get(runId)?.entries ?? []).map(entry => ({
      inputId: entry.id,
      content: entry.content,
      submittedAt: entry.submittedAt,
    }));
  }

  portFor(runId: string): graph.PendingUserInputPort {
    return {
      claim: () => {
        const run = this.runs.get(runId);
        if (!run) return [];
        const claimed = run.entries.filter(entry => entry.state === 'pending');
        for (const entry of claimed) entry.state = 'delivering';
        return claimed.map(entry => ({ id: entry.id, content: entry.content }));
      },
      confirm: ids => {
        const run = this.runs.get(runId);
        if (!run) return;
        for (const id of ids) run.delivered.add(id);
        run.entries.splice(0, run.entries.length, ...run.entries.filter(entry => !ids.includes(entry.id)));
      },
      release: ids => {
        const run = this.runs.get(runId);
        if (!run) return;
        for (const entry of run.entries) {
          if (ids.includes(entry.id)) entry.state = 'pending';
        }
      },
    };
  }

  private forgetIfEmpty(runId: string, run: RunEntries): void {
    if (run.entries.length === 0 && run.delivered.size === 0) this.runs.delete(runId);
  }
}
