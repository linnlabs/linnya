import { isRef, onBeforeUnmount, onMounted, ref, unref } from 'vue';
import type { Ref } from 'vue';
import type { DropdownElementReference } from '../definitions/selectMenu';

interface UseDropdownOptions {
  manualMode?: boolean;
  containerRef?: Ref<HTMLElement | null> | null;
  externalTriggerRef?: Ref<DropdownElementReference> | DropdownElementReference;
  dropdownRef?: Ref<DropdownElementReference> | DropdownElementReference;
  onClose?: (() => void) | null;
}

function resolveElement(
  reference: Ref<DropdownElementReference> | DropdownElementReference | undefined,
): HTMLElement | null {
  const outerValue = isRef(reference) ? reference.value : reference;
  const element = isRef(outerValue) ? outerValue.value : outerValue;
  return element instanceof HTMLElement ? element : null;
}

/** 管理下拉框的开关状态与点击外部关闭行为。 */
export function useDropdown({
  manualMode = false,
  containerRef = null,
  externalTriggerRef = null,
  dropdownRef = null,
  onClose = null,
}: UseDropdownOptions = {}) {
  const isOpen = ref(false);
  let delayedListenerTimer: number | null = null;

  const toggle = () => {
    if (!manualMode) isOpen.value = !isOpen.value;
  };

  const open = () => {
    if (!manualMode) isOpen.value = true;
  };

  const close = () => {
    if (manualMode && onClose) {
      onClose();
      return;
    }
    isOpen.value = false;
  };

  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    const container = unref(containerRef);
    const dropdown = resolveElement(dropdownRef);
    if (container?.contains(target) || dropdown?.contains(target)) return;

    const trigger = resolveElement(externalTriggerRef);
    if (trigger?.contains(target)) return;
    close();
  };

  onMounted(() => {
    if (manualMode) {
      delayedListenerTimer = window.setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
        delayedListenerTimer = null;
      }, 150);
      return;
    }
    document.addEventListener('click', handleClickOutside);
  });

  onBeforeUnmount(() => {
    if (delayedListenerTimer !== null) window.clearTimeout(delayedListenerTimer);
    document.removeEventListener('click', handleClickOutside);
  });

  return { isOpen, toggle, open, close };
}
