/**
 * Vue 依赖注入 Token 定义
 * 使用 Symbol 避免字符串魔法值，提供类型安全
 */
import type { InjectionKey, Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'

/**
 * 编辑器实例注入 Key
 */
export const EDITOR_KEY: InjectionKey<Ref<Editor | null>> = Symbol('EDITOR_KEY')
