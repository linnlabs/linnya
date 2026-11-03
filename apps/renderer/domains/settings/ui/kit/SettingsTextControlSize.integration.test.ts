// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp, defineComponent, h, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CustomTextInput } from '@linnya/renderer-ui';

import SettingsRow from './SettingsRow.vue';

const SETTINGS_TEXT_SIZE = 'var(--font-size-prose)';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/** jsdom 不解析 var() 与 inherit：这里按真实选择器找出 font-size 的声明来源，沿继承链向上取最近一条（inherit 视为未声明）。 */
function declaredInheritedFontSize(element: Element): string | null {
  const rules = Array.from(document.styleSheets).flatMap(sheet =>
    Array.from(sheet.cssRules).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule),
  );
  for (let node: Element | null = element; node; node = node.parentElement) {
    const matched = rules.filter(rule => {
      try {
        const declared = rule.style.getPropertyValue('font-size');
        return node?.matches(rule.selectorText) === true && declared !== '' && declared !== 'inherit';
      } catch {
        return false;
      }
    });
    const winner = matched[matched.length - 1];
    if (winner) return winner.style.getPropertyValue('font-size');
  }
  return null;
}

function queryInput(container: ParentNode, selector: string): HTMLInputElement {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${selector}`);
  return input;
}

describe('设置页文本输入字号', () => {
  let app: App<Element> | undefined;
  let container: HTMLDivElement;
  const stylesheets: HTMLStyleElement[] = [];

  beforeEach(() => {
    for (const source of [
      '../../styles/kit/settings-kit.css',
      '../../../../../../packages/renderer-ui/src/features/text-entry/styles/CustomTextField.css',
    ]) {
      const style = document.createElement('style');
      style.textContent = readSource(source);
      document.head.append(style);
      stylesheets.push(style);
    }
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    for (const style of stylesheets.splice(0)) style.remove();
    app = undefined;
  });

  function mount(render: () => ReturnType<typeof h>): void {
    app = createApp(defineComponent({ setup: () => render }));
    app.mount(container);
  }

  it('SettingsRow 内的输入无论是否直属控件列、是否记得加 class，都取设置页字号', () => {
    mount(() => h('div', [
      h(SettingsRow, { label: '直属' }, {
        default: () => h(CustomTextInput, { modelValue: '', class: 'direct' }),
      }),
      h(SettingsRow, { label: '没有标记 class' }, {
        default: () => h(CustomTextInput, { modelValue: '', class: 'unmarked' }),
      }),
      h(SettingsRow, { label: '被包裹层隔开', control: 'fill' }, {
        default: () => h('div', { class: 'wrapped' }, [h(CustomTextInput, { modelValue: '' })]),
      }),
    ]));

    for (const selector of ['.direct input', '.unmarked input', '.wrapped input']) {
      expect(declaredInheritedFontSize(queryInput(container, selector))).toBe(SETTINGS_TEXT_SIZE);
    }
  });

  it('SettingsRow 外的设置表单字段用 settings-text-control 取得同一字号，不要求直属控件列', () => {
    mount(() => h('div', { class: 'modal-field' }, [
      h('span', { class: 'modal-field-label' }, '字段'),
      h(CustomTextInput, { modelValue: '', class: 'settings-text-control' }),
    ]));

    expect(declaredInheritedFontSize(queryInput(container, '.modal-field input'))).toBe(SETTINGS_TEXT_SIZE);
  });

  it('紧凑搜索框保留自己的字号，不被设置页字号覆盖', () => {
    mount(() => h(SettingsRow, { label: '搜索' }, {
      default: () => h(CustomTextInput, { modelValue: '', size: 'compact', class: 'compact' }),
    }));

    expect(declaredInheritedFontSize(queryInput(container, '.compact input'))).toBe('var(--font-size-caption)');
  });

  it('设置件套之外的输入不受影响，继续继承所在环境的字号', () => {
    mount(() => h('div', { class: 'elsewhere' }, [h(CustomTextInput, { modelValue: '' })]));

    expect(declaredInheritedFontSize(queryInput(container, '.elsewhere input'))).toBeNull();
  });
});
