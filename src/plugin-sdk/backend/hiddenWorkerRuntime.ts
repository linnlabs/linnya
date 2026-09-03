/**
 * @file hiddenWorkerRuntime.ts
 * @description 后端插件访问宿主隐藏 renderer worker 托管能力的窄门面。
 *
 * 中文说明：
 * - BrowserWindow 生命周期、超时、空闲回收、崩溃重启由宿主管；
 * - 插件只声明 worker bundle 路径、preload 路径和协议 codec；
 * - SDK 只调用 App composition 安装的窄端口，不能依赖 Electron 实现。
 */

import type {
  HiddenWorkerDefinition,
  HiddenWorkerRegistrationOptions,
} from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';
import { getBackendHiddenWorkerRuntimePort } from '../../app-hosts/linnya/desktop-capabilities';

export async function registerHiddenWorker(
  definition: HiddenWorkerDefinition,
  options?: HiddenWorkerRegistrationOptions,
): Promise<void> {
  await getBackendHiddenWorkerRuntimePort().registerHiddenWorker(definition, options);
}

export async function unregisterHiddenWorker(workerId: string): Promise<boolean> {
  return await getBackendHiddenWorkerRuntimePort().unregisterHiddenWorker(workerId);
}

export function hasHiddenWorker(workerId: string): boolean {
  return getBackendHiddenWorkerRuntimePort().hasHiddenWorker(workerId);
}

export function listHiddenWorkerIds(): readonly string[] {
  return getBackendHiddenWorkerRuntimePort().listHiddenWorkerIds();
}

export async function ensureHiddenWorkerReady(workerId: string): Promise<void> {
  await getBackendHiddenWorkerRuntimePort().ensureHiddenWorkerReady(workerId);
}

export function touchHiddenWorker(workerId: string): void {
  getBackendHiddenWorkerRuntimePort().touchHiddenWorker(workerId);
}

export async function invokeHiddenWorker(
  workerId: string,
  request: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<unknown> {
  return await getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(workerId, request, options);
}

export type {
  HiddenWorkerDefinition,
  HiddenWorkerRegistrationOptions,
} from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';

export type {
  HiddenWorkerRequestEnvelope,
  HiddenWorkerResponseEnvelope,
} from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';
