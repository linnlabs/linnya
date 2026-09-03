/**
 * MindMap Evidence Feature
 *
 * 中文说明：
 * - 对齐 Editor 的 `features/` 组织方式：把一个“跨层能力”（store + 同步插件 + UI）收拢在一起。
 * - 这里提供统一的导出入口，外部不要再从零散路径 import。
 */

export { installMindMapEvidenceFeature } from './services/installEvidenceFeature'

export { default as ReferenceInsertPanel } from './ui/ReferenceInsertPanel.vue'
export { default as ReferenceAddon } from './ui/ReferenceAddon.vue'

export { useMindMapEvidenceStore } from './domain/store/evidenceStore'

