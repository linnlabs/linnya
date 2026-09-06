import {
  parsePluginManifest,
  pluginMetaFromManifest,
  readSingleOwnedFileType,
} from '@app/schemas/plugins/manifest';
import manifestJson from '../../plugin.json';

const manifest = parsePluginManifest(manifestJson);
const ownedFileType = readSingleOwnedFileType(manifest, {
  nodeType: 'mindmap',
  extension: '.mindmap',
});

export const MINDMAP_PLUGIN_ID = manifest.id;

export const MINDMAP_PLUGIN_VERSION = manifest.version;

export const MINDMAP_DOCUMENT_TYPE = ownedFileType.nodeType;

export const MINDMAP_FILE_SESSION_TYPE = MINDMAP_DOCUMENT_TYPE;

export const MINDMAP_FILE_EXTENSION = ownedFileType.extension;

export const MINDMAP_OWNED_TABLES = [
  'mindmap_versions',
] as const;

// 插件身份字段以 plugin.json 为唯一真源，ownedTables 保留 const 元组供 contribution 与契约测试复用。
export const MINDMAP_PLUGIN_META = pluginMetaFromManifest(manifest, {
  builtin: true,
  required: false,
});
