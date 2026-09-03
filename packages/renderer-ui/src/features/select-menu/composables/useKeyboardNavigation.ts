import { nextTick, ref, unref, watch } from 'vue';
import type { Ref } from 'vue';
import type {
  CustomSelectKeyboardNavigationInput,
  CustomSelectOption,
  CustomSelectOptionValue,
} from '../definitions/selectMenu';

interface UseKeyboardNavigationOptions<Value extends CustomSelectOptionValue> {
  options: Readonly<Ref<readonly CustomSelectOption<Value>[]>> | readonly CustomSelectOption<Value>[];
  optionsRef: Ref<HTMLElement | null>;
  onSelect: (option: CustomSelectOption<Value>) => void;
  enabled?: boolean;
}

/** 编辑器场景使用的高亮项键盘导航，不搬移真实 DOM 焦点。 */
export function useKeyboardNavigation<Value extends CustomSelectOptionValue>({
  options,
  optionsRef,
  onSelect,
  enabled = false,
}: UseKeyboardNavigationOptions<Value>) {
  const selectedIndex = ref(-1);
  const getOptions = (): readonly CustomSelectOption<Value>[] => unref(options);

  const findNextValidIndex = (currentIndex: number, direction: number): number => {
    const currentOptions = getOptions();
    if (currentOptions.length === 0) return -1;

    let nextIndex = currentIndex;
    let attempts = 0;
    const totalItems = currentOptions.length;
    do {
      nextIndex = (nextIndex + direction + totalItems) % totalItems;
      attempts += 1;
    } while (
      (currentOptions[nextIndex]?.isSeparator
        || currentOptions[nextIndex]?.isGroup
        || currentOptions[nextIndex]?.disabled)
      && attempts <= totalItems
    );

    if (
      attempts > totalItems
      || currentOptions[nextIndex]?.isSeparator
      || currentOptions[nextIndex]?.isGroup
      || currentOptions[nextIndex]?.disabled
    ) return -1;
    return nextIndex;
  };

  const scrollToSelectedItem = () => {
    void nextTick(() => {
      if (!optionsRef.value || selectedIndex.value === -1) return;
      const selectedElement = optionsRef.value.children.item(selectedIndex.value);
      if (selectedElement?.classList.contains('select-option')) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const onKeyDown = ({ event }: CustomSelectKeyboardNavigationInput): boolean => {
    if (!enabled) return false;
    const currentOptions = getOptions();
    if (currentOptions.length === 0) return false;

    let direction = 0;
    if (event.key === 'ArrowUp') direction = -1;
    if (event.key === 'ArrowDown') direction = 1;
    if (direction !== 0) {
      event.preventDefault();
      if (selectedIndex.value === -1) selectedIndex.value = findNextValidIndex(-1, 1);
      const nextIndex = findNextValidIndex(selectedIndex.value, direction);
      if (nextIndex !== -1) {
        selectedIndex.value = nextIndex;
        scrollToSelectedItem();
      }
      return true;
    }

    if (event.key !== 'Enter') return false;
    event.preventDefault();
    if (selectedIndex.value === -1) selectedIndex.value = findNextValidIndex(-1, 1);
    const selectedOption = currentOptions[selectedIndex.value];
    if (
      selectedOption
      && !selectedOption.isSeparator
      && !selectedOption.isGroup
      && !selectedOption.disabled
    ) onSelect(selectedOption);
    return true;
  };

  const updateSelectedIndex = (index: number) => {
    if (enabled) selectedIndex.value = index;
  };

  const resetSelectedIndex = () => {
    if (enabled) selectedIndex.value = findNextValidIndex(-1, 1);
  };

  watch(getOptions, resetSelectedIndex, { immediate: true });
  return { selectedIndex, onKeyDown, updateSelectedIndex, resetSelectedIndex };
}
