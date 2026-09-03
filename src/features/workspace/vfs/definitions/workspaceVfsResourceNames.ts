/**
 * Workspace VFS 资源库的协议名与展示名。
 *
 * 中文备注：
 * - canonicalName 用于 node.name / node.path / read_file / 复制路径，必须稳定、英文、可脚本化；
 * - displayName 只用于 UI 展示，不参与路径解析，避免路径协议被本地化文案牵动。
 */

export const RESOURCE_LIBRARY_CANONICAL_NAME = 'Resources';
export const RESOURCE_LIBRARY_DISPLAY_NAME = '资源库';

export const GENERATED_IMAGES_CANONICAL_NAME = 'Generated Images';
export const GENERATED_IMAGES_DISPLAY_NAME = 'AI 生成图片';

export const ATTACHMENTS_CANONICAL_NAME = 'Attachments';
export const ATTACHMENTS_DISPLAY_NAME = '附件';
