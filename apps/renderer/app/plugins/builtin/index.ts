import { registerRendererPlugin } from '../registry';
import { knowledgeRendererPlugin } from './knowledge.renderer';
import { platformRendererPlugin } from './platform.renderer';
import { installBuiltinRendererPluginPorts } from './installBuiltinRendererPluginPorts';
import { installBuiltinConversationInputContributions } from './installBuiltinConversationInputContributions';

let registered = false;

export function ensureBuiltinRendererPluginsRegistered(): void {
  if (registered) return;
  installBuiltinRendererPluginPorts();
  installBuiltinConversationInputContributions();
  registerRendererPlugin(platformRendererPlugin);
  registerRendererPlugin(knowledgeRendererPlugin, { applicationSurfaceSlot: 'knowledge-base' });
  registered = true;
}
