import path from 'node:path';
import { normalizePath, type ModuleNode, type Plugin } from 'vite';

/** App拥有页面级port；在旧页面中再次执行setup会把新装配与旧单例混合。 */
export function createRendererBootstrapHmrPlugin(repositoryRoot: string): Plugin {
  const bootstrap = normalizePath(path.resolve(repositoryRoot, 'apps/renderer/app/App.vue'));
  return {
    name: 'linnya-renderer-bootstrap-hmr',
    apply: 'serve',
    enforce: 'post',
    handleHotUpdate(context) {
      const visited = new Set<ModuleNode>();
      const reachesBootstrap = (module: ModuleNode): boolean => {
        if (visited.has(module) || module.type === 'css') return false;
        visited.add(module);
        if (module.file === bootstrap) return true;
        // Vue子组件及显式依赖接纳会结束传播，不为普通组件修改重载整页。
        if (module.isSelfAccepting) return false;
        return [...module.importers].some(importer => !importer.acceptedHmrDeps.has(module) && reachesBootstrap(importer));
      };
      if (!context.modules.some(reachesBootstrap)) return;
      context.server.ws.send({ type: 'full-reload', path: '*' });
      return [];
    },
  };
}
