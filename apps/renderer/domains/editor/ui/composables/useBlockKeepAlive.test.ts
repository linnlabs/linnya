import { describe, expect, it } from 'vitest';
import { computed, reactive } from 'vue';
import type { BlockKeepAliveApi } from './useBlockKeepAlive';

describe('useBlockKeepAlive contract', () => {
  it('多个原因独立注册和释放，任一原因存在即保持激活', () => {
    const activeReasons = reactive(new Set<string>());
    const api: BlockKeepAliveApi = {
      register(reason) {
        activeReasons.add(reason);
      },
      unregister(reason) {
        activeReasons.delete(reason);
      },
    };
    const isKeepAlive = computed(() => activeReasons.size > 0);

    api.register('audio-recording');
    api.register('menu-open');
    expect(isKeepAlive.value).toBe(true);

    api.unregister('audio-recording');
    expect(isKeepAlive.value).toBe(true);

    api.unregister('menu-open');
    expect(isKeepAlive.value).toBe(false);
  });
});
