import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas/plugins/manifest';
import manifestJson from '../../../plugin.json';

export const knowledgeManifest = parsePluginManifest(manifestJson);
export const knowledgePluginMeta = pluginMetaFromManifest(knowledgeManifest, {
  builtin: true,
  required: false,
});
