// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, markRaw, nextTick } from 'vue';
import { CustomSelect } from '../src';
import type { CustomSelectValue } from '../src';

interface MountedCustomSelect {
  readonly host: HTMLElement;
  readonly unmount: () => void;
}

function mountUnifiedActionMenu(onSelect: (value: CustomSelectValue) => void): MountedCustomSelect {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ContractIcon = markRaw({
    render() {
      return h('svg', { class: 'contract-icon' });
    },
  });
  const app = createApp({
    render() {
      return h(CustomSelect, {
        modelValue: null,
        semanticRole: 'menu',
        options: [
          {
            text: '移动到项目',
            iconComponent: ContractIcon,
            children: [
              {
                value: 'move-to-project:project-2',
                text: '客户项目',
                iconComponent: ContractIcon,
              },
            ],
          },
        ],
        'onUpdate:modelValue': onSelect,
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function mountCustomSelect(
  optionsMotionDirection: 'down' | 'up' = 'down',
): MountedCustomSelect {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render() {
      return h(CustomSelect, {
        modelValue: 'model-a',
        optionsMotionDirection,
        options: [
          {
            value: 'model-a',
            text: 'Model A',
            children: [
              { isGroup: true, label: '思考程度' },
              { value: 'model-a-low', text: '低' },
              { value: 'model-a-high', text: '高', selected: true },
            ],
          },
        ],
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function mountSearchableNestedSelect(): MountedCustomSelect {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render() {
      return h(CustomSelect, {
        modelValue: 'gpt-5.6',
        options: [
          {
            value: 'openai',
            text: 'OpenAI',
            children: [
              { value: 'gpt-5.6', text: 'GPT-5.6' },
              { value: 'gpt-5.5', text: 'GPT-5.5' },
            ],
          },
        ],
      }, {
        'options-header': () => h('input', {
          class: 'model-search',
          placeholder: '搜索模型',
        }),
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function mountDeeplyNestedSelect(onSelect: (value: unknown) => void): MountedCustomSelect {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render() {
      return h(CustomSelect, {
        modelValue: 'gpt-5.6',
        options: [
          {
            text: 'OpenAI',
            children: [
              {
                value: 'gpt-5.6',
                text: 'GPT-5.6 · 高',
                allowDirectSelect: true,
                children: [
                  { isGroup: true, label: '思考程度' },
                  { value: 'gpt-5.6::reasoning::low', text: '低' },
                  { value: 'gpt-5.6::reasoning::high', text: '高', selected: true },
                ],
              },
            ],
          },
        ],
        'onUpdate:modelValue': onSelect,
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function mountOverflowingLabelSelect(): MountedCustomSelect {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render() {
      return h(CustomSelect, {
        modelValue: null,
        optionLabelOverflow: 'marquee-on-hover',
        options: [
          {
            text: 'Provider',
            children: [
              {
                value: 'long-model',
                text: '这是一个长度明显超过子菜单可用宽度的模型名称',
              },
            ],
          },
        ],
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedSelects: MountedCustomSelect[] = [];

afterEach(() => {
  while (mountedSelects.length > 0) mountedSelects.pop()?.unmount();
  vi.unstubAllGlobals();
});

describe('CustomSelect 子菜单交互与定位', () => {
  it('由公开属性控制主菜单向上展开的动效方向', async () => {
    const mounted = mountCustomSelect('up');
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    expect(mounted.host.querySelector('.custom-select__options')?.classList)
      .toContain('custom-select__options--motion-up');
  });

  it('长选项默认省略，并仅在真实溢出时于 hover 中滚动到末尾', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountOverflowingLabelSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const provider = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(provider instanceof HTMLButtonElement)) throw new Error('Provider option not found');
    provider.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const modelOption = document.body.querySelector('.custom-select__submenu .select-option');
    const label = modelOption?.querySelector('.option-label');
    const labelText = modelOption?.querySelector('.linnya-ui-select-menu-option-label-text');
    if (!(modelOption instanceof HTMLButtonElement)) throw new Error('Model option not found');
    if (!(label instanceof HTMLElement) || !(labelText instanceof HTMLElement)) {
      throw new Error('Model option label not found');
    }
    expect(label.classList).toContain('linnya-ui-select-menu-option-label--ellipsis');
    expect(label.title).toBe('这是一个长度明显超过子菜单可用宽度的模型名称');
    modelOption.dispatchEvent(new MouseEvent('mouseenter'));
    expect(label.classList).not.toContain('linnya-ui-select-menu-option-label--scrolling');

    Object.defineProperties(labelText, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 120 },
    });
    modelOption.dispatchEvent(new MouseEvent('mouseenter'));

    expect(label.classList).toContain('linnya-ui-select-menu-option-label--scrolling');
    expect(label.style.getPropertyValue('--linnya-ui-select-menu-label-scroll-distance'))
      .toBe('180px');

    modelOption.dispatchEvent(new MouseEvent('mouseleave'));
    expect(label.classList).not.toContain('linnya-ui-select-menu-option-label--scrolling');
  });

  it('主菜单与子菜单共用标准菜单项合同并提交子项动作', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onSelect = vi.fn();
    const mounted = mountUnifiedActionMenu(onSelect);
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const parentOption = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');
    expect(parentOption.getAttribute('role')).toBe('menuitem');
    expect(parentOption.querySelector('.contract-icon')).not.toBeNull();

    parentOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const childOption = document.body.querySelector('.custom-select__submenu .select-option');
    if (!(childOption instanceof HTMLButtonElement)) throw new Error('Child option not found');
    expect(childOption.getAttribute('role')).toBe('menuitem');
    expect(childOption.querySelector('.contract-icon')).not.toBeNull();

    childOption.click();
    expect(onSelect).toHaveBeenCalledWith('move-to-project:project-2');
  });

  it('用子项值展示触发器，并在菜单顶部渲染业务搜索区', async () => {
    const mounted = mountSearchableNestedSelect();
    mountedSelects.push(mounted);

    expect(mounted.host.querySelector('.selected-value')?.textContent).toBe('GPT-5.6');

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    expect(mounted.host.querySelector('.select-options-header .model-search')).not.toBeNull();
    expect(mounted.host.querySelector('.custom-select__options .select-option')?.classList)
      .toContain('is-selected');
  });

  it('打开时只聚焦当前父项，右方向键才展开并聚焦已选子项', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountCustomSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();
    await nextTick();

    const parentOption = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');
    expect(document.activeElement).toBe(parentOption);
    expect(document.body.querySelector('.custom-select__submenu')).toBeNull();

    parentOption.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();

    const selectedChild = document.body.querySelector(
      '.custom-select__submenu .select-option.is-selected',
    );
    if (!(selectedChild instanceof HTMLButtonElement)) throw new Error('Selected child not found');
    expect(selectedChild.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(selectedChild);
  });

  it('Enter 打开父项子菜单，不把 Provider 父项当成选择值', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountSearchableNestedSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const provider = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(provider instanceof HTMLButtonElement)) throw new Error('Provider option not found');
    provider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    provider.click();
    await nextTick();

    expect(document.body.querySelector('.custom-select__submenu')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('GPT-5.6');
  });

  it('支持 Provider → 模型 → 思考强度两级子菜单并提交叶子值', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onSelect = vi.fn();
    const mounted = mountDeeplyNestedSelect(onSelect);
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    expect(trigger.textContent).toContain('GPT-5.6 · 高');
    trigger.click();
    await nextTick();

    const provider = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(provider instanceof HTMLButtonElement)) throw new Error('Provider option not found');
    provider.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const modelOption = document.body.querySelector('.custom-select__submenu .select-option');
    if (!(modelOption instanceof HTMLButtonElement)) throw new Error('Model option not found');
    expect(modelOption.classList).toContain('has-children');
    modelOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const effortOption = document.body.querySelector(
      '.custom-select__submenu--nested .select-option.is-selected',
    );
    if (!(effortOption instanceof HTMLButtonElement)) throw new Error('Effort option not found');
    expect(effortOption.textContent).toContain('高');
    effortOption.click();

    expect(onSelect).toHaveBeenCalledWith('gpt-5.6::reasoning::high');
  });

  it('右方向键逐级进入思考强度，左方向键返回模型', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountDeeplyNestedSelect(vi.fn());
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const provider = mounted.host.querySelector('.custom-select__options .select-option');
    if (!(provider instanceof HTMLButtonElement)) throw new Error('Provider option not found');
    provider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();

    const modelOption = document.body.querySelector('.custom-select__submenu .select-option');
    if (!(modelOption instanceof HTMLButtonElement)) throw new Error('Model option not found');
    expect(document.activeElement).toBe(modelOption);
    modelOption.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();

    const selectedEffort = document.body.querySelector(
      '.custom-select__submenu--nested .select-option.is-selected',
    );
    if (!(selectedEffort instanceof HTMLButtonElement)) throw new Error('Effort option not found');
    expect(document.activeElement).toBe(selectedEffort);

    selectedEffort.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(modelOption);
    expect(document.body.querySelector('.custom-select__submenu--nested')).toBeNull();
  });

  it('Teleport 子菜单层级高于 Settings 等外层浮层，而不是停在内部菜单层级', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountCustomSelect();
    mounted.host.style.position = 'fixed';
    mounted.host.style.zIndex = '2000';
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const optionsPanel = mounted.host.querySelector('.custom-select__options');
    const parentOption = optionsPanel?.querySelector('.select-option');
    if (!(optionsPanel instanceof HTMLElement)) throw new Error('Options panel not found');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');
    // 复现 Settings：内部菜单 z=100，但更外层 Modal overlay z=2000。
    optionsPanel.style.position = 'absolute';
    optionsPanel.style.zIndex = '100';
    parentOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const submenu = document.body.querySelector('.custom-select__submenu');
    if (!(submenu instanceof HTMLElement)) throw new Error('Submenu not found');
    expect(submenu.style.zIndex).toBe('2001');
  });

  it('主菜单滚动后，子菜单顶部仍与当前父项对齐', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountCustomSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const optionsPanel = mounted.host.querySelector('.custom-select__options');
    const parentOption = optionsPanel?.querySelector('.select-option');
    if (!(optionsPanel instanceof HTMLElement)) throw new Error('Options panel not found');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');

    // 菜单布局顶部为 100px，入场动画向上偏移 8px；父项在滚动 48px 后的可见顶部为 124px。
    optionsPanel.style.top = '100px';
    optionsPanel.scrollTop = 48;
    optionsPanel.getBoundingClientRect = () => ({
      top: 92,
      right: 300,
      bottom: 332,
      left: 100,
      width: 200,
      height: 240,
      x: 100,
      y: 92,
      toJSON: () => ({}),
    });
    parentOption.getBoundingClientRect = () => ({
      top: 124,
      right: 300,
      bottom: 156,
      left: 100,
      width: 200,
      height: 32,
      x: 100,
      y: 124,
      toJSON: () => ({}),
    });

    parentOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const submenu = document.body.querySelector('.custom-select__submenu');
    if (!(submenu instanceof HTMLElement)) throw new Error('Submenu not found');
    expect(submenu.style.top).toBe('132px');
  });

  it('底部父项下方空间不足时，子菜单底部与父项底部对齐', async () => {
    vi.stubGlobal('innerHeight', 500);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountCustomSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const optionsPanel = mounted.host.querySelector('.custom-select__options');
    const parentOption = optionsPanel?.querySelector('.select-option');
    if (!(optionsPanel instanceof HTMLElement)) throw new Error('Options panel not found');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');

    optionsPanel.style.top = '200px';
    optionsPanel.getBoundingClientRect = () => ({
      top: 200,
      right: 300,
      bottom: 480,
      left: 100,
      width: 200,
      height: 280,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    parentOption.getBoundingClientRect = () => ({
      top: 440,
      right: 300,
      bottom: 472,
      left: 100,
      width: 200,
      height: 32,
      x: 100,
      y: 440,
      toJSON: () => ({}),
    });

    parentOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const submenu = document.body.querySelector('.custom-select__submenu');
    if (!(submenu instanceof HTMLElement)) throw new Error('Submenu not found');
    // jsdom 无 CSS 布局，组件使用 200px 的默认测量高度：472 - 200 = 272。
    expect(submenu.style.top).toBe('272px');
  });

  it('顶部和底部对齐都会越界时，子菜单才围绕父项居中', async () => {
    vi.stubGlobal('innerHeight', 240);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const mounted = mountCustomSelect();
    mountedSelects.push(mounted);

    const trigger = mounted.host.querySelector('.select-trigger');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('CustomSelect trigger not found');
    trigger.click();
    await nextTick();

    const optionsPanel = mounted.host.querySelector('.custom-select__options');
    const parentOption = optionsPanel?.querySelector('.select-option');
    if (!(optionsPanel instanceof HTMLElement)) throw new Error('Options panel not found');
    if (!(parentOption instanceof HTMLButtonElement)) throw new Error('Parent option not found');

    optionsPanel.style.top = '40px';
    optionsPanel.getBoundingClientRect = () => ({
      top: 40,
      right: 300,
      bottom: 200,
      left: 100,
      width: 200,
      height: 160,
      x: 100,
      y: 40,
      toJSON: () => ({}),
    });
    parentOption.getBoundingClientRect = () => ({
      top: 104,
      right: 300,
      bottom: 136,
      left: 100,
      width: 200,
      height: 32,
      x: 100,
      y: 104,
      toJSON: () => ({}),
    });

    parentOption.dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    await nextTick();

    const submenu = document.body.querySelector('.custom-select__submenu');
    if (!(submenu instanceof HTMLElement)) throw new Error('Submenu not found');
    // 父项中心 120px，默认子菜单半高 100px，因此 top 为 20px。
    expect(submenu.style.top).toBe('20px');
  });
});
