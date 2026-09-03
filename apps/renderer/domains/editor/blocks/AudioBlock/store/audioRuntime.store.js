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
import { ref } from 'vue';
import { useAudioDeviceStore } from './audioDevice';
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
    getRuntime: (state) => (blockId) => {
      if (!state.runtimes[blockId]) {
        state.runtimes[blockId] = createRuntimeState();
      }
      return state.runtimes[blockId];
    },

    /**
     * 检查是否有任何块正在录制
     */
    isAnyRecording: (state) => {
      return state.globalRecordingBlocks.length > 0;
    },
  },

  actions: {
    /**
     * 注册录音控制器（由 AudioBlockView 在挂载时注册，卸载时注销）
     * @param {string} blockId
     * @param {{ terminateForSave: () => Promise<boolean> }} controller
     */
    registerRecordingController(blockId, controller) {
      if (!blockId || !controller || typeof controller.terminateForSave !== 'function') {
        console.warn('[AudioRuntimeStore] registerRecordingController: 参数无效', { blockId, controller });
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
     * 保存前统一终止全部正在录音的块
     * 设计目标：让切换文件时“自动停止录音并完成保存尝试/失败态落盘”具备 await 能力。
     *
     * @returns {Promise<boolean>} true 表示全部终止完成（含真实落盘或可重试失败态）
     */
    async terminateAllRecordingsForSave() {
      const blockIds = Array.isArray(this.globalRecordingBlocks)
        ? this.globalRecordingBlocks.slice()
        : (Array.isArray(this.globalRecordingBlocks?.value) ? this.globalRecordingBlocks.value.slice() : []);

      if (blockIds.length === 0) {
        return true;
      }

      for (const blockId of blockIds) {
        const controller = this.recordingControllers[blockId];
        if (!controller || typeof controller.terminateForSave !== 'function') {
          console.warn('[AudioRuntimeStore] terminateAllRecordingsForSave: 未找到控制器，跳过', blockId);
          continue;
        }
        try {
          const ok = await controller.terminateForSave();
          if (!ok) {
            console.error('[AudioRuntimeStore] terminateAllRecordingsForSave: 终止录音失败', blockId);
            return false;
          }
        } catch (error) {
          console.error('[AudioRuntimeStore] terminateAllRecordingsForSave: 终止录音异常', blockId, error);
          return false;
        }
      }

      return true;
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
     * 检测麦克风设备（首次或强制刷新）
     */
    async checkMicrophoneForBlock(blockId, forceRefresh = false) {
      const runtime = this.getRuntime(blockId);
      const deviceStore = useAudioDeviceStore();

      // 如果已完成检测且不强制刷新，跳过
      if (runtime.deviceCheckCompleted && !forceRefresh) {
        console.log(`[AudioRuntimeStore] Device check already completed for ${blockId}, skipping`);
        return;
      }

      // 使用设备 store 获取设备信息
      const result = await deviceStore.getAvailableMicrophoneDevices(forceRefresh);

      if (result && result.success && result.devices?.length) {
        const device = result.currentDevice || result.devices[0];
        this.updateRuntime(blockId, {
          microphoneDevice: device,
          canRecord: true,
          statusMessage: device?.label
            ? createAudioBlockMessage('editor.audioBlock.status.usingMicrophone', { device: device.label })
            : createAudioBlockMessage('editor.audioBlock.status.usingDefaultMicrophone'),
          deviceCheckCompleted: true,
          processingState: 'ready',
        });
        return { success: true, device };
      }

      this.updateRuntime(blockId, {
        microphoneDevice: null,
        canRecord: false,
        statusMessage: result?.message || createAudioBlockMessage('editor.audioBlock.status.noMicrophone'),
        deviceCheckCompleted: true,
        processingState: 'error',
      });

      return { success: false, error: result?.error || 'device_not_found' };
    },

    /**
     * 请求麦克风权限
     */
    async requestMicrophonePermission() {
      const deviceStore = useAudioDeviceStore();
      return await deviceStore.requestMicrophonePermission();
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
     * 设置 blob URL
     */
    setAudioBlobUrl(blockId, blobUrl) {
      const runtime = this.getRuntime(blockId);

      // 释放旧的 URL
      if (
        typeof runtime.audioFileObjectUrl === 'string' &&
        runtime.audioFileObjectUrl.startsWith('blob:') &&
        runtime.audioFileObjectUrl !== blobUrl
      ) {
        URL.revokeObjectURL(runtime.audioFileObjectUrl);
      }

      this.updateRuntime(blockId, {
        audioFileObjectUrl: blobUrl,
        showPlayer: true,
        audioLoadFailed: false,
        audioMissingReason: null,
      });
    },

    /**
     * 设置可播放资源 URL（data/blob/media 均可）
     */
    setAudioResourceUrl(blockId, resourceUrl) {
      const runtime = this.getRuntime(blockId);

      // 释放旧的 blob URL
      if (
        typeof runtime.audioFileObjectUrl === 'string' &&
        runtime.audioFileObjectUrl.startsWith('blob:')
      ) {
        URL.revokeObjectURL(runtime.audioFileObjectUrl);
      }

      this.updateRuntime(blockId, {
        audioFileObjectUrl: resourceUrl,
        showPlayer: true,
        audioLoadFailed: false,
        audioMissingReason: null,
      });
    },

    /**
     * 兼容历史 data URL 调用点：语义上仍是设置一个可播放资源 URL。
     */
    setAudioDataUrl(blockId, dataUrl) {
      this.setAudioResourceUrl(blockId, dataUrl);
    },

    /**
     * 获取用于转录的音频数据
     */
    async resolveAudioForTranscription(blockId) {
      const runtime = this.getRuntime(blockId);

      if (runtime.audioBlob instanceof Blob) {
        return {
          blob: runtime.audioBlob,
          mimeType: runtime.mimeType || runtime.audioBlob.type || 'audio/webm',
          filename: runtime.filename || `recording-${blockId}.webm`,
          duration: runtime.duration || 0
        };
      }

      let sourceUrl = typeof runtime.audioFileObjectUrl === 'string' ? runtime.audioFileObjectUrl : null;
      const filePath = runtime.audioFilePath || runtime.src;

      if (!sourceUrl && filePath) {
        if (filePath.startsWith('data:') || filePath.startsWith('blob:')) {
          sourceUrl = filePath;
        } else {
          await this.loadAudioFile(blockId, filePath);
          sourceUrl = this.getRuntime(blockId).audioFileObjectUrl;
        }
      }

      if (!sourceUrl) {
        throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.noAudioForTranscription'));
      }

      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.audioDataReadFailed'));
      }

      const blob = await response.blob();
      const mimeType = blob.type || runtime.mimeType || 'audio/webm';
      const fallbackExt = mimeType.split('/')[1] || 'webm';
      const filename = runtime.filename || (filePath ? filePath.split('/').pop() : `recording-${blockId}.${fallbackExt}`);

      return {
        blob,
        mimeType,
        filename,
        duration: runtime.duration || 0
      };
    },

    /**
     * 加载音频文件
     */
    async loadAudioFile(blockId, filePath) {
      this.updateRuntime(blockId, {
        processingState: 'loading',
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadingAudio'),
      });

      try {
        const buildAudioUrl = window.linnyaMedia?.buildAudioUrl;
        if (typeof buildAudioUrl !== 'function') {
          throw new Error('预加载 API 未注入 (linnyaMedia.buildAudioUrl)');
        }

        const audioUrl = buildAudioUrl(filePath);
        this.setAudioResourceUrl(blockId, audioUrl);
        this.updateRuntime(blockId, {
          audioFilePath: filePath,
          processingState: 'ready',
          statusMessage: '',
          errorMessage: null,
          audioLoadFailed: false,
          audioMissingReason: null,
        });

        console.log(`[AudioRuntimeStore] 加载音频文件 ${filePath} 成功`);
        return true;
      } catch (error) {
        console.error(`[AudioRuntimeStore] 加载音频文件 ${filePath} 失败:`, error);
        this.updateRuntime(blockId, {
          processingState: 'error',
          errorMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailedWithMessage'),
          statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailed'),
          showPlayer: false,
          audioFileObjectUrl: null,
          audioLoadFailed: true,
          audioMissingReason: 'saved-source-missing',
        });
        return false;
      }
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
    cleanupBlock(blockId) {
      const runtime = this.runtimes[blockId];
      if (!runtime) {
        console.warn(`[AudioRuntimeStore] Cleanup skipped: runtime for ${blockId} does not exist`);
        return;
      }

      // 停止录音和释放媒体资源
      if (runtime.mediaStream) {
        runtime.mediaStream.getTracks().forEach(track => track.stop());
        runtime.mediaStream = null;
      }
      if (runtime.mediaRecorder) {
        runtime.mediaRecorder = null;
      }

      // 释放 blob URL
      if (
        typeof runtime.audioFileObjectUrl === 'string' &&
        runtime.audioFileObjectUrl.startsWith('blob:')
      ) {
        URL.revokeObjectURL(runtime.audioFileObjectUrl);
        runtime.audioFileObjectUrl = null;
      }

      // 从全局录制列表中移除
      const index = this.globalRecordingBlocks.indexOf(blockId);
      if (index > -1) {
        this.globalRecordingBlocks.splice(index, 1);
      }

      // 删除状态
      delete this.runtimes[blockId];
      console.log(`[AudioRuntimeStore] Cleaned up runtime for ${blockId}`);
    },
  },
});
