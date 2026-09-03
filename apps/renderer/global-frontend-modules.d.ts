// 全局前端模块类型声明，给编辑器 / 根 tsconfig 使用

import type { DefineComponent } from 'vue';

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>
  export default component
}



