import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  GALLERY_SCHEMES_VIRTUAL_MODULE_ID,
  type GalleryScheme,
} from '../definitions/galleryScheme.ts';
import { parseGalleryScheme } from '../functions/parseGalleryScheme.ts';

const RESOLVED_VIRTUAL_MODULE_ID = `\0${GALLERY_SCHEMES_VIRTUAL_MODULE_ID}`;

/** 读取方案目录里的全部 `.css`；目录由使用者显式给出，读不到就报错而不是静默变成“没有方案”。 */
export async function readGallerySchemes(directory: string | null): Promise<GalleryScheme[]> {
  if (directory === null) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const fileNames = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.css'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(
    fileNames.map(async fileName =>
      parseGalleryScheme(fileName, await readFile(path.join(directory, fileName), 'utf8'))
    )
  );
}

/**
 * 把方案目录投影成虚拟模块 `virtual:linnya-ui-gallery-schemes`。
 * 方案文件增删改时整页刷新，对比视图里的每个 iframe 也随之重新加载。
 */
export function createGallerySchemesPlugin(directory: string | null): Plugin {
  return {
    name: 'linnya-ui-gallery-schemes',
    resolveId(id) {
      return id === GALLERY_SCHEMES_VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;
      const schemes = await readGallerySchemes(directory);
      return `export const gallerySchemes = ${JSON.stringify(schemes)};`;
    },
    configureServer(server) {
      if (directory === null) return;
      server.watcher.add(directory);
      const reloadWhenSchemeChanges = (file: string) => {
        if (path.dirname(file) !== directory || !file.endsWith('.css')) return;
        const schemesModule = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (schemesModule) server.moduleGraph.invalidateModule(schemesModule);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reloadWhenSchemeChanges);
      server.watcher.on('change', reloadWhenSchemeChanges);
      server.watcher.on('unlink', reloadWhenSchemeChanges);
    },
  };
}
