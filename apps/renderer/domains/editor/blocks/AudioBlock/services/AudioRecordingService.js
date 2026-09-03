/**
 * 音频录制服务
 * 负责处理录音、保存和状态管理的核心逻辑
 */
import { createAudioBlockMessage } from '../functions/audioBlockPresentation';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

export class AudioRecordingService {
  constructor(blockId, store, updateNodeAttributes) {
    this.blockId = blockId;
    this.store = store;
    this.updateNodeAttributes = updateNodeAttributes;
    this.mediaRecorder = null;
    this.stream = null;
    this.currentRecordingDuration = 0;
    this.audioChunks = [];
    /**
     * 终止录音的可等待对象（用于切换文件/保存前的优雅收尾）
     * @type {null | { promise: Promise<boolean>, resolve: (ok: boolean) => void }}
     */
    this._terminateDeferred = null;
  }

  /**
   * 创建一个“可等待”的 deferred promise
   * @returns {{ promise: Promise<boolean>, resolve: (ok: boolean) => void }}
   */
  _createTerminateDeferred() {
    let resolveFn = null;
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
    });
    return {
      promise,
      resolve: (ok) => {
        if (typeof resolveFn === 'function') {
          resolveFn(!!ok);
        }
      }
    };
  }

  _getFileExtension(mimeType) {
    if (mimeType.includes('opus')) return 'webm'; // Opus 通常封装在 WebM 中。
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mp4')) return 'm4a';
    return mimeType.split('/')[1]?.split(';')[0] || 'webm';
  }

  _createRecordingFilename(mimeType) {
    const fileExtension = this._getFileExtension(mimeType);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `recording-${timestamp}.${fileExtension}`;
  }

  async _persistRecordingBlob(audioBlob, mimeType, recordedDuration) {
    this.store.updateRuntime(this.blockId, {
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.savingRecording'),
      processingState: 'loading'
    });

    const arrayBuffer = await audioBlob.arrayBuffer();
    const saveResult = await window.electronAPI.saveAudioFile(arrayBuffer, mimeType);

    if (!saveResult || !saveResult.success) {
      throw new Error(saveResult?.error || resolveCurrentEditorMessage('editor.audioBlock.error.saveFileFailed'));
    }

    console.log(`[AudioRecordingService] 文件保存成功: ${saveResult.filePath}`);
    this.updateNodeAttributes({
      src: saveResult.filePath,
      isTempSrc: false,
      duration: recordedDuration,
      mimeType,
      isFinalized: true,
      saveStatus: null
    });
    this.store.updateRuntime(this.blockId, {
      saveStatus: null,
      duration: recordedDuration,
      mimeType,
      audioBlob,
      audioMissingReason: null,
      audioLoadFailed: false
    });

    let audioLoaded = false;
    try {
      audioLoaded = await this.store.loadAudioFile(this.blockId, saveResult.filePath) === true;
    } catch (loadError) {
      console.error('[AudioRecordingService] 录音已保存，但播放器加载失败:', loadError);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailed'),
        processingState: 'error',
        showPlayer: false,
        audioLoadFailed: true,
        audioMissingReason: 'saved-source-missing'
      });
      return false;
    }

    if (!audioLoaded) {
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailed'),
        processingState: 'error',
        showPlayer: false,
        audioLoadFailed: true,
        audioMissingReason: 'saved-source-missing'
      });
      return false;
    }

    this.store.updateRuntime(this.blockId, {
      statusMessage: '',
      processingState: 'ready',
      errorMessage: null,
      saveStatus: null,
      audioLoadFailed: false,
      audioMissingReason: null
    });

    return true;
  }

  _markRecordingSaveFailed(audioBlob, mimeType, recordedDuration, filename) {
    const audioUrl = URL.createObjectURL(audioBlob);
    this.store.setAudioBlobUrl(this.blockId, audioUrl);

    this.store.updateRuntime(this.blockId, {
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.saveFailedRetryable'),
      processingState: 'save_failed',
      errorMessage: null,
      audioBlob,
      duration: recordedDuration,
      filename,
      mimeType,
      saveStatus: 'failed',
      audioLoadFailed: false,
      audioMissingReason: null
    });

    // 这里只持久化可恢复失败态，不持久化会在重启后失效的 blob: URL。
    this.updateNodeAttributes({
      isFinalized: false,
      isTempSrc: false,
      src: null,
      duration: recordedDuration,
      mimeType,
      saveStatus: 'failed'
    });
  }

  /**
   * 初始化录音器并设置必要的处理器
   * @param {MediaStream} stream - 媒体流
   * @returns {boolean} 是否成功初始化
   */
  initializeRecorder(stream) {
    try {
      // 智能选择最佳音频格式（按优先级排序）
      const getSupportedAudioFormat = () => {
        const formats = [];
        const canTest = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';

        if (canTest && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          formats.push({ mimeType: 'audio/webm;codecs=opus', bitrate: 24000 });
        }
        if (canTest && MediaRecorder.isTypeSupported('audio/webm')) {
          formats.push({ mimeType: 'audio/webm', bitrate: 32000 });
        }
        if (canTest && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          formats.push({ mimeType: 'audio/ogg;codecs=opus', bitrate: 24000 });
        }
        if (canTest && MediaRecorder.isTypeSupported('audio/ogg')) {
          formats.push({ mimeType: 'audio/ogg', bitrate: 32000 });
        }
        if (canTest && MediaRecorder.isTypeSupported('audio/wav')) {
          formats.push({ mimeType: 'audio/wav', bitrate: 128000 });
        }

        if (formats.length === 0) {
          throw new Error('设备不支持任何预设的音频录制格式');
        }

        console.log(
          `[AudioRecordingService] 检测到的音频格式支持: ${formats
            .map((format) => format.mimeType)
            .join(', ')}`
        );

        return formats[0];
      };

      const selectedFormat = getSupportedAudioFormat();
      const { mimeType, bitrate } = selectedFormat;

      console.log(`[AudioRecordingService] 使用录音格式: ${mimeType}, 比特率: ${bitrate}bps`);

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: bitrate
      });
      // 保存 stream 引用，确保 cleanup 可以正确 stop tracks
      this.stream = stream;

      this.audioChunks = [];

      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      });
      this.mediaRecorder.addEventListener('stop', this.handleRecordingStop.bind(this));
      this.mediaRecorder.addEventListener('error', this.handleRecordingError.bind(this));
      
      this.store.updateRuntime(this.blockId, { mediaRecorder: this.mediaRecorder, mediaStream: stream });
      return true;

    } catch (error) {
      console.error('初始化录音器失败:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.initializationFailed'),
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.initializationFailed'),
        processingState: 'error'
      });
      this.cleanup();
      return false;
    }
  }

  /**
   * 开始录音
   */
  async startRecording() {
    try {
      const state = this.store.getRuntime(this.blockId);
      if (state.isRecording || state.isFinalized) return;
      
      const permissionResult = await this.store.requestMicrophonePermission();
      if (!permissionResult.success) {
        this.store.updateRuntime(this.blockId, {
          statusMessage: permissionResult.message || createAudioBlockMessage('editor.audioBlock.status.microphoneAccessFailed'),
          canRecord: false,
          processingState: 'error',
          errorMessage: permissionResult.message || createAudioBlockMessage('editor.audioBlock.status.microphoneAccessFailed')
        });
        return;
      }
      
      if (!this.initializeRecorder(permissionResult.stream)) return;
      
      this.mediaRecorder.start(250);
      
      // 使用 store 的 startRecording 维护全局录制列表（用于切换文件时统一终止）
      if (typeof this.store.startRecording === 'function') {
        this.store.startRecording(this.blockId);
      }

      this.store.updateRuntime(this.blockId, {
        isPaused: false,
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.recording'),
        processingState: 'recording'
      });
    } catch (error) {
      console.error('开始录音失败:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.startRecordingFailed'),
        processingState: 'error',
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.startRecordingFailed')
      });
      this.cleanup();
    }
  }

  /**
   * 暂停录音
   */
  pauseRecording() {
    try {
      const state = this.store.getRuntime(this.blockId);
      if (!state.isRecording || state.isPaused || !this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
      this.mediaRecorder.pause();
      this.store.updateRuntime(this.blockId, {
        isPaused: true,
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.paused')
      });
    } catch (error) {
      console.error('暂停录音失败:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.pauseRecordingFailed'),
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.pauseRecordingFailed')
      });
    }
  }

  /**
   * 恢复录音
   */
  resumeRecording() {
    try {
      const state = this.store.getRuntime(this.blockId);
      if (!state.isRecording || !state.isPaused || !this.mediaRecorder || this.mediaRecorder.state !== 'paused') return;
      this.mediaRecorder.resume();
      this.store.updateRuntime(this.blockId, {
        isPaused: false,
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.recording')
      });
    } catch (error) {
      console.error('恢复录音失败:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.resumeRecordingFailed'),
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.resumeRecordingFailed')
      });
    }
  }

  /**
   * 终止录音
   * @param {number} actualDuration - 从控件传递过来的准确录制时长（秒）
   * @returns {Promise<boolean>} true 表示录音已完成收尾（含可重试保存失败态），false 表示录音数据不可用
   */
  terminateRecording(actualDuration) {
    try {
      const state = this.store.getRuntime(this.blockId);
      if (!state.isRecording || !this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return Promise.resolve(true);
      }
      
      this.currentRecordingDuration = actualDuration || 0;

      // 创建可等待对象：用于切换文件时阻塞直到 stop->handleRecordingStop 全流程结束
      if (!this._terminateDeferred) {
        this._terminateDeferred = this._createTerminateDeferred();
      }

      this.mediaRecorder.stop();
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.processingAudio'),
        processingState: 'processing'
      });
      return this._terminateDeferred.promise;
    } catch (error) {
      console.error('终止录音失败:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.terminateRecordingFailed'),
        processingState: 'error',
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.terminateRecordingFailed')
      });
      this.cleanup();
      this.updateNodeAttributes({ isFinalized: true });
      if (this._terminateDeferred) {
        this._terminateDeferred.resolve(false);
        this._terminateDeferred = null;
      }
      return Promise.resolve(false);
    }
  }

  /**
   * 处理录音停止事件
   */
  async handleRecordingStop() {
    try {
      const recordedDuration = Math.round(this.currentRecordingDuration) || 0;
      this.currentRecordingDuration = 0;
      
      if (this.audioChunks.length === 0) {
        throw new Error('录音数据为空，未录制到任何内容。');
      }

      const mimeType = this.mediaRecorder?.mimeType || 'audio/mp4';
      const audioBlob = new Blob(this.audioChunks, { type: mimeType });
      
      if (audioBlob.size < 1000) {
        throw new Error(`最终文件过小 (${audioBlob.size}字节)，可能无效。`);
      }

      console.log(`[AudioRecordingService] 音频拼接完成: MIME=${mimeType}, 大小=${audioBlob.size}字节`);

      const filename = this._createRecordingFilename(mimeType);

      console.log(`[AudioRecordingService] 生成文件名: ${filename}`);

      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.ready'),
        processingState: 'ready',
        audioBlob,
        duration: recordedDuration,
        filename,
        mimeType
      });

      try {
        await this._persistRecordingBlob(audioBlob, mimeType, recordedDuration);
        if (this._terminateDeferred) {
          this._terminateDeferred.resolve(true);
          this._terminateDeferred = null;
        }
      } catch (saveError) {
        console.error('[AudioRecordingService] 保存录音文件失败:', saveError);
        this._markRecordingSaveFailed(audioBlob, mimeType, recordedDuration, filename);
        // 保存失败也必须解除保存/切文件等待；文档只记录失败态，不记录失效 blob。
        if (this._terminateDeferred) {
          this._terminateDeferred.resolve(true);
          this._terminateDeferred = null;
        }
      } finally {
        this.store.updateRuntime(this.blockId, {
          isRecording: false,
          isPaused: false
        });
        if (typeof this.store.stopRecording === 'function') {
          this.store.stopRecording(this.blockId);
        }
      }
    } catch (error) {
      console.error('[AudioRecordingService] 处理录音停止事件时出错:', error);
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.recordingProcessFailed'),
        processingState: 'error',
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.recordingProcessFailed'),
        isRecording: false,
        isPaused: false
      });
      this.updateNodeAttributes({ isFinalized: true, duration: 0, src: null });
      if (typeof this.store.stopRecording === 'function') {
        this.store.stopRecording(this.blockId);
      }
      if (this._terminateDeferred) {
        this._terminateDeferred.resolve(false);
        this._terminateDeferred = null;
      }
    } finally {
      // 确保在任何情况下都执行清理
      this.cleanup();
    }
  }

  async retrySavePendingRecording() {
    const runtimeState = this.store.getRuntime(this.blockId);
    const audioBlob = runtimeState.audioBlob;

    if (!(audioBlob instanceof Blob)) {
      this.store.updateRuntime(this.blockId, {
        statusMessage: createAudioBlockMessage('editor.audioBlock.status.saveFailedNoRuntimeAudio'),
        processingState: 'error',
        errorMessage: createAudioBlockMessage('editor.audioBlock.status.saveFailedNoRuntimeAudio'),
        saveStatus: 'failed',
        audioLoadFailed: true,
        audioMissingReason: 'save-failed-without-runtime-audio',
        showPlayer: false
      });
      this.updateNodeAttributes({
        isFinalized: false,
        isTempSrc: false,
        src: null,
        saveStatus: 'failed'
      });
      return false;
    }

    const mimeType = runtimeState.mimeType || audioBlob.type || 'audio/webm';
    const recordedDuration = Math.round(runtimeState.duration || 0);
    const filename = runtimeState.filename || this._createRecordingFilename(mimeType);

    try {
      this.store.updateRuntime(this.blockId, {
        filename,
        mimeType,
        saveStatus: 'failed'
      });
      await this._persistRecordingBlob(audioBlob, mimeType, recordedDuration);
      return true;
    } catch (error) {
      console.error('[AudioRecordingService] 重试保存录音文件失败:', error);
      this._markRecordingSaveFailed(audioBlob, mimeType, recordedDuration, filename);
      return false;
    }
  }

  /**
   * 处理录音错误事件
   * @param {Event} event - 错误事件
   */
  handleRecordingError(event) {
    console.error('MediaRecorder 发生错误:', event.error);
    this.store.updateRuntime(this.blockId, {
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.recordingError'),
      processingState: 'error',
      errorMessage: createAudioBlockMessage('editor.audioBlock.status.recordingError'),
      isRecording: false,
      isPaused: false
    });
    this.cleanup();
    this.updateNodeAttributes({ isFinalized: false });
    if (typeof this.store.stopRecording === 'function') {
      this.store.stopRecording(this.blockId);
    }
    if (this._terminateDeferred) {
      this._terminateDeferred.resolve(false);
      this._terminateDeferred = null;
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止媒体流
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // 清理 MediaRecorder 和数据块
    this.mediaRecorder = null;
    this.audioChunks = [];
    
    // 更新状态
    this.store.updateRuntime(this.blockId, {
      mediaRecorder: null,
      mediaStream: null
    });
  }
}

export default AudioRecordingService; 
