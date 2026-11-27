import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { CustomSelect, ColorPickerPanel, createPointAnchor, useAnchoredPosition } from '../../src';
import type {
  AnchoredPositionOptions,
  CustomSelectOption,
  CustomSelectOptionLabelOverflow,
  CustomSelectVariant,
} from '../../src';
import '../../src/styles/styles.css';

interface MenuCase {
  manual: boolean;
  count?: number;
  x?: number;
  y?: number;
  theme?: string;
  selectedIndex?: number;
  variant?: CustomSelectVariant;
  optionLabelOverflow?: CustomSelectOptionLabelOverflow;
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
  variant = 'default',
  optionLabelOverflow = 'visible',
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
    {
      text: 'Provider',
      children: [
        { text: 'Plain model', value: 'model-plain' },
        {
          text: 'Reasoning model',
          value: 'model-reasoning',
          allowDirectSelect: true,
          children: [
            { isGroup: true, label: 'Reasoning' },
            { text: 'High', value: 'model-reasoning-high' },
          ],
        },
      ],
    },
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
                  variant,
                  optionLabelOverflow,
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

interface AnchoredCase extends AnchoredPositionOptions {
  readonly x: number;
  readonly y: number;
  readonly panelWidth?: number;
  readonly panelHeight?: number;
  /** 浮层保持入场缩放（scale 0.96），检验定位按布局尺寸算。 */
  readonly scaled?: boolean;
  /** 锚点放进可滚动容器，检验滚动后浮层跟着锚点走。 */
  readonly inScroller?: boolean;
  /** 以点击位置为锚（右键菜单）。 */
  readonly point?: boolean;
}

/** 锚定定位的真实几何：jsdom 没有布局，翻转、收边和缩放下的量尺寸只能在浏览器里验证。 */
async function mountAnchored(input: AnchoredCase) {
  app?.unmount();
  await settle();
  document.body.style.margin = '0';
  document.body.style.height = 'auto';
  const { x, y, panelWidth = 160, panelHeight = 120, scaled, inScroller, point, ...placement } = input;
  app = createApp({
    setup() {
      const anchor = ref<HTMLElement | null>(null);
      const floating = ref<HTMLElement | null>(null);
      const pointAnchor = point ? createPointAnchor(x, y) : null;
      const anchored = useAnchoredPosition({
        anchor: () => pointAnchor ?? anchor.value,
        floating,
        open: true,
        placement,
      });
      const anchorStyle = { left: `${x}px`, top: `${y}px`, width: '80px', height: '24px' };
      return () => h('div', [
        inScroller
          ? h('div', {
            id: 'anchored-scroller',
            style: { position: 'fixed', left: '0', top: '0', width: '600px', height: '400px', overflow: 'auto' },
          }, [
            h('div', { style: { position: 'relative', height: '1600px' } }, [
              h('button', { ref: anchor, id: 'anchored-anchor', style: { position: 'absolute', ...anchorStyle } }),
            ]),
          ])
          : h('button', { ref: anchor, id: 'anchored-anchor', style: { position: 'fixed', ...anchorStyle } }),
        h('div', {
          ref: floating,
          id: 'anchored-floating',
          'data-side': anchored.side.value,
          style: {
            ...anchored.style.value,
            ...(placement.matchAnchorWidth ? {} : { width: `${panelWidth}px` }),
            height: `${panelHeight}px`,
            ...(scaled ? { transform: 'scale(0.96)' } : {}),
          },
        }),
      ]);
    },
  });
  app.mount('#fixture');
  await settle();
}

/** 浮层用布局坐标（style 上的 top/left 与 offset 尺寸），不受 scale 影响。 */
function anchoredGeometry() {
  const anchor = document.getElementById('anchored-anchor')?.getBoundingClientRect();
  const floating = document.getElementById('anchored-floating');
  if (!anchor || !floating) throw new Error('Anchored fixture not mounted');
  const top = Number.parseFloat(floating.style.top);
  const left = Number.parseFloat(floating.style.left);
  return {
    viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    anchor: { top: anchor.top, left: anchor.left, right: anchor.right, bottom: anchor.bottom, width: anchor.width },
    floating: {
      top,
      left,
      right: left + floating.offsetWidth,
      bottom: top + floating.offsetHeight,
      width: floating.offsetWidth,
      side: floating.dataset.side,
    },
  };
}

async function scrollAnchored(top: number) {
  document.getElementById('anchored-scroller')?.scrollTo({ top });
  await settle();
}

/** 触发器的真实排版：文字与箭头笔画之间的间隙由浏览器布局给出，jsdom 无法量到。 */
async function mountTrigger(theme: string) {
  app?.unmount();
  await settle();
  document.documentElement.dataset.linnyaUiTheme = theme;
  document.body.style.margin = '0';
  app = createApp(() =>
    h('div', { style: { position: 'fixed', left: '40px', top: '40px' } }, [
      h(CustomSelect<string>, {
        modelValue: 'zh-CN',
        options: [
          { value: 'zh-CN', text: '简体中文' },
          { value: 'en-US', text: 'English' },
        ],
      }),
    ])
  );
  app.mount('#fixture');
  await settle();
}

function triggerGeometry() {
  const trigger = document.querySelector<HTMLElement>('.select-trigger');
  const value = trigger?.querySelector<HTMLElement>('.selected-value');
  const chevron = trigger?.querySelector<SVGPathElement>('.arrow-icon path');
  if (!trigger || !value || !chevron) throw new Error('Select trigger parts not found');
  const text = document.createRange();
  text.selectNodeContents(value);
  const textRect = text.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const chevronRect = chevron.getBoundingClientRect();
  return {
    textRight: textRect.right,
    chevronLeft: chevronRect.left,
    chevronRight: chevronRect.right,
    triggerRight: triggerRect.right,
  };
}

/** Host 的全局 reset 是 border-box，菜单面板的 100% 宽度按它计算；fixture 只对标了属性的子树复现。 */
const appResetStyle = document.createElement('style');
appResetStyle.textContent =
  '[data-app-reset], [data-app-reset] *, [data-app-reset] *::before, [data-app-reset] *::after { box-sizing: border-box; }';
document.head.append(appResetStyle);

/**
 * 带对勾的语言选择器，宽度下限与设置页的业务样式一致（156px）：
 * 菜单与触发器同宽，每一行的文字、间距和对勾槽位要由真实排版完整放下。
 */
async function mountCheckmarkSelect(theme: string) {
  app?.unmount();
  await settle();
  document.documentElement.dataset.linnyaUiTheme = theme;
  document.body.style.margin = '0';
  app = createApp(() =>
    h('div', { 'data-app-reset': '', style: { position: 'fixed', left: '40px', top: '40px' } }, [
      h(CustomSelect<string>, {
        modelValue: 'zh-CN',
        showSelectedCheckmark: true,
        style: { minWidth: '156px', fontSize: '14px' },
        options: [
          { value: 'zh-CN', text: '简体中文' },
          { value: 'en-US', text: 'English' },
        ],
      }),
    ])
  );
  app.mount('#fixture');
  document.querySelector<HTMLButtonElement>('.select-trigger')?.click();
  await settle();
}

function checkmarkGeometry() {
  const trigger = document.querySelector<HTMLElement>('.select-trigger');
  const panel = document.querySelector<HTMLElement>('.custom-select__options');
  if (!trigger || !panel) throw new Error('Checkmark select parts not found');
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    triggerWidth: triggerRect.width,
    panelWidth: panelRect.width,
    panelScrollWidth: panel.scrollWidth,
    panelClientWidth: panel.clientWidth,
    rows: [...panel.querySelectorAll<HTMLElement>('.select-option')].map(row => {
      const label = row.querySelector<HTMLElement>('.linnya-ui-select-menu-option-label-text');
      const slot = row.querySelector<HTMLElement>('.option-check');
      const icon = slot?.querySelector<SVGElement>('svg') ?? null;
      if (!label || !slot) throw new Error('Option label or check slot not found');
      const text = document.createRange();
      text.selectNodeContents(label);
      const rowRect = row.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      return {
        text: label.textContent?.trim(),
        selected: row.classList.contains('is-selected'),
        rowLeft: rowRect.left,
        rowRight: rowRect.right,
        textLeft: textRect.left,
        textRight: textRect.right,
        slotLeft: slotRect.left,
        slotRight: slotRect.right,
        slotWidth: slotRect.width,
        iconWidth: icon?.getBoundingClientRect().width ?? null,
        iconHeight: icon?.getBoundingClientRect().height ?? null,
        iconColor: icon ? getComputedStyle(icon).color : null,
        labelColor: getComputedStyle(label).color,
        rowPaddingRight: Number.parseFloat(getComputedStyle(row).paddingRight),
        rowBackground: getComputedStyle(row).backgroundColor,
      };
    }),
  };
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

function submenuRows() {
  return [...document.querySelectorAll<HTMLElement>('.custom-select__submenu .select-option')].map(
    row => {
      const width = (selector: string) => row.querySelector(selector)?.getBoundingClientRect().width;
      return {
        text: row.textContent?.trim(),
        rowWidth: row.getBoundingClientRect().width,
        rowHeight: row.getBoundingClientRect().height,
        labelWidth: width('.option-label'),
        labelTextWidth: row.querySelector('.linnya-ui-select-menu-option-label-text')?.scrollWidth,
        arrowWidth: width('.option-arrow'),
        arrowHeight: row.querySelector('.option-arrow')?.getBoundingClientRect().height,
      };
    }
  );
}

const fixture = {
  anchoredGeometry,
  checkmarkGeometry,
  mount,
  mountAnchored,
  mountCheckmarkSelect,
  mountTrigger,
  scrollAnchored,
  settle,
  snapshot,
  submenuRows,
  triggerGeometry,
};
declare global {
  interface Window {
    menuFixture: typeof fixture;
  }
}
window.menuFixture = fixture;
