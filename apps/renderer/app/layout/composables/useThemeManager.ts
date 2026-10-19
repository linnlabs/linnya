/**
 * 主题管理 composable
 * 
 * 职责：
 * - 监听 uiStore 中的外观偏好与系统浅色 / 深色变化
 * - 将解析后的 Renderer UI 主题属性应用到 document 根元素
 * - 清理内联样式以确保 CSS 变量生效
 */

import { onScopeDispose, ref, watchEffect } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import {
  applyThemeToDom,
  normalizeStoredTheme,
  resolveThemePreference,
  SYSTEM_DARK_COLOR_SCHEME_QUERY,
} from '../functions/themeClassManagement';

/**
 * 主题管理 composable
 * 
 * 自动监听 uiStore.theme 与系统外观变化并应用到 DOM
 */
export function useThemeManager() {
  const uiStore = useUIStore();
  const systemDarkQuery = window.matchMedia(SYSTEM_DARK_COLOR_SCHEME_QUERY);
  const systemPrefersDark = ref(systemDarkQuery.matches);
  const handleSystemSchemeChange = (event: MediaQueryListEvent) => {
    systemPrefersDark.value = event.matches;
  };
  systemDarkQuery.addEventListener('change', handleSystemSchemeChange);
  onScopeDispose(() => {
    systemDarkQuery.removeEventListener('change', handleSystemSchemeChange);
  });

  // 监听外观偏好与系统外观并自动应用
  watchEffect(() => {
    const preference = normalizeStoredTheme(uiStore.theme);

    applyThemeToDom(resolveThemePreference(preference, systemPrefersDark.value), {
      root: document.documentElement,
      body: document.body,
    });

    if (preference !== uiStore.theme) {
      uiStore.setTheme(preference);
    }
  });

  return {
    applyThemeToDom,
  };
}
