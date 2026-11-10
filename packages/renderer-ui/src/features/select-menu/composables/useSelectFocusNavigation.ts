import { isRef, nextTick, unref } from 'vue';
import type { Ref } from 'vue';
import type { DropdownElementReference } from '../definitions/selectMenu';

type FocusDirection = 1 | -1 | 'first' | 'last';

interface UseSelectFocusNavigationOptions {
  manualMode: Readonly<Ref<boolean>>;
  disabled: Readonly<Ref<boolean>>;
  isOpen: Readonly<Ref<boolean>>;
  selectRef: Ref<HTMLElement | null>;
  optionsRef: Ref<HTMLElement | null>;
  submenuRef: Ref<HTMLElement | null>;
  nestedSubmenuRef: Ref<HTMLElement | null>;
  externalTriggerRef: Readonly<Ref<DropdownElementReference>>;
  submenuPanelId: string;
  nestedSubmenuPanelId: string;
  toggle: () => void;
  close: () => void;
  closeSubmenu: () => void;
  closeNestedSubmenu: () => void;
}

/**
 * 最近一次输入是否来自键盘。菜单打开时要把焦点放到首项，浏览器只看“上一个焦点元素是否显示过焦点”，
 * 先按过键再右键也会判成键盘操作，所以按实际输入自行决定。监听挂在 window 捕获阶段，业务 stopPropagation 不影响。
 */
let lastInputWasKeyboard = false;
let inputTrackingInstalled = false;

function trackLastInput(): void {
  if (inputTrackingInstalled) return;
  inputTrackingInstalled = true;
  const options = { capture: true, passive: true } as const;
  window.addEventListener(
    'keydown',
    () => {
      lastInputWasKeyboard = true;
    },
    options
  );
  window.addEventListener(
    'pointerdown',
    () => {
      lastInputWasKeyboard = false;
    },
    options
  );
}

/** CustomSelect 内部的真实 DOM 焦点导航。 */
export function useSelectFocusNavigation({
  manualMode,
  disabled,
  isOpen,
  selectRef,
  optionsRef,
  submenuRef,
  nestedSubmenuRef,
  externalTriggerRef,
  submenuPanelId,
  nestedSubmenuPanelId,
  toggle,
  close,
  closeSubmenu,
  closeNestedSubmenu,
}: UseSelectFocusNavigationOptions) {
  trackLastInput();

  function resolveTriggerElement(): HTMLElement | null {
    if (!unref(manualMode)) {
      const trigger = unref(selectRef)?.querySelector('.select-trigger');
      return trigger instanceof HTMLElement ? trigger : null;
    }

    const outerValue = unref(externalTriggerRef);
    const trigger = isRef(outerValue) ? outerValue.value : outerValue;
    return trigger instanceof HTMLElement ? trigger : null;
  }

  function focusTrigger() {
    resolveTriggerElement()?.focus();
  }

  function restoreTriggerFocus() {
    void nextTick(focusTrigger);
  }

  function focusFirstOrSelected(panel: HTMLElement | null) {
    if (!(panel instanceof HTMLElement)) return;
    const selected = panel.querySelector('button.select-option.is-selected:not(:disabled)');
    const firstEnabled = panel.querySelector('button.select-option:not(:disabled)');
    const target = selected ?? firstEnabled;
    if (!(target instanceof HTMLElement)) return;
    // focusVisible 尚未进 TS 的 DOM 类型；鼠标打开时焦点就位但不显示，键盘操作时才显示。
    const options: FocusOptions & { focusVisible: boolean } = {
      focusVisible: lastInputWasKeyboard,
    };
    target.focus(options);
  }

  function focusCurrentOption() {
    focusFirstOrSelected(unref(optionsRef));
  }

  function focusCurrentSubmenuOption() {
    focusFirstOrSelected(unref(submenuRef));
  }

  function focusCurrentNestedSubmenuOption() {
    focusFirstOrSelected(unref(nestedSubmenuRef));
  }

  function moveFocusWithinPanel(event: KeyboardEvent, direction: FocusDirection): boolean {
    if (!(event.currentTarget instanceof HTMLElement)) return false;
    if (event.target instanceof Element && event.target.closest('.option-inline-number'))
      return false;

    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button.select-option:not(:disabled)')
    );
    if (options.length === 0) return false;

    const activeIndex = options.findIndex(option => option === document.activeElement);
    const nextIndex =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? options.length - 1
          : (activeIndex + direction + options.length) % options.length;
    options[nextIndex]?.focus();
    return true;
  }

  function handleOptionsKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      restoreTriggerFocus();
      return;
    }

    const direction: FocusDirection | null =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'Home'
            ? 'first'
            : event.key === 'End'
              ? 'last'
              : null;
    if (direction !== null && moveFocusWithinPanel(event, direction)) event.preventDefault();
  }

  function handleSubmenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const parent = unref(optionsRef)?.querySelector(`[aria-controls="${submenuPanelId}"]`);
      closeSubmenu();
      if (parent instanceof HTMLElement) void nextTick(() => parent.focus());
      return;
    }
    handleOptionsKeydown(event);
  }

  function handleNestedSubmenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      const parent = unref(submenuRef)?.querySelector(`[aria-controls="${nestedSubmenuPanelId}"]`);
      closeNestedSubmenu();
      if (parent instanceof HTMLElement) void nextTick(() => parent.focus());
      return;
    }
    handleOptionsKeydown(event);
  }

  function openFromKeyboard() {
    if (unref(manualMode) || unref(disabled)) return;
    if (!unref(isOpen)) toggle();
    void nextTick(focusCurrentOption);
  }

  return {
    focusCurrentOption,
    focusCurrentSubmenuOption,
    focusCurrentNestedSubmenuOption,
    handleOptionsKeydown,
    handleSubmenuKeydown,
    handleNestedSubmenuKeydown,
    openFromKeyboard,
    restoreTriggerFocus,
  };
}
