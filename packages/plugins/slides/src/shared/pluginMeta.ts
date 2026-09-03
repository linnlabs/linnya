import {
  parsePluginManifest,
  pluginMetaFromManifest,
  readSingleOwnedFileType,
} from '@app/schemas/plugins/manifest';
import manifestJson from '../../plugin.json';

export const SLIDES_OWNED_TABLES = [
  'presentation_documents',
  'presentation_revisions',
  'presentation_drafts',
  'presentation_templates',
  'presentation_image_bindings',
  'presentation_svg_graphic_bindings',
] as const;

const manifest = parsePluginManifest(manifestJson);
const ownedFileType = readSingleOwnedFileType(manifest, {
  nodeType: 'presentation',
  extension: '.slides',
});

export const SLIDES_PLUGIN_ID = manifest.id;

export const SLIDES_PLUGIN_VERSION = manifest.version;

export const SLIDES_DOCUMENT_TYPE = ownedFileType.nodeType;

export const SLIDES_ACTIVE_DOCUMENT_TYPE = manifest.id;

export const SLIDES_FILE_EXTENSION = ownedFileType.extension;

export const SLIDES_FILE_EXTENSIONS = [SLIDES_FILE_EXTENSION, '.ppt', '.pptx', '.deck.js'] as const;

// 插件身份字段以 plugin.json 为唯一真源，ownedTables 仍保留 const 元组供类型层消费。
export const SLIDES_PLUGIN_META = pluginMetaFromManifest(manifest, {
  builtin: true,
  required: false,
});
