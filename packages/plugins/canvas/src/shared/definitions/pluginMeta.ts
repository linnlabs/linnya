import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas/plugins/manifest';
import manifestJson from '../../../plugin.json';
export const canvasManifest = parsePluginManifest(manifestJson);
export const CANVAS_PLUGIN_ID = canvasManifest.id;
export const CANVAS_DOCUMENT_TYPE = 'canvas';
export const CANVAS_FILE_EXTENSION = '.canvas';
export const canvasPluginMeta = pluginMetaFromManifest(canvasManifest, {
  builtin: true,
  required: false,
});
