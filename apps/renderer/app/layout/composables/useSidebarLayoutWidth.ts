import { computed } from 'vue';
import { useUIStore } from '@/shared/stores/ui';

export function useSidebarLayoutWidth() {
  const uiStore = useUIStore();

  const sidebarWidth = computed(() => uiStore.sidebarWidth);
  const sidebarOccupiedWidth = computed(() => {
    return uiStore.sidebarVisible ? uiStore.sidebarWidth : 0;
  });

  return {
    sidebarWidth,
    sidebarOccupiedWidth,
  };
}
