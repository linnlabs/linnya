/**
 * 主题管理 composable
 * 
 * 职责：
 * - 监听 uiStore 中的主题变化
 * - 将 Renderer UI 主题属性应用到 document 根元素
 * - 清理内联样式以确保 CSS 变量生效
 */

import { watchEffect } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import {
  applyThemeToDom,
  normalizeStoredTheme,
} from '../functions/themeClassManagement';

/**
 * 主题管理 composable
 * 
 * 自动监听 uiStore.theme 变化并应用到 DOM
 */
export function useThemeManager() {
  const uiStore = useUIStore();

  // 监听主题变化并自动应用
  watchEffect(() => {
    const theme = normalizeStoredTheme(uiStore.theme);

    applyThemeToDom(theme, {
      root: document.documentElement,
      body: document.body,
    });

    if (theme !== uiStore.theme) {
      uiStore.setTheme(theme);
    }
  });

  return {
    applyThemeToDom,
  };
}
