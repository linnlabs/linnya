import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const HOST_RENDERER_ROOT = path.join(root, 'apps/renderer');
const CONCRETE_RENDERER_IMPORTS = [
  `@plugin/slides/${'renderer'}`,
  `@plugin/mindmap/${'renderer'}`,
] as const;
const DELETED_BUILTIN_RENDERER_FILES = [
  ['slides', 'renderer', 'ts'],
  ['mindmap', 'renderer', 'ts'],
  ['mindmap', 'renderer', 'absent', 'ts'],
] as const;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function listSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|vue)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('renderer plugin boundary', () => {
  it('keeps renderer plugin entries free of top-level port registration side effects', () => {
    const slidesSource = readRepoFile('packages/plugins/slides/src/renderer/index.ts');
    const mindmapSource = readRepoFile('packages/plugins/mindmap/src/renderer/index.ts');

    expect(slidesSource).toContain('activate: registerSlidesRendererPorts');
    expect(slidesSource).toContain('deactivate: unregisterSlidesRendererPorts');
    expect(slidesSource).not.toMatch(/^registerSlidesRendererPorts\(\);$/m);

    expect(mindmapSource).toContain('activate: registerMindmapRendererPorts');
    expect(mindmapSource).toContain('deactivate: unregisterMindmapRendererPorts');
    expect(mindmapSource).not.toMatch(/^registerMindmapRendererPorts\(\);$/m);
  });

  it('keeps presentation document type owned by slides renderer contribution', () => {
    const platformSource = readRepoFile('apps/renderer/app/plugins/builtin/platform.renderer.ts');
    const pluginRendererSource = readRepoFile('packages/plugins/slides/src/renderer/index.ts');
    const builtinIndexSource = readRepoFile('apps/renderer/app/plugins/builtin/index.ts');

    expect(platformSource).not.toContain("nodeType: 'presentation'");
    expect(platformSource).not.toContain('presentationToolConfigs');
    expect(platformSource).not.toContain('SlidesPage');

    expect(pluginRendererSource).toContain('pluginId: SLIDES_PLUGIN_ID');
    expect(pluginRendererSource).toContain('nodeType: SLIDES_DOCUMENT_TYPE');
    expect(pluginRendererSource).toContain("createBackend: 'plugin-document'");
    expect(pluginRendererSource).toContain("createHandlerId: 'slides.document-create'");
    expect(pluginRendererSource).toContain('presentationToolConfigs');
    expect(pluginRendererSource).toContain('SlidesPage');
    expect(pluginRendererSource).toContain('SlidesIcon');
    expect(pluginRendererSource).toContain('./icon/SlidesIcon.vue');
    expect(pluginRendererSource).not.toContain('@/shared/components/icons/SlidesIcon.vue');
    expect(pluginRendererSource).toContain('SLIDES_PLUGIN_META');
    expect(pluginRendererSource).toContain("@plugin/slides/shared");
    expect(pluginRendererSource).toContain('documentActionMenus');
    expect(pluginRendererSource).toContain('documentRuntimeLoaders');
    expect(pluginRendererSource).toContain('registerSlidesRendererPorts');

    expect(builtinIndexSource).not.toContain('slidesRendererPlugin');
    expect(builtinIndexSource).not.toContain('mindmapRendererPlugin');
    expect(fs.existsSync(path.join(root, 'packages/plugins/slides/src/renderer/icon/SlidesIcon.vue'))).toBe(true);
  });

  it('keeps official document type icons owned by their plugin packages', () => {
    const mindmapSource = readRepoFile('packages/plugins/mindmap/src/renderer/index.ts');

    expect(mindmapSource).toContain('MindMapIcon');
    expect(mindmapSource).toContain('./icon/MindMapIcon.vue');
    expect(mindmapSource).not.toContain('@/shared/components/icons/MindMapIcon.vue');
    expect(fs.existsSync(path.join(root, 'src/plugin-sdk/renderer/toolUi.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/plugins/mindmap/src/renderer/icon/MindMapIcon.vue'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'apps/renderer/shared/components/icons/MindMapIcon.vue'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'apps/renderer/shared/components/icons/SlidesIcon.vue'))).toBe(false);
  });

  it('keeps official plugin manifests free of static icon assets', () => {
    const slidesManifestSource = readRepoFile('packages/plugins/slides/plugin.json');
    const mindmapManifestSource = readRepoFile('packages/plugins/mindmap/plugin.json');

    expect(JSON.parse(slidesManifestSource)).not.toHaveProperty('icon');
    expect(JSON.parse(mindmapManifestSource)).not.toHaveProperty('icon');
    expect(fs.existsSync(path.join(root, 'packages/plugins/slides/assets/icon.svg'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/plugins/mindmap/assets/icon.svg'))).toBe(false);
  });

  it('keeps generic conversation UI off direct slides refresh imports', () => {
    const source = readRepoFile('apps/renderer/domains/conversation/ui/message/ToolCallsMessage.vue');

    expect(source).toContain('@plugin/renderer/toolRefreshPort');
    expect(source).not.toContain('@/domains/slides/features/toolRefresh');
    expect(source).not.toContain('usePresentationToolRefreshTrigger');
  });

  it('keeps app header off direct slides domain imports', () => {
    const source = readRepoFile('apps/renderer/app/layout/AppHeader/HeaderRightSection.vue');

    expect(source).toContain('useDocumentActionMenu');
    expect(source).not.toContain('@/domains/slides');
    expect(source).not.toContain('downloadPptx');
  });

  it('keeps app workspace navigation off direct slides store imports', () => {
    const source = readRepoFile('apps/renderer/app/layout/orchestration/workspaceNavigation.ts');

    expect(source).toContain('getDocumentRuntimeLoaderByActiveType');
    expect(source).not.toContain('@/domains/slides');
    expect(source).not.toContain('useSlidesStore');
    expect(source).not.toContain('openSlidesDeck');
  });

  it('keeps workspace navigation SDK free of slides-specific methods', () => {
    const portSource = readRepoFile('apps/renderer/shared/ports/workspaceNavigationPort.ts');
    const actionCardSource = readRepoFile(
      'packages/plugins/slides/src/renderer/tool-cards/presentation/PresentationActionCard.vue',
    );

    expect(portSource).toContain('openDocumentTarget');
    expect(portSource).not.toContain('openSlidesDeck');
    expect(actionCardSource).toContain('openDocumentTarget');
    expect(actionCardSource).not.toContain('openSlidesDeck');
  });

  it('keeps host renderer code from importing concrete plugin renderer implementations', () => {
    const offenders = listSourceFiles(HOST_RENDERER_ROOT)
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, 'utf-8');
        return CONCRETE_RENDERER_IMPORTS.some((importPath) => source.includes(importPath));
      })
      .map((filePath) => path.relative(root, filePath));

    expect(offenders).toEqual([]);
    for (const fileParts of DELETED_BUILTIN_RENDERER_FILES) {
      expect(fs.existsSync(path.join(
        root,
        'apps/renderer/app/plugins/builtin',
        fileParts.join('.'),
      ))).toBe(false);
    }
  });
});
