// src/renderer/features/KnowledgeBase/index.js
//
// 知识库特性模块的统一入口
// 提供知识库管理的完整功能：UI组件、服务、Store等

// UI组件
export { default as KnowledgeBaseModal } from './ui/KnowledgeBaseModal.vue'
export { default as FileUploadTab } from './ui/FileUploadTab.vue'
export { default as FileManageTab } from './ui/FileManageTab.vue'

// 服务层
export { knowledgeBaseService } from './services/knowledgeBaseService.js'

// Store
export { useKnowledgeBaseStore } from './stores/knowledgeBase.js'

// 常量和类型（如果有）
export * from './constants/index.js'
