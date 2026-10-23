// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useFigureCaptionDraft } from './useFigureCaptionDraft';

describe('题注交互提交边界', () => {
  function setup() {
    const scope = effectScope();
    const value = ref('原题注'),
      version = ref('v1'),
      editable = ref(true);
    const commit = vi.fn(),
      active = vi.fn();
    const state = scope.run(() =>
      useFigureCaptionDraft({ value, version, editable, limit: ref(200), commit, active })
    )!;
    return { state, commit, value, version, editable, stop: () => scope.stop() };
  }
  it('输入法确认不提交；最终 Enter 只提交一次，随后 blur 不重复提交', () => {
    const { state, commit, stop } = setup();
    state.begin();
    state.draft.value = '新的题注';
    state.composing.value = true;
    state.commit();
    expect(commit).not.toHaveBeenCalled();
    state.composing.value = false;
    state.keydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    state.commit();
    expect(commit).toHaveBeenCalledExactlyOnceWith('新的题注', 'v1');
    stop();
  });
  it('无变化和取消不提交，非法题注不会被截断；清空只提交一次', () => {
    const { state, commit, stop } = setup();
    state.begin();
    state.commit();
    state.begin();
    state.draft.value = 'x'.repeat(201);
    state.commit();
    expect(state.editing.value).toBe(true);
    expect(state.draft.value).toHaveLength(201);
    state.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(commit).not.toHaveBeenCalled();
    state.begin();
    state.draft.value = '';
    state.commit();
    expect(commit).toHaveBeenCalledExactlyOnceWith('', 'v1');
    stop();
  });
  it('输入法组合中失焦等待 compositionend，再提交最终文字', () => {
    const { state, commit, stop } = setup();
    state.begin();
    state.composing.value = true;
    state.draft.value = '输入中';
    state.blur();
    expect(commit).not.toHaveBeenCalled();
    state.draft.value = '最终题注';
    state.endComposition();
    state.blur();
    expect(commit).toHaveBeenCalledExactlyOnceWith('最终题注', 'v1');
    stop();
  });
  it('整个块版本变化或进入 Pending 后，草稿不得覆盖新内容', async () => {
    const { state, commit, version, editable, stop } = setup();
    state.begin();
    state.draft.value = '草稿';
    version.value = 'v2';
    state.commit();
    expect(state.conflict.value).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    state.begin();
    editable.value = false;
    await nextTick();
    expect(state.editing.value).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    stop();
  });
});
