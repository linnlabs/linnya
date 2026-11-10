import {
  resolveLocalizedText,
  resolveRegisteredMessage,
  useLocalizationStore,
  type LinnyaLocale,
  type MessageParams,
} from '@app/localization';
import { getActivePinia } from 'pinia';
import { CANVAS_ZH_MESSAGES, type CanvasMessageKey } from '../definitions/canvasMessageCatalog';

/**
 * 按当前界面语言取 Canvas 文案。组件之外（菜单、状态、失败）也用它。
 * 在 computed 或渲染里调用时会随语言切换重算；没有激活 Pinia 时回到中文源文案。
 */
export function canvasText(key: CanvasMessageKey, params?: MessageParams): string {
  const fallback = CANVAS_ZH_MESSAGES[key];
  const source = { key, fallback, ...(params ? { params } : {}) };
  if (!getActivePinia())
    return resolveLocalizedText(source, {
      locale: 'zh-CN',
      fallbackLocale: 'zh-CN',
      resolveMessage: () => null,
    });
  const store = useLocalizationStore();
  return resolveLocalizedText(source, {
    locale: store.currentLocale,
    fallbackLocale: store.fallbackLocale,
    resolveMessage: resolveRegisteredMessage,
  });
}

/** 日期等格式化要用的当前语言。 */
export function canvasLocale(): LinnyaLocale {
  return getActivePinia() ? useLocalizationStore().currentLocale : 'zh-CN';
}
