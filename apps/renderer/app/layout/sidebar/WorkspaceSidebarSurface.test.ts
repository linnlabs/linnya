import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = fs.readFileSync(new URL('./WorkspaceSidebarSurface.vue', import.meta.url), 'utf8');
const listNavSource = fs.readFileSync(new URL('./components/SidebarListNav.vue', import.meta.url), 'utf8');

describe('WorkspaceSidebarSurface', () => {
  it('主组合面保持在 700 行以内', () => {
    expect(sidebarSource.split('\n').length).toBeLessThanOrEqual(700);
  });

  it('隐藏 Linnya 助手入口，并绑定插件页选中态', () => {
    const pluginLabelIndex = listNavSource.indexOf("layout.sidebar.nav.plugins");
    const pluginButtonStart = listNavSource.lastIndexOf('<button', pluginLabelIndex);
    const pluginButtonEnd = listNavSource.indexOf('</button>', pluginLabelIndex);
    const pluginButtonSource = listNavSource.slice(pluginButtonStart, pluginButtonEnd);

    expect(pluginLabelIndex).toBeGreaterThan(0);
    expect(listNavSource).not.toContain('<span class="nav-label">Linnya 助手</span>');
    expect(pluginButtonSource).toContain('isPluginStoreActive');
    expect(pluginButtonSource).toContain("plugin-store-click");
    expect(sidebarSource).toContain(':is-plugin-store-active="isPluginStoreActive()"');
    expect(sidebarSource).toContain('@plugin-store-click="handlePluginStoreClick"');
  });
});
