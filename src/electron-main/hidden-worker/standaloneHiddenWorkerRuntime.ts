import {
  createBackendHiddenWorkerRuntime,
} from '../../app-hosts/linnya/desktop-capabilities/orchestration/createBackendHiddenWorkerRuntime.js';
import { electronDesktopHiddenWorkerHost } from './hiddenWorkerRuntime.js';

// 独立 CLI 的构建根只能引入 hidden-worker 能力本身。不要改回 desktop-capabilities
// barrel；barrel 会把 App Server 的 renderer RPC 与全部内置插件注册表卷入 CLI 制品。
const runtime = createBackendHiddenWorkerRuntime(electronDesktopHiddenWorkerHost);

/** Standalone Electron CLI 的显式 composition；不能成为 Plugin SDK 的隐式 fallback。 */
export const registerHiddenWorker = runtime.registerHiddenWorker;
export const unregisterHiddenWorker = runtime.unregisterHiddenWorker;
export const hasHiddenWorker = runtime.hasHiddenWorker;
export const listHiddenWorkerIds = runtime.listHiddenWorkerIds;
export const ensureHiddenWorkerReady = runtime.ensureHiddenWorkerReady;
export const touchHiddenWorker = runtime.touchHiddenWorker;
export const invokeHiddenWorker = runtime.invokeHiddenWorker;
