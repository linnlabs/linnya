import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useProjectOverviewBoardOverrides } from './useProjectOverviewBoardOverrides';

let scope: EffectScope;
beforeEach(() => { scope = effectScope(); });
afterEach(() => { scope.stop(); });

describe('看板乐观挪动', () => {
  it('挪动一直保留到发起方释放，其他文档变化不影响', () => {
    const { overrides, place } = scope.run(() => useProjectOverviewBoardOverrides(ref('p')))!;
    const releaseA = place('a', 'done');
    place('b', null);
    expect(overrides.value.get('a')).toBe('done');
    expect(overrides.value.get('b')).toBeNull();
    releaseA();
    expect(overrides.value.has('a')).toBe(false);
    expect(overrides.value.get('b')).toBeNull();
  });
  it('同一张卡片再次挪动后，先前那次的释放不能撤掉新的挪动', () => {
    const { overrides, place } = scope.run(() => useProjectOverviewBoardOverrides(ref('p')))!;
    const first = place('a', 'todo');
    place('a', 'done');
    first();
    expect(overrides.value.get('a')).toBe('done');
  });
  it('换项目清掉全部挪动，迟到的释放也不会误伤之后的挪动', async () => {
    const id = ref('p');
    const { overrides, place } = scope.run(() => useProjectOverviewBoardOverrides(id))!;
    const stale = place('a', 'done');
    id.value = 'q'; await nextTick();
    expect(overrides.value.size).toBe(0);
    place('a', 'todo');
    stale();
    expect(overrides.value.get('a')).toBe('todo');
  });
});
