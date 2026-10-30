import type { InjectionKey, Ref } from 'vue'

/** 文档宿主提供不随正文滚动的挂载点，修订工具栏不读取应用分栏或侧边栏状态。 */
export const REVISION_TOOLBAR_OVERLAY_TARGET_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('REVISION_TOOLBAR_OVERLAY_TARGET')
