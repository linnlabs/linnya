import { describe, expect, it } from 'vitest';
import { PendingUserInputRegistry } from './pendingUserInputRegistry';

function submit(registry: PendingUserInputRegistry, inputId: string, content = inputId) {
  registry.submit({ runId: 'run_1', conversationId: 'conv_1', inputId, content, submittedAt: 1 });
}

describe('PendingUserInputRegistry', () => {
  it('取用后确认即送达；送达后撤回返回 delivered，取回时不再出现', async () => {
    const registry = new PendingUserInputRegistry();
    submit(registry, 'a');
    submit(registry, 'b');
    const port = registry.portFor('run_1');

    const claimed = await port.claim();
    expect(claimed.map(input => input.id)).toEqual(['a', 'b']);
    await port.confirm(['a', 'b']);

    expect(registry.withdraw('run_1', 'a')).toBe('delivered');
    expect(registry.drain('run_1')).toEqual([]);
  });

  it('正在送达时不能撤回；提交失败放回后可以撤回或取回', async () => {
    const registry = new PendingUserInputRegistry();
    submit(registry, 'a');
    submit(registry, 'b');
    const port = registry.portFor('run_1');

    await port.claim();
    expect(registry.withdraw('run_1', 'a')).toBe('delivered');
    await port.release(['a', 'b']);

    expect(registry.withdraw('run_1', 'a')).toBe('withdrawn');
    expect(registry.drain('run_1').map(input => input.inputId)).toEqual(['b']);
  });

  it('同一 id 重发幂等；后来的插话排在下一批送达', async () => {
    const registry = new PendingUserInputRegistry();
    submit(registry, 'a');
    submit(registry, 'a');
    const port = registry.portFor('run_1');

    expect((await port.claim()).map(input => input.id)).toEqual(['a']);
    submit(registry, 'c');
    expect(await port.claim()).toEqual([{ id: 'c', content: 'c' }]);
    await port.confirm(['a']);
    submit(registry, 'a');
    expect(registry.list('run_1').map(input => input.inputId)).toEqual(['c']);
  });

  it('只允许同一对话读取或撤回', () => {
    const registry = new PendingUserInputRegistry();
    submit(registry, 'a');
    expect(registry.belongsTo('run_1', 'conv_1')).toBe(true);
    expect(registry.belongsTo('run_1', 'conv_other')).toBe(false);
    expect(() => registry.submit({
      runId: 'run_1', conversationId: 'conv_other', inputId: 'x', content: 'x', submittedAt: 1,
    })).toThrow();
  });
});
