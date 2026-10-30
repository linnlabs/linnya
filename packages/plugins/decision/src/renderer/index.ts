import type { RendererPluginContribution } from '@plugin/renderer/pluginContribution';
import { decisionPluginMeta } from '../shared/pluginMeta';
import { decisionFinishCard } from './tool-cards/decisionFinish';

export const rendererPlugin: RendererPluginContribution = {
  meta: decisionPluginMeta,
  stylesheets: [],
  toolCards: { decision_finish: decisionFinishCard },
};
