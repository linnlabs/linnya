import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');

  return {
    // 这个测试只验证插件资源的注册与卸载。提供真实事件语义，避免把隐藏窗口生命周期混进本测试。
    ipcMain: new EventEmitter(),
  };
});

import { getDefaultSandboxService } from 'src/features/sandbox/sandboxCompositionRoot';
import {
  getDefaultTextMeasurementRuntimeStateForTests,
  resetDefaultTextMeasurementRuntime,
} from 'src/features/text-measurement/orchestration/configureDefaultTextMeasurementRuntime';
import {
  getDefaultSystemFontResolutionRuntimeStateForTests,
  resetDefaultSystemFontResolution,
} from 'src/features/font-resolution/orchestration/configureDefaultSystemFontResolution';
import { defaultTextMeasureService } from 'src/features/text-measurement';
import { installRuntimePathRoots } from 'src/shared/runtime-paths';
import {
  clearBackendHiddenWorkerRuntimePortForTesting,
  clearBackendTextMeasurementRuntimeDependenciesForTesting,
  installBackendHiddenWorkerRuntimePort,
  installBackendTextMeasurementRuntimeDependencies,
  type BackendHiddenWorkerRuntimePort,
  type BackendTextMeasurementRuntimeDependencies,
} from 'src/app-hosts/linnya/desktop-capabilities';
import {
  buildPluginSkillSourceRootsForRuntime,
  syncRegisteredBackendPluginRuntimeResources,
} from 'src/app-hosts/linnya/plugin-registry/builtin';
import { platformBackendPlugin } from 'src/app-hosts/linnya/plugin-registry/builtin/platform.backend';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { slidesBackendPlugin } from '../index';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

