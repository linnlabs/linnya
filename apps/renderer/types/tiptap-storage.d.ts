/**
 * @file tiptap-storage.d.ts
 * @description 为编辑器扩展写入的共享 storage 增加窄类型合同。
 */

import '@tiptap/core'

export {}

interface FindReplaceStoreStorage {
  showPanel: () => void
}

declare module '@tiptap/core' {
  interface Storage {
    findReplaceStore?: FindReplaceStoreStorage
  }
}
