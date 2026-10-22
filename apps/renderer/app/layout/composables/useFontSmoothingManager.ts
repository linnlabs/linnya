/**
 * 字体抗锯齿管理 composable：监听 uiStore.fontSmoothing 并应用到 document 根元素。
 */
import { watchEffect } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { applyFontSmoothingToDom } from '../functions/fontSmoothing';

export function useFontSmoothingManager(): void {
  const uiStore = useUIStore();
  watchEffect(() => {
    applyFontSmoothingToDom(uiStore.fontSmoothing, document.documentElement);
  });
}
