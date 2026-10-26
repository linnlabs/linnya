import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas/plugins/manifest';
import manifestJson from '../../plugin.json';

export const decisionManifest = parsePluginManifest(manifestJson);
export const decisionPluginMeta = pluginMetaFromManifest(decisionManifest, {
  builtin: true,
  required: false,
});
export const DecisionPromptKeys = { MAIN: 'decision_agent' } as const;
