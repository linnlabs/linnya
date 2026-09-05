import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import * as appSchemas from '@app/schemas';
import * as appFileLocator from '@app/schemas/file-locator';
import * as agentRegistry from '../../../plugin-sdk/backend/agentRegistry';
import * as blockReferenceRuntime from '../../../plugin-sdk/backend/blockReferenceRuntime';
import * as citationSourceRuntime from '../../../plugin-sdk/backend/citationSourceRuntime';
import * as documentTypeBackendHook from '../../../plugin-sdk/backend/documentTypeBackendHook';
import * as documentImageAsset from '../../../plugin-sdk/backend/documentImageAsset';
import * as documentHistory from '../../../plugin-sdk/backend/documentHistory';
import * as documentAssetOwnership from '../../../plugin-sdk/backend/documentAssetOwnership';
import * as documentSvgAsset from '../../../plugin-sdk/backend/documentSvgAsset';
import * as exportArtifact from '../../../plugin-sdk/backend/exportArtifact';
import * as fontResolution from '../../../plugin-sdk/backend/fontResolution';
import * as hiddenWorkerRuntime from '../../../plugin-sdk/backend/hiddenWorkerRuntime';
import * as imageInspection from '../../../plugin-sdk/backend/imageInspection';
import * as imageTranscoding from '../../../plugin-sdk/backend/imageTranscoding';
import * as pluginContribution from '../../../plugin-sdk/backend/pluginContribution';
import * as pluginCredentialRuntime from '../../../plugin-sdk/backend/pluginCredentialRuntime';
import * as pluginIpcRuntime from '../../../plugin-sdk/backend/pluginIpcRuntime';
import * as pluginMigration from '../../../plugin-sdk/backend/pluginMigration';
import * as pluginRendererPush from '../../../plugin-sdk/backend/pluginRendererPush';
import * as pluginRuntime from '../../../plugin-sdk/backend/pluginRuntime';
import * as pdfDocumentRuntime from '../../../plugin-sdk/backend/pdfDocumentRuntime';
import * as sandboxRuntime from '../../../plugin-sdk/backend/sandboxRuntime';
import * as textMeasurement from '../../../plugin-sdk/backend/textMeasurement';
import * as textUnitRuntime from '../../../plugin-sdk/backend/textUnitRuntime';
import * as toolRuntime from '../../../plugin-sdk/backend/toolRuntime';
import * as workspaceRuntime from '../../../plugin-sdk/backend/workspaceRuntime';
import * as workspaceDatabasePath from '../../../plugin-sdk/backend/workspaceDatabasePath';

type CommonJsLoad = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean
) => unknown;

const backendHostModules = new Map<string, unknown>([
  ['@app/schemas', appSchemas],
  ['@app/schemas/file-locator', appFileLocator],
  ['@plugin/backend/agentRegistry', agentRegistry],
  ['@plugin/backend/blockReferenceRuntime', blockReferenceRuntime],
  ['@plugin/backend/citationSourceRuntime', citationSourceRuntime],
  ['@plugin/backend/documentTypeBackendHook', documentTypeBackendHook],
  ['@plugin/backend/documentImageAsset', documentImageAsset],
  ['@plugin/backend/documentHistory', documentHistory],
  ['@plugin/backend/documentAssetOwnership', documentAssetOwnership],
  ['@plugin/backend/documentSvgAsset', documentSvgAsset],
  ['@plugin/backend/exportArtifact', exportArtifact],
  ['@plugin/backend/fontResolution', fontResolution],
  ['@plugin/backend/hiddenWorkerRuntime', hiddenWorkerRuntime],
  ['@plugin/backend/imageInspection', imageInspection],
  ['@plugin/backend/imageTranscoding', imageTranscoding],
  ['@plugin/backend/pluginContribution', pluginContribution],
  ['@plugin/backend/pluginCredentialRuntime', pluginCredentialRuntime],
  ['@plugin/backend/pluginIpcRuntime', pluginIpcRuntime],
  ['@plugin/backend/pluginMigration', pluginMigration],
  ['@plugin/backend/pluginRendererPush', pluginRendererPush],
  ['@plugin/backend/pluginRuntime', pluginRuntime],
  ['@plugin/backend/pdfDocumentRuntime', pdfDocumentRuntime],
  ['@plugin/backend/sandboxRuntime', sandboxRuntime],
  ['@plugin/backend/textMeasurement', textMeasurement],
  ['@plugin/backend/textUnitRuntime', textUnitRuntime],
  ['@plugin/backend/toolRuntime', toolRuntime],
  ['@plugin/backend/workspaceRuntime', workspaceRuntime],
  ['@plugin/backend/workspaceDatabasePath', workspaceDatabasePath],
]);

function isCommonJsLoad(value: unknown): value is CommonJsLoad {
  return typeof value === 'function';
}

function readRawCommonJsLoad(): CommonJsLoad {
  const load = Reflect.get(Module, '_load');
  if (!isCommonJsLoad(load)) {
    throw new Error('[plugin-loader] Node Module._load is not available.');
  }

  return load;
}

function callCommonJsLoad(
  load: CommonJsLoad,
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean
): unknown {
  return Reflect.apply(load, Module, [request, parent, isMain]);
}

function normalizeExistingPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function isPluginOwnedParent(parent: NodeModule | null | undefined, pluginDir: string): boolean {
  if (!parent?.filename) {
    return false;
  }

  return isInsideDirectory(normalizeExistingPath(parent.filename), pluginDir);
}

export function withBackendPluginHostModuleResolver<T>(
  pluginDir: string,
  loadContribution: () => T
): T {
  const normalizedPluginDir = normalizeExistingPath(pluginDir);
  const originalLoad = readRawCommonJsLoad();
  // Node CJS 没有针对 createRequire 的裸 specifier alias API；插件 artifact 又会保留
  // @plugin/backend/* external。这里必须短暂接管解析，但只允许插件目录内的父模块消费，
  // 并在本次 backend entry 加载结束后恢复，避免旧实现那种进程级常驻副作用。
  const scopedLoad: CommonJsLoad = (request, parent, isMain) => {
    if (isPluginOwnedParent(parent, normalizedPluginDir) && backendHostModules.has(request)) {
      return backendHostModules.get(request);
    }

    return callCommonJsLoad(originalLoad, request, parent, isMain);
  };

  Reflect.set(Module, '_load', scopedLoad);
  try {
    return loadContribution();
  } finally {
    Reflect.set(Module, '_load', originalLoad);
  }
}

export function resolveBackendPluginHostModuleForTest(specifier: string): unknown {
  return backendHostModules.get(specifier);
}

export function listBackendPluginHostModuleSpecifiersForTest(): readonly string[] {
  return [...backendHostModules.keys()].sort();
}
