/**
 * @file src/electron-main/services/modelCatalog/cloudModelsBroadcaster.ts
 *
 * @brief 将 Model Catalog 的“云端模型加载成功”事件桥接到渲染进程
 *
 * @description
 * 功能：
 * - 订阅 `modelCatalog.onCloudModelsLoaded`，每次成功后向主窗口发送 `models-updated` IPC 事件；
 * - 渲染进程的 `modelsStore` 收到该事件后会自动重新拉取模型列表，从而刷新 UI。
 *
 * 设计要点：
 * - 桥接层独立成文件，让 model-catalog 保持零 Electron 依赖；
 * - 通过懒求值的 `getMainWindow()` 取窗口引用，避免在窗口未创建时强耦合；
 * - 内置幂等：重复 install 只生效一次，第二次直接返回已注册的取消订阅函数；
 * - 事件 payload 仅传计数 / 时间戳等元信息——前端要的是 schema-stable 的"刷新信号"，
 *   不应直接消费事件里的模型快照（统一从 HTTP API 重新拉取，避免双数据源不一致）。
 */

import type { BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import { modelCatalog, type CloudModelsLoadedEvent, type ModelConfig } from 'src/domains/model-catalog';

const logger = new Logger('CloudModelsBroadcaster');

/** IPC 通道名（必须同时出现在 preload `valid-channels` 白名单中） */
export const MODELS_UPDATED_CHANNEL = 'models-updated';

/** 通过 IPC 推送给渲染进程的最小载荷（前端拿到信号后自行重新拉取列表） */
export interface ModelsUpdatedPayload {
  /** 触发重新拉取的来源（便于前端调试 / 日志区分） */
  source: 'cloud-models-loaded';
  /** 当前云端模型数量，仅作日志参考，前端不应当作权威数据 */
  cloudModelsCount: number;
  /** 主进程侧的事件时间戳 */
  emittedAt: number;
  /** 主进程内递增版本，仅用于排查重复/漏发刷新信号 */
  revision: number;
}

interface ModelsUpdatedSendTarget {
  send(channel: string, payload: ModelsUpdatedPayload): void;
  isDestroyed?: () => boolean;
}

type GetMainWindow = () => BrowserWindow | null;

let installed = false;
let unsubscribe: (() => void) | null = null;
let getMainWindowRef: GetMainWindow | null = null;
let rendererReadyWebContents: ModelsUpdatedSendTarget | null = null;
let latestCloudModelsEvent: CloudModelsLoadedEvent | null = null;
let pendingCloudModelsUpdate = false;
let rendererReadyReplayCompleted = false;
let revision = 0;

function getCloudModelsSnapshotFromRegistry(): CloudModelsLoadedEvent | null {
  if (!modelCatalog.hasLoadedCloudModels()) {
    return null;
  }

  const cloudModels = (modelCatalog.getModels() || []).filter(
    (model: ModelConfig) => model.billing_mode === 'cloud'
  );

  return {
    count: cloudModels.length,
    models: cloudModels,
  };
}

function isSendTargetUsable(target: ModelsUpdatedSendTarget | null): target is ModelsUpdatedSendTarget {
  return Boolean(target && (!target.isDestroyed || !target.isDestroyed()));
}

function getSendTarget(): ModelsUpdatedSendTarget | null {
  if (isSendTargetUsable(rendererReadyWebContents)) {
    return rendererReadyWebContents;
  }

  if (!getMainWindowRef) {
    return null;
  }

  const mainWindow = getMainWindowRef();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  return mainWindow.webContents;
}

function sendCloudModelsUpdate(event: CloudModelsLoadedEvent, context: string): boolean {
  const sendTarget = getSendTarget();
  if (!sendTarget) {
    pendingCloudModelsUpdate = true;
    logger.debug(
      `云端模型刷新信号暂存：renderer 发送目标与主窗口均不可用（${context}，云端模型数=${event.count}）。` +
      '渲染进程 ready 后会补发刷新信号。'
    );
    return false;
  }

  const payload: ModelsUpdatedPayload = {
    source: 'cloud-models-loaded',
    cloudModelsCount: event.count,
    emittedAt: Date.now(),
    revision: ++revision,
  };

  try {
    sendTarget.send(MODELS_UPDATED_CHANNEL, payload);
    pendingCloudModelsUpdate = false;
    logger.info(
      `已向渲染进程推送 ${MODELS_UPDATED_CHANNEL}（${context}，云端模型数=${event.count}，revision=${payload.revision}）`
    );
    return true;
  } catch (error) {
    pendingCloudModelsUpdate = true;
    logger.warn(`推送 ${MODELS_UPDATED_CHANNEL} 失败（${context}）:`, error);
    return false;
  }
}

/**
 * 安装云端模型加载成功 → 渲染进程 IPC 推送的桥接器。
 *
 * @param getMainWindow 获取主窗口实例的函数（通常传入 window-manager 的 getMainWindow）
 * @returns 取消订阅函数，幂等
 */
export function installCloudModelsBroadcaster(getMainWindow: GetMainWindow): () => void {
  if (installed && unsubscribe) {
    getMainWindowRef = getMainWindow;
    logger.debug('云端模型广播桥接器已安装，跳过重复安装');
    return unsubscribe;
  }

  getMainWindowRef = getMainWindow;

  unsubscribe = modelCatalog.onCloudModelsLoaded((event: CloudModelsLoadedEvent) => {
    latestCloudModelsEvent = event;
    rendererReadyReplayCompleted = false;
    sendCloudModelsUpdate(event, 'cloud models loaded');
  });

  installed = true;
  logger.info('云端模型广播桥接器已安装');

  return () => {
    if (!installed) {
      return;
    }
    unsubscribe?.();
    unsubscribe = null;
    installed = false;
    getMainWindowRef = null;
    rendererReadyWebContents = null;
    latestCloudModelsEvent = null;
    pendingCloudModelsUpdate = false;
    rendererReadyReplayCompleted = false;
    logger.info('云端模型广播桥接器已卸载');
  };
}

/**
 * 渲染进程模型 store/全局 IPC 监听器 ready 后调用。
 *
 * 中文说明：
 * - `models-updated` 是刷新信号，不是权威数据；真正数据仍由前端走 HTTP `fetchModels()` 获取；
 * - 这里负责补齐启动竞态：云端模型可能早于窗口、早于 renderer 订阅、甚至早于广播器安装完成；
 * - 因此 ready 后会基于最新事件或 registry 当前快照补发一次，确保前端不会永久停留在旧模型列表。
 */
export function notifyCloudModelsRendererReady(rendererWebContents?: ModelsUpdatedSendTarget): boolean {
  if (rendererWebContents) {
    rendererReadyWebContents = rendererWebContents;
  }

  if (rendererReadyReplayCompleted && !pendingCloudModelsUpdate) {
    return false;
  }

  const event = latestCloudModelsEvent || getCloudModelsSnapshotFromRegistry();
  if (!event) {
    logger.debug('renderer ready 时云端模型尚未加载成功，跳过模型刷新补发');
    return false;
  }

  latestCloudModelsEvent = event;
  const didSend = sendCloudModelsUpdate(event, 'renderer ready replay');
  if (didSend) {
    rendererReadyReplayCompleted = true;
  }

  return didSend;
}