describe('Slides runtime resources', () => {
  beforeEach(async () => {
    installRuntimePathRoots({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/data/linnya/AIService',
      workspaceRoot: '/documents/Linnya',
      workspaceRootIsCustom: false,
    });
    installBackendHiddenWorkerRuntimePort(createTestHiddenWorkerRuntime());
    installBackendTextMeasurementRuntimeDependencies(createTestTextMeasurementDependencies());
    clearPluginRuntimeStateForTests();
    resetDefaultTextMeasurementRuntime();
    resetDefaultSystemFontResolution();
    await syncRegisteredBackendPluginRuntimeResources(new Set());
    if (!backendPluginRegistry.has(slidesBackendPlugin.meta.id)) {
      // 具体插件只在插件 owner / 发行组合层装配；Core 的 builtin 注册只负责 platform。
      const { pluginCli: _pluginCli, ...runtimeContribution } = slidesBackendPlugin;
      backendPluginRegistry.register(runtimeContribution);
    }
  });

  afterEach(async () => {
    clearPluginRuntimeStateForTests();
    resetDefaultTextMeasurementRuntime();
    resetDefaultSystemFontResolution();
    await syncRegisteredBackendPluginRuntimeResources(new Set());
    clearBackendHiddenWorkerRuntimePortForTesting();
    clearBackendTextMeasurementRuntimeDependenciesForTesting();
  });

  it('Slides enabled 状态只控制 sandbox profile，通用文本测量随 platform 生命周期挂载', async () => {
    const sandboxService = getDefaultSandboxService();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'slides'],
      enabledPluginIds: ['platform'],
    });
    await syncRegisteredBackendPluginRuntimeResources();

    expect(sandboxService.hasProfile('ppt_compose')).toBe(false);
    expect(getDefaultTextMeasurementRuntimeStateForTests()).not.toBeNull();
    expect(getDefaultSystemFontResolutionRuntimeStateForTests()).toBe(
      '/data/linnya/AIService/font-resolution/font-catalog.json',
    );

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'slides'],
      enabledPluginIds: ['platform', 'slides'],
    });
    await syncRegisteredBackendPluginRuntimeResources();

    expect(sandboxService.hasProfile('ppt_compose')).toBe(true);
    expect(getDefaultTextMeasurementRuntimeStateForTests()).not.toBeNull();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'slides'],
      enabledPluginIds: ['platform'],
    });
    await syncRegisteredBackendPluginRuntimeResources();

    expect(sandboxService.hasProfile('ppt_compose')).toBe(false);
    expect(getDefaultTextMeasurementRuntimeStateForTests()).not.toBeNull();
  });

  it('通用文本测量 runtime effect 只由 platform contribution 声明，Slides coordinator 由 Slides 生命周期挂载', () => {
    expect(slidesBackendPlugin).not.toBeNull();
    const platformRuntimeEffectIds = platformBackendPlugin.runtimeEffects?.map((effect) => effect.id) ?? [];
    const slidesRuntimeEffectIds = slidesBackendPlugin?.runtimeEffects?.map((effect) => effect.id) ?? [];

    expect(platformRuntimeEffectIds).toContain('text-measurement');
    expect(platformRuntimeEffectIds).toContain('font-resolution');
    expect(slidesRuntimeEffectIds).not.toContain('text-measurement');
    expect(slidesRuntimeEffectIds).not.toContain('font-resolution');
    expect(slidesRuntimeEffectIds).toContain('slides-ppt-coordinator');
  });

  it('platform disabled 时卸载通用文本测量配置', async () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'slides'],
      enabledPluginIds: ['platform'],
    });
    await syncRegisteredBackendPluginRuntimeResources();

    expect(getDefaultTextMeasurementRuntimeStateForTests()).not.toBeNull();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'slides'],
      enabledPluginIds: [],
    });
    await syncRegisteredBackendPluginRuntimeResources();

    expect(getDefaultTextMeasurementRuntimeStateForTests()).toBeNull();
    expect(getDefaultSystemFontResolutionRuntimeStateForTests()).toBeNull();
    expect(defaultTextMeasureService.getPrimaryAdapter().kind).not.toBe('main-pretext-cached');
  });

  it('只为 enabled 磁盘插件暴露 resources/skills 来源根目录', () => {
    const roots = buildPluginSkillSourceRootsForRuntime({
      enabledIds: new Set(['slides']),
      pluginDirsById: new Map([
        ['slides', '/plugins/slides/1.0.0'],
        ['mindmap', '/plugins/mindmap/1.0.0'],
      ]),
    });

    expect(roots).toEqual([{
      pluginId: 'slides',
      root: path.join('/plugins/slides/1.0.0', 'resources', 'skills'),
    }]);
  });

  it('合并 enabled contribution 与磁盘插件的 Skill 资源根目录', () => {
    const roots = buildPluginSkillSourceRootsForRuntime({
      enabledIds: new Set(['slides']),
      contributionRoots: [
        { pluginId: 'slides', root: '/repo/packages/plugins/slides/resources/skills' },
        { pluginId: 'mindmap', root: '/repo/packages/plugins/mindmap/resources/skills' },
      ],
      pluginDirsById: new Map([
        ['slides', '/plugins/slides/1.0.0'],
        ['mindmap', '/plugins/mindmap/1.0.0'],
      ]),
    });

    expect(roots).toEqual([
      {
        pluginId: 'slides',
        root: path.join('/plugins/slides/1.0.0', 'resources', 'skills'),
      },
      {
        pluginId: 'slides',
        root: '/repo/packages/plugins/slides/resources/skills',
      },
    ]);
  });
});

function createTestHiddenWorkerRuntime(): BackendHiddenWorkerRuntimePort {
  const workerIds = new Set<string>();
  const port: BackendHiddenWorkerRuntimePort = {
    registerHiddenWorker: async (definition) => {
      workerIds.add(definition.id);
    },
    unregisterHiddenWorker: async (workerId) => workerIds.delete(workerId),
    hasHiddenWorker: (workerId) => workerIds.has(workerId),
    listHiddenWorkerIds: () => [...workerIds],
    ensureHiddenWorkerReady: async () => undefined,
    touchHiddenWorker: () => undefined,
    invokeHiddenWorker: async () => {
      throw new Error('本测试不执行 hidden worker 请求');
    },
  };
  return Object.freeze(port);
}

function createTestTextMeasurementDependencies(): BackendTextMeasurementRuntimeDependencies {
  const worker: BackendTextMeasurementRuntimeDependencies['worker'] = {
    availability: { available: false, reason: '插件资源测试不启动 BrowserWindow worker' },
    measureBatch: async () => ({ requestId: 'unused', protocolVersion: 1, results: [] }),
    measureClusterAdvancesBatch: async () => ({
      requestId: 'unused',
      protocolVersion: 1,
      results: [],
    }),
    touch: () => undefined,
  };
  const dependencies: BackendTextMeasurementRuntimeDependencies = {
    worker: Object.freeze(worker),
    useBrowserPretext: true,
    useHarfBuzz: false,
  };
  return Object.freeze(dependencies);
}
