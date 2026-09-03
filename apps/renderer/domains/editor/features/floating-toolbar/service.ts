
import { reactive, markRaw } from 'vue';
import { getProvidersForContext } from './registry';
import type { ToolbarContext, ToolbarButton, ToolbarItemGroup } from './types';

type ToolbarItem = ToolbarButton | ToolbarItemGroup;

function isToolbarItemGroup(item: ToolbarItem): item is ToolbarItemGroup {
  return 'items' in item;
}

class FloatingToolbarService {
  state = reactive({
    isOpen: false,
    position: { top: -10000, left: -10000 },
    items: [] as ToolbarItem[],
  });

  update(context: ToolbarContext) {
    const providers = getProvidersForContext(context);

    if (providers.length === 0) {
      this.close();
      return;
    }
    
    const allItems = providers.flatMap(p => p.getItems(context));

    // 避免将组件本身变成响应式对象：用 markRaw 包一层
    this.state.items = allItems.map((item) => {
      if (isToolbarItemGroup(item)) {
        return {
          ...item,
          items: item.items.map((button) => ({
            ...button,
            component: markRaw(button.component),
          })),
        };
      }

      return {
        ...item,
        component: markRaw(item.component),
      };
    });
    this.state.isOpen = true;
  }

  setPosition(position: { top: number, left: number }) {
    this.state.position = position;
  }

  close() {
    this.state.isOpen = false;
  }
}

export const floatingToolbarService = new FloatingToolbarService();
