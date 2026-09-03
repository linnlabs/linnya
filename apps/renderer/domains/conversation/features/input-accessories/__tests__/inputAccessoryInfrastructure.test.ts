// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  type App,
  type FunctionalComponent,
} from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConversationInputAccessoryComposerCommands,
  ConversationInputAccessoryProps,
} from '@linnya/plugin-host-contract/renderer';
import { useComposerReferences } from '../../composer-references';
import {
  clearConversationInputAccessoriesForTest,
  registerConversationInputAccessory,
  unregisterConversationInputAccessory,
} from '../registry/conversationInputAccessoryRegistry';
import { useConversationInputAccessories } from '../orchestration/useConversationInputAccessories';
import ConversationInputAccessoryHost from '../ui/ConversationInputAccessoryHost.vue';

const pluginId = 'input-accessory-test';
let mountedApp: App<Element> | null = null;
let container: HTMLDivElement | null = null;
let pinia: Pinia;

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  clearConversationInputAccessoriesForTest();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = null;
  container?.remove();
  container = null;
  clearConversationInputAccessoriesForTest();
});

describe('conversation input accessory infrastructure', () => {
  it('重复 identity 显式失败，卸载只删除对应 accessory', () => {
    const component: FunctionalComponent<ConversationInputAccessoryProps> = () => h('div');
    registerConversationInputAccessory({ pluginId, id: 'node-actions', component });

    expect(() => registerConversationInputAccessory({
      pluginId,
      id: 'node-actions',
      component,
    })).toThrow(/accessory 重复注册/);

    expect(unregisterConversationInputAccessory(pluginId, 'node-actions')).toBe(true);
    expect(unregisterConversationInputAccessory(pluginId, 'node-actions')).toBe(false);
  });

  it('挂载运行期组件，传递 disabled，并在 Input Extension 接管时隐藏', async () => {
    const blocked = ref(false);
    const disabled = ref(false);
    const visible = ref(true);

    const Accessory: FunctionalComponent<ConversationInputAccessoryProps> = (props) => {
      return h('button', {
        class: 'fake-input-accessory',
        disabled: props.disabled,
      }, 'Node actions');
    };

    registerConversationInputAccessory({
      pluginId,
      id: 'node-actions',
      component: Accessory,
      isVisible: () => visible.value,
    });

    const accessories = useConversationInputAccessories({
      isBlockedByInputExtension: () => blocked.value,
    });
    const Root = defineComponent({
      setup() {
        return () => h(ConversationInputAccessoryHost, {
          accessories: accessories.value,
          disabled: disabled.value,
        });
      },
    });

    if (!container) {
      throw new Error('expected test mount container');
    }
    const mountContainer = container;
    mountedApp = createApp(Root);
    mountedApp.use(pinia);
    mountedApp.mount(mountContainer);

    const readButton = (): HTMLButtonElement | null => (
      mountContainer.querySelector<HTMLButtonElement>('.fake-input-accessory')
    );
    expect(readButton()?.disabled).toBe(false);

    disabled.value = true;
    await nextTick();
    expect(readButton()?.disabled).toBe(true);

    blocked.value = true;
    await nextTick();
    expect(readButton()).toBeNull();

    blocked.value = false;
    visible.value = false;
    await nextTick();
    expect(readButton()).toBeNull();

    visible.value = true;
    await nextTick();
    expect(readButton()).not.toBeNull();

    const composerCommands: ConversationInputAccessoryComposerCommands | undefined =
      accessories.value[0]?.composer;
    if (!composerCommands) {
      throw new Error('expected accessory composer commands');
    }
    const ownReferenceId = composerCommands.addReference({
      kind: 'node',
      text: 'Node A',
      label: 'Node A',
    });
    const composerReferences = useComposerReferences();
    expect(composerReferences.references.value[0]).toMatchObject({
      id: ownReferenceId,
      pluginId,
      kind: 'node',
    });

    const otherReferenceId = composerReferences.addReference({
      pluginId: 'other-plugin',
      kind: 'node',
      text: 'Other node',
    });
    expect(() => composerCommands.removeReference(otherReferenceId)).toThrow(
      /不能移除其他 owner 的引用/,
    );
    composerCommands.removeReference(ownReferenceId);
    expect(composerReferences.references.value).toHaveLength(1);
    expect(composerReferences.references.value[0]?.id).toBe(otherReferenceId);

    unregisterConversationInputAccessory(pluginId, 'node-actions');
    await nextTick();
    expect(readButton()).toBeNull();
  });

});
