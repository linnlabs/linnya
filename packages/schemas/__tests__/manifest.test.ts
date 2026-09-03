import { describe, expect, it } from 'vitest';

import mindmapManifest from '../../plugins/mindmap/plugin.json';
import slidesManifest from '../../plugins/slides/plugin.json';
import { parsePluginManifest, pluginMetaFromManifest } from '../src/plugins/manifest';

describe('PluginManifestSchema', () => {
  it('parses the Mindmap builtin plugin manifest', () => {
    expect(parsePluginManifest(mindmapManifest)).toMatchObject({
      id: 'mindmap',
      version: '1.0.6',
      name: 'Mindmap',
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
        renderer: './dist/renderer/index.js',
      },
      dependsOn: ['platform'],
      compat: {
        minApp: '0.0.36',
        rendererUi: '^2.0.0',
      },
      ownedFileTypes: [{
        nodeType: 'mindmap',
        extension: '.mindmap',
        label: '思维导图',
      }],
      ownedTables: ['mindmap_versions', 'mindmap_evidence'],
      migrations: [
        {
          version: 1,
          description: 'baseline adoption',
        },
        {
          version: 2,
          description: 'workspace text snapshot backfill',
        },
      ],
    });
  });

  it('parses the Slides builtin plugin manifest scaffold', () => {
    const manifest = parsePluginManifest(slidesManifest);
    expect(manifest).toMatchObject({
      id: 'slides',
      name: 'Slides',
      developer: 'Linnya',
      entry: {
        backend: './dist/backend/index.cjs',
        renderer: './dist/renderer/index.js',
        command: './dist/cli/slides-cli.cjs',
      },
      dependsOn: ['platform'],
      ownedFileTypes: [{
        nodeType: 'presentation',
        extension: '.slides',
        label: '演示文稿',
      }],
      ownedTables: [
        'presentation_documents',
        'presentation_revisions',
        'presentation_drafts',
        'presentation_templates',
        'presentation_image_bindings',
        'presentation_svg_graphic_bindings',
      ],
      migrations: [
        {
          version: 1,
          description: 'Create and adopt Slides presentation tables',
        },
        {
          version: 2,
          description: 'Backfill workspace text snapshots from latest Slides versions',
        },
        {
          version: 3,
          description: 'Materialize current documents and source revision history',
        },
        {
          version: 4,
          description: 'Bind presentation image sources to owned assets',
        },
        {
          version: 5,
          description: 'Bind presentation SVG Graphic sources to owned assets',
        },
      ],
    });
    expect(manifest.releaseNotes?.[0]?.version).toBe(manifest.version);
  });

  it('rejects manifests missing required user-facing details', () => {
    expect(() =>
      parsePluginManifest({
        id: 'legacy-plugin',
        version: '0.1.0',
        name: 'Legacy Plugin',
        description: '旧格式插件',
        developer: 'Linnya',
        entry: {
          backend: './backend.js',
        },
      })
    ).toThrow();
  });

  it('parses a complete official plugin manifest', () => {
    expect(
      parsePluginManifest({
        id: 'complete-plugin',
        version: '0.1.0',
        name: 'Complete Plugin',
        description: '完整展示信息插件',
        developer: 'Linnya',
        details: ['完整介绍'],
        releaseNotes: [{ version: '0.1.0', title: '首版', description: '初始发布' }],
        skills: [{ name: 'Reasoning Canvas', description: '组织推理结构' }],
        agents: [{ name: 'Workflow Leader', description: '统筹任务' }],
        entry: {
          backend: './backend.js',
        },
        dependsOn: ['platform'],
      })
    ).toMatchObject({
      id: 'complete-plugin',
      ownedFileTypes: [],
      ownedTables: [],
      migrations: [],
      skills: [{ name: 'Reasoning Canvas', description: '组织推理结构' }],
      agents: [{ name: 'Workflow Leader', description: '统筹任务' }],
    });
  });

  it('derives host plugin meta from manifest and explicit host classification', () => {
    const manifest = parsePluginManifest({
      id: 'complete-plugin',
      version: '0.1.0',
      name: 'Complete Plugin',
      description: '完整展示信息插件',
      developer: 'Linnya',
      details: ['完整介绍'],
      entry: {
        backend: './backend.js',
      },
      dependsOn: ['platform'],
      compat: {
        minApp: '0.0.38',
      },
      ownedFileTypes: [{
        nodeType: 'complete',
        extension: '.complete',
        label: '完整文档',
      }],
    });

    expect(pluginMetaFromManifest(manifest, { builtin: true, required: false })).toEqual({
      id: 'complete-plugin',
      version: '0.1.0',
      name: 'Complete Plugin',
      description: '完整展示信息插件',
      developer: 'Linnya',
      builtin: true,
      required: false,
      dependsOn: ['platform'],
      compatMin: '0.0.38',
      ownedFileTypes: [{
        nodeType: 'complete',
        extension: '.complete',
        label: '完整文档',
      }],
    });
  });

  it('omits empty owned file types when deriving plugin meta', () => {
    const manifest = parsePluginManifest({
      id: 'no-files-plugin',
      version: '0.1.0',
      name: 'No Files Plugin',
      description: 'No files plugin',
      developer: 'Linnya',
      details: ['No files plugin detail'],
      entry: {
        backend: './backend.js',
      },
    });

    expect(pluginMetaFromManifest(manifest, { builtin: true })).not.toHaveProperty('ownedFileTypes');
  });

  it('accepts a distinct runtime entry for the packaged artifact', () => {
    expect(
      parsePluginManifest({
        id: 'artifact-ready-plugin',
        version: '0.1.0',
        name: 'Artifact Ready Plugin',
        description: 'Artifact ready plugin',
        developer: 'Linnya',
        details: ['Artifact ready plugin detail'],
        entry: {
          backend: './src/backend/index.ts',
        },
        artifact: {
          entry: {
            backend: './dist/backend.js',
            renderer: './dist/renderer.js',
          },
        },
      })
    ).toMatchObject({
      id: 'artifact-ready-plugin',
      artifact: {
        entry: {
          backend: './dist/backend.js',
          renderer: './dist/renderer.js',
        },
      },
    });
  });

  it('rejects artifact integrity declared by the self-described plugin manifest', () => {
    expect(() =>
      parsePluginManifest({
        id: 'misleading-integrity-plugin',
        version: '0.1.0',
        name: 'Misleading Integrity Plugin',
        description: 'Plugin with a self-described checksum',
        developer: 'Linnya',
        details: ['Checksums must come from trusted release metadata'],
        entry: {
          backend: './src/backend/index.ts',
        },
        artifact: {
          integrity: {
            sha256: 'placeholder',
          },
        },
      })
    ).toThrow();
  });

  it('rejects duplicate or descending migration versions', () => {
    expect(() =>
      parsePluginManifest({
        id: 'bad-plugin',
        version: '0.1.0',
        name: 'Bad Plugin',
        description: 'Bad plugin',
        developer: 'Linnya',
        details: ['Bad plugin detail'],
        entry: {
          backend: './backend.js',
        },
        migrations: [
          { version: 2, description: 'second' },
          { version: 2, description: 'duplicate' },
        ],
      })
    ).toThrow('plugin manifest migrations must be strictly increasing');
  });

  it('rejects manifests without an executable entrypoint', () => {
    expect(() =>
      parsePluginManifest({
        id: 'empty-entry',
        version: '0.1.0',
        name: 'Empty Entry',
        description: 'Empty entry',
        developer: 'Linnya',
        details: ['Empty entry detail'],
        entry: {},
      })
    ).toThrow('plugin manifest entry must declare at least one entrypoint');
  });

  it('要求 renderer 插件声明有效的 compat.rendererUi', () => {
    const baseManifest = {
      id: 'renderer-plugin',
      version: '1.0.0',
      name: 'Renderer Plugin',
      description: 'Renderer plugin',
      developer: 'Linnya',
      details: ['Renderer plugin detail'],
      entry: { renderer: './dist/renderer/index.js' },
    };

    expect(() => parsePluginManifest(baseManifest))
      .toThrow('renderer plugins must declare compat.rendererUi');
    expect(() => parsePluginManifest({
      ...baseManifest,
      compat: { rendererUi: 'not-a-range' },
    })).toThrow('compat.rendererUi must be a valid node-semver range');
    expect(parsePluginManifest({
      ...baseManifest,
      compat: { rendererUi: '^1.0.0' },
    }).compat?.rendererUi).toBe('^1.0.0');
  });

});
