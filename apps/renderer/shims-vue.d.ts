// apps/renderer/types/shims-vue.d.ts

// 只负责给 .vue 提供类型声明，不要写其它 import/export

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
  }
  