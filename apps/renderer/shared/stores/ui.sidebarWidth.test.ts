import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { SIDEBAR_WIDTH_LIMITS, useUIStore } from './ui';

describe('ui store 侧栏宽度下限', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('窗口外观要求更宽时抬高下限，并把已恢复的最窄宽度归一上去', () => {
    const ui = useUIStore();
    ui.$patch({ sidebarWidth: SIDEBAR_WIDTH_LIMITS.min });
    ui.setSidebarMinWidth(202);
    expect(ui.sidebarMinWidth).toBe(202);
    expect(ui.sidebarWidth).toBe(202);
    ui.setSidebarWidth(150);
    expect(ui.sidebarWidth).toBe(202);
  });

  it('要求低于基础下限时仍按基础下限，回到较低下限不压窄当前宽度', () => {
    const ui = useUIStore();
    ui.setSidebarMinWidth(202);
    ui.setSidebarWidth(202);
    ui.setSidebarMinWidth(130);
    expect(ui.sidebarMinWidth).toBe(SIDEBAR_WIDTH_LIMITS.min);
    expect(ui.sidebarWidth).toBe(202);
    ui.setSidebarWidth(150);
    expect(ui.sidebarWidth).toBe(SIDEBAR_WIDTH_LIMITS.min);
  });
});
