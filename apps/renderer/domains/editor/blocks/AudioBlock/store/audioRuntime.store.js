/**
 * @file audioRuntime.store.js
 * @description AudioBlock 运行时状态管理 Store
 *
 * 职责：
 * - 管理录音/播放的运行时状态
 * - 处理媒体设备权限与检测
 * - 管理音频文件加载与 blob URL
 * - 不关心内容持久化
 */

import { defineStore } from 'pinia';
import { createAudioBlockMessage } from '../functions/audioBlockPresentation';

/**
 * 运行时状态结构
 */
function createRuntimeState() {
  return {
    // 录音状态
    isRecording: false,
    isPaused: false,
    recordingTime: 0,

    // 播放状态
    currentPlayTime: 0,
    seekToTimeRequest: null,

    // UI 状态
    statusMessage: createAudioBlockMessage('editor.audioBlock.status.checkingDevice'),
    canRecord: false,
    showPlayer: false,
    processingState: 'idle',
    errorMessage: null,
    transcriptionState: 'idle',

    // 设备状态
    microphoneDevice: null,
    deviceCheckCompleted: false,
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],

    // 文件状态
    src: null,
    isTempSrc: false,
    audioFileObjectUrl: null,
    audioFilePath: null,
    duration: 0,
    mimeType: null,
    isFinalized: false,
    audioBlob: null,
    filename: null,
    saveStatus: null,
    audioLoadFailed: false,
    audioMissingReason: null,

    // 内容面板 UI 状态
    activeTab: 'notes',
    isPanelVisible: false,
  };
}

export const useAudioRuntimeStore = defineStore('audioRuntime', {
  state: () => ({
    /** @type {Record<string, ReturnType<typeof createRuntimeState>>} */
    runtimes: {},

    /** 当前正在录制的块ID列表（全局状态） */
    globalRecordingBlocks: [],

    /**
     * 录音控制器注册表（用于“切换文件/保存前”统一终止录音）
     * 说明：AudioRecordingService 实例存在于 NodeView 中，但我们需要在保存链路里可访问。
     * 这里通过“注册控制器”的方式把能力暴露到 store，而不是把 UI 逻辑塞进 file-manager。
     *
     * @type {Record<string, { terminateForSave: () => Promise<boolean> }>}
     */
    recordingControllers: {},
  }),

  getters: {
    /**
     * 获取指定块的运行时状态
     */
    getRuntime: state => blockId => {
      if (!state.runtimes[blockId]) {
        state.runtimes[blockId] = createRuntimeState();
      }
      return state.runtimes[blockId];
    },

    /**
     * 检查是否有任何块正在录制
     */
    isAnyRecording: state => {
      return state.globalRecordingBlocks.length > 0;
    },
  },

  actions: {
    removeRuntime(blockId) {
      const index = this.globalRecordingBlocks.indexOf(blockId);
      if (index > -1) this.globalRecordingBlocks.splice(index, 1);
      delete this.runtimes[blockId];
    },
    /**
     * 注册录音控制器（由 AudioBlockView 在挂载时注册，卸载时注销）
     * @param {string} blockId
     * @param {{ terminateForSave: () => Promise<boolean> }} controller
     */
    registerRecordingController(blockId, controller) {
      if (!blockId || !controller || typeof controller.terminateForSave !== 'function') {
        console.warn('[AudioRuntimeStore] registerRecordingController: 参数无效', {
          blockId,
          controller,
        });
        return;
      }
      this.recordingControllers[blockId] = controller;
    },

    /**
     * 注销录音控制器
     * @param {string} blockId
     */
    unregisterRecordingController(blockId) {
      if (this.recordingControllers[blockId]) {
        delete this.recordingControllers[blockId];
      }
    },

    /**
     * 初始化块的运行时状态
     */
    initRuntime(blockId, initialState = {}) {
      const existing = this.runtimes[blockId];

      if (!existing) {
        this.runtimes[blockId] = createRuntimeState();
      }

      // 合并初始状态
      if (Object.keys(initialState).length > 0) {
        this.updateRuntime(blockId, initialState);
      }
    },

    /**
     * 更新块的运行时状态
     */
    updateRuntime(blockId, updates) {
      const runtime = this.getRuntime(blockId);
      Object.assign(runtime, updates);
    },

    /**
     * 更新录音时间
     */
    updateRecordingTime(blockId, time) {
      this.updateRuntime(blockId, { recordingTime: time });
    },

    /**
     * 更新播放时间
     */
    updateCurrentPlayTime(blockId, time) {
      this.updateRuntime(blockId, { currentPlayTime: time });
    },

    /**
     * 请求跳转到指定时间
     */
    seekToTime(blockId, time) {
      this.updateRuntime(blockId, {
        seekToTimeRequest: { time, timestamp: Date.now() },
      });
    },

    /**
     * 清除跳转请求
     */
    clearSeekRequest(blockId) {
      this.updateRuntime(blockId, { seekToTimeRequest: null });
    },

    /**
     * 开始录音（更新全局录制列表）
     */
    startRecording(blockId) {
      if (!this.globalRecordingBlocks.includes(blockId)) {
        this.globalRecordingBlocks.push(blockId);
      }
      this.updateRuntime(blockId, { isRecording: true });
    },

    /**
     * 停止录音（从全局录制列表移除）
     */
    stopRecording(blockId) {
      const index = this.globalRecordingBlocks.indexOf(blockId);
      if (index > -1) {
        this.globalRecordingBlocks.splice(index, 1);
      }
      this.updateRuntime(blockId, { isRecording: false, isPaused: false });
    },

    /**
     * 清理块状态（组件卸载时调用）
     */
  },
});
