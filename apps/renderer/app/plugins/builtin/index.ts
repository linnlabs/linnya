import { registerRendererPlugin } from '../registry';
import { platformRendererPlugin } from './platform.renderer';
import { installBuiltinRendererPluginPorts } from './installBuiltinRendererPluginPorts';
import { installBuiltinConversationInputContributions } from './installBuiltinConversationInputContributions';

let registered = false;

export function ensureBuiltinRendererPluginsRegistered(): void {
  if (registered) return;
  installBuiltinRendererPluginPorts();
  installBuiltinConversationInputContributions();
  registerRendererPlugin(platformRendererPlugin);
  registered = true;
}

if (import.meta.hot) {
  // 这些port与注册表属于整个页面生命周期；只替换模块会重置registered却留下旧port。
  // 开发更新明确重建页面，不复用旧adapter，也不削弱重复注册保护。
  import.meta.hot.accept(() => { window.location.reload(); });
}
