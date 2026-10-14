import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { CustomSelect, ColorPickerPanel } from '../../src';
import type { CustomSelectOption } from '../../src';
import '../../src/styles/styles.css';

interface MenuCase {
  manual: boolean;
  count?: number;
  x?: number;
  y?: number;
  theme?: string;
  selectedIndex?: number;
}

let app: App | null = null;
let selections: string[] = [];
let panelClicks = 0;
let colorSelections = 0;

async function settle() {
  await nextTick();
  for (let i = 0; i < 4; i += 1)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
}

async function mount({
  manual,
  count = 170,
  x = 40,
  y = 40,
  theme = 'light',
  selectedIndex,
}: MenuCase) {
  app?.unmount();
  await settle();
  selections = [];
  panelClicks = 0;
  colorSelections = 0;
  document.documentElement.dataset.linnyaUiTheme = theme;
  document.body.style.margin = '0';
  document.body.style.height = '1600px';
  const options: CustomSelectOption<string>[] = [
    {
      text: 'Long list',
      children: [
        { isGroup: true, label: 'Group' },
        { text: 'Disabled', value: 'disabled', disabled: true, disabledReason: 'Unavailable' },
        ...Array.from({ length: count }, (_, index) => ({
          text: `Option ${index}`,
          value: `row-${index}`,
          selected: index === selectedIndex,
          ...(index === 80
            ? {
                children: Array.from({ length: 171 }, (_, child) => ({
                  text: `Setting ${child}`,
                  value: `setting-${child}`,
                })),
              }
            : {}),
        })),
      ],
    },
    { text: 'Short list', children: [{ text: 'Short child', value: 'short' }] },
    {
      text: 'Properties',
      isPanel: true,
      children: [
        { label: 'Name', value: 'Document', clickable: true, onClick: () => (panelClicks += 1) },
      ],
    },
    { text: 'Color', isColorPicker: true, children: [{ value: 'color' }] },
  ];
  app = createApp({
    setup() {
      const open = ref(true);
      return () =>
        h('div', { style: { position: 'fixed', left: `${x}px`, top: `${y}px`, width: '180px' } }, [
          manual && !open.value
            ? null
            : h(
                CustomSelect<string>,
                {
                  options,
                  manualMode: manual,
                  parentIsOpen: open.value,
                  semanticRole: 'menu',
                  usePortalToBody: !manual,
                  'onUpdate:modelValue': (value: string) => selections.push(value),
                  onClose: () => {
                    open.value = false;
                  },
                },
                {
                  'color-picker': () =>
                    h(ColorPickerPanel, {
                      backgroundColors: [
                        {
                          value: 'accent',
                          labelKey: 'accent',
                          label: 'Accent',
                          cssVar: '--color-accent',
                          fallbackHex: '#ff0000',
                        },
                      ],
                      showText: false,
                      onSelectBackground: () => {
                        colorSelections += 1;
                      },
                    }),
                }
              ),
        ]);
    },
  });
  app.mount('#fixture');
  if (!manual) document.querySelector<HTMLButtonElement>('.select-trigger')?.click();
  await settle();
}

function snapshot() {
  const panels = [...document.querySelectorAll<HTMLElement>('.custom-select__submenu')].filter(
    panel => !panel.classList.contains('submenu-fade-leave-active')
  );
  return {
    viewport: { width: innerWidth, height: innerHeight },
    activeText: document.activeElement?.textContent?.trim(),
    activeInSubmenu: !!document.activeElement?.closest('.custom-select__submenu'),
    selections: [...selections],
    panelClicks,
    colorSelections,
    scrollY,
    panels: panels.map(panel => {
      const rect = panel.getBoundingClientRect();
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.getBoundingClientRect()
          : null;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        activeVisible: !!active && active.top >= rect.top && active.bottom <= rect.bottom,
        overflowY: getComputedStyle(panel).overflowY,
        nested: panel.classList.contains('custom-select__submenu--nested'),
        visibility: getComputedStyle(panel).visibility,
      };
    }),
  };
}

const fixture = { mount, settle, snapshot };
declare global {
  interface Window {
    menuFixture: typeof fixture;
  }
}
window.menuFixture = fixture;
