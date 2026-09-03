// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import {
  ActionButtons,
  type ActionButtonsPrimaryVariant,
} from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountActionButtons(options: {
  readonly primaryVariant?: ActionButtonsPrimaryVariant;
  readonly primaryDisabled?: boolean;
  readonly secondaryDisabled?: boolean;
  readonly onPrimary?: () => void;
  readonly onSecondary?: () => void;
} = {}): readonly [HTMLButtonElement, HTMLButtonElement] {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(ActionButtons, {
      primaryActionText: '确认',
      secondaryActionText: '取消',
      primaryVariant: options.primaryVariant,
      isPrimaryActionDisabled: options.primaryDisabled,
      isSecondaryActionDisabled: options.secondaryDisabled,
      primaryButtonAttributes: {
        'aria-label': '确认操作',
        'data-action-owner': 'consumer',
      },
      onPrimaryClick: options.onPrimary,
      onSecondaryClick: options.onSecondary,
    }),
  });
  app.mount(host);
  mountedApps.push({ app, host });

  const buttons = host.querySelectorAll('button');
  const secondary = buttons.item(0);
  const primary = buttons.item(1);
  if (!(secondary instanceof HTMLButtonElement) || !(primary instanceof HTMLButtonElement)) {
    throw new Error('ActionButtons controls not found');
  }
  return [secondary, primary];
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('ActionButtons', () => {
  it('把浏览器属性投影到真实按钮，并只发出明确的主次操作事件', () => {
    let primaryClicks = 0;
    let secondaryClicks = 0;
    const [secondary, primary] = mountActionButtons({
      onPrimary: () => { primaryClicks += 1; },
      onSecondary: () => { secondaryClicks += 1; },
    });

    expect(primary.getAttribute('aria-label')).toBe('确认操作');
    expect(primary.dataset.actionOwner).toBe('consumer');
    primary.click();
    secondary.click();

    expect(primaryClicks).toBe(1);
    expect(secondaryClicks).toBe(1);
  });

  it('只服从调用方投影的 disabled 状态，不理解业务忙碌或生成规则', () => {
    let primaryClicks = 0;
    let secondaryClicks = 0;
    const [secondary, primary] = mountActionButtons({
      primaryDisabled: true,
      secondaryDisabled: true,
      onPrimary: () => { primaryClicks += 1; },
      onSecondary: () => { secondaryClicks += 1; },
    });

    primary.click();
    secondary.click();

    expect(primary.disabled).toBe(true);
    expect(secondary.disabled).toBe(true);
    expect(primaryClicks).toBe(0);
    expect(secondaryClicks).toBe(0);
  });

  it.each([
    ['default', ['primary'], ['danger', 'accent']],
    ['danger', ['danger'], ['primary', 'accent']],
    ['accent', ['primary', 'accent'], ['danger']],
  ] as const)('把 %s 解析为唯一主操作视觉语义', (variant, included, excluded) => {
    const [, primary] = mountActionButtons({ primaryVariant: variant });

    for (const className of included) expect(primary.classList.contains(className)).toBe(true);
    for (const className of excluded) expect(primary.classList.contains(className)).toBe(false);
  });
});
