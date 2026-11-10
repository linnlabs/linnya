// @vitest-environment jsdom
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createPersistedState } from 'pinia-plugin-persistedstate';
import { expect, it } from 'vitest';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import { useProjectOverviewLayoutStore } from './projectOverviewLayoutStore';

function reopen() {
  const pinia = createPinia();
  pinia.use(createPersistedState());
  createApp({}).use(pinia);
  setActivePinia(pinia);
  return useProjectOverviewLayoutStore();
}

it('重新启动后保留列显隐、顺序和宽度；恢复默认后再次启动仍是默认布局', async () => {
  getRendererPersistStorage().removeItem('project-overview-layout');
  try {
    const first = reopen();
    const defaults = first.layout;
    first.toggleColumn('location');
    first.moveColumn('source', 'modified');
    first.resizeColumn('conversation', 300);
    await nextTick();
    const second = reopen();
    expect(second.layout).toEqual(first.layout);
    second.reset();
    await nextTick();
    expect(reopen().layout).toEqual(defaults);
  } finally {
    getRendererPersistStorage().removeItem('project-overview-layout');
  }
});
