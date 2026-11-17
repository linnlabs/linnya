// @vitest-environment jsdom
import { computed, createApp, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerKnowledgeCitationSearchPort } from '../../../ports/knowledgeCitationSearchPort';
import { useCitationPanelStore } from '../store/useCitationPanelStore';
import CitationPanel from './CitationPanel.vue';

vi.mock('./components/CitationKbTab.vue', () => ({ default: { render: () => null } }));
vi.mock('./components/CitationWebManualTab.vue', () => ({ default: { render: () => null } }));
vi.mock('@linnya/renderer-ui', async importOriginal => ({
  ...await importOriginal<typeof import('@linnya/renderer-ui')>(),
  DraggablePanel: { template: '<div><slot /></div>' },
}));

const navigation = vi.hoisted(() => ({ scope: { currentProjectId: 'project-a' } }));
vi.mock('@/app/navigation', () => ({ useNavigationScope: () => navigation.scope }));
vi.mock('@/shared/stores/ui', () => ({ useUIStore: () => ({ getEditor: () => null }) }));
vi.mock('../../../ui/useEditorLocalization', () => ({
  useEditorLocalization: () => ({ editorMessage: (key: string) => key }),
}));

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });
function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  navigation.scope = reactive({ currentProjectId: 'project-a' });
  const available = ref(true);
  cleanups.push(registerKnowledgeCitationSearchPort({
    isAvailable: () => available.value,
    listProjectLibraries: async () => [{ id: 'kb-a', name: 'Library A' }],
    searchLibrary: async () => [],
  }));
  const store = useCitationPanelStore();
  const element = document.createElement('div');
  document.body.append(element);
  const app = createApp(CitationPanel);
  app.use(pinia);
  app.mount(element);
  cleanups.push(() => { app.unmount(); element.remove(); });
  return { store, available };
}

describe('Citation panel knowledge availability', () => {
  it('preserves the insert syntax selected by open, and resets it only on close', async () => {
    const { store } = setup();
    store.open('kb', 'latexCite');
    await nextTick();
    expect(store.insertSyntax).toBe('latexCite');
    navigation.scope.currentProjectId = 'project-b';
    await nextTick();
    expect(store.insertSyntax).toBe('latexCite');
    store.close();
    await nextTick();
    expect(store.insertSyntax).toBe('bracketAt');
  });

  it('withdraws knowledge results without deleting a Web draft when the plugin stops', async () => {
    const { store, available } = setup();
    store.open('web', 'footnote');
    await nextTick();
    store.updateWebManualForm('title', 'Unsaved reference');
    store.updateWebManualForm('url', 'https://example.org/article');
    const title = computed(() => store.webManualForm.title);
    available.value = false;
    await nextTick();
    expect(store.activeTab).toBe('web');
    expect(title.value).toBe('Unsaved reference');
    expect(store.insertSyntax).toBe('footnote');
    expect(store.webManualForm.url).toBe('https://example.org/article');
    expect(store.availableKbs).toEqual([]);
    store.close();
    await nextTick();
    expect(title.value).toBe('');
  });
});
