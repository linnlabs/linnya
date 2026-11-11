import { createAudioBlockMessage } from '../functions/audioBlockPresentation';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
export function createAudioRuntimeActions(state, deviceActions) {
  async function terminateAllRecordingsForSave() {
    const blockIds = Array.isArray(state.globalRecordingBlocks)
      ? state.globalRecordingBlocks.slice()
      : Array.isArray(state.globalRecordingBlocks?.value)
        ? state.globalRecordingBlocks.value.slice()
        : [];

    if (blockIds.length === 0) {
      return true;
    }

    for (const blockId of blockIds) {
      const controller = state.recordingControllers[blockId];
      if (!controller || typeof controller.terminateForSave !== 'function') {
        console.warn(
          '[AudioRuntimeStore] terminateAllRecordingsForSave: 未找到控制器，跳过',
          blockId
        );
        continue;
      }
      try {
        const ok = await controller.terminateForSave();
        if (!ok) {
          console.error('[AudioRuntimeStore] terminateAllRecordingsForSave: 终止录音失败', blockId);
          return false;
        }
      } catch (error) {
        console.error(
          '[AudioRuntimeStore] terminateAllRecordingsForSave: 终止录音异常',
          blockId,
          error
        );
        return false;
      }
    }

    return true;
  }

  async function checkMicrophoneForBlock(blockId, forceRefresh = false) {
    const runtime = state.getRuntime(blockId);
    const deviceStore = deviceActions;

    // 如果已完成检测且不强制刷新，跳过
    if (runtime.deviceCheckCompleted && !forceRefresh) {
      console.log(`[AudioRuntimeStore] Device check already completed for ${blockId}, skipping`);
      return;
    }

    // 使用设备 store 获取设备信息
    const result = await deviceStore.getAvailableMicrophoneDevices(forceRefresh);

    if (result && result.success && result.devices?.length) {
      const device = result.currentDevice || result.devices[0];
      state.updateRuntime(blockId, {
        microphoneDevice: device,
        canRecord: true,
        statusMessage: device?.label
          ? createAudioBlockMessage('editor.audioBlock.status.usingMicrophone', {
              device: device.label,
            })
          : createAudioBlockMessage('editor.audioBlock.status.usingDefaultMicrophone'),
        deviceCheckCompleted: true,
        processingState: 'ready',
      });
      return { success: true, device };
    }

    state.updateRuntime(blockId, {
      microphoneDevice: null,
      canRecord: false,
      statusMessage:
        result?.message || createAudioBlockMessage('editor.audioBlock.status.noMicrophone'),
      deviceCheckCompleted: true,
      processingState: 'error',
    });

    return { success: false, error: result?.error || 'device_not_found' };
  }

  async function requestMicrophonePermission() {
    const deviceStore = deviceActions;
    return await deviceStore.requestMicrophonePermission();
  }

  async function resolveAudioForTranscription(blockId) {
    const runtime = state.getRuntime(blockId);

    if (runtime.audioBlob instanceof Blob) {
      return {
        blob: runtime.audioBlob,
        mimeType: runtime.mimeType || runtime.audioBlob.type || 'audio/webm',
        filename: runtime.filename || `recording-${blockId}.webm`,
        duration: runtime.duration || 0,
      };
    }

    let sourceUrl =
      typeof runtime.audioFileObjectUrl === 'string' ? runtime.audioFileObjectUrl : null;
    const filePath = runtime.audioFilePath || runtime.src;

    if (!sourceUrl && filePath) {
      if (filePath.startsWith('data:') || filePath.startsWith('blob:')) {
        sourceUrl = filePath;
      } else {
        await loadAudioFile(blockId, filePath);
        sourceUrl = state.getRuntime(blockId).audioFileObjectUrl;
      }
    }

    if (!sourceUrl) {
      throw new Error(
        resolveCurrentEditorMessage('editor.audioBlock.error.noAudioForTranscription')
      );
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.audioDataReadFailed'));
    }

    const blob = await response.blob();
    const mimeType = blob.type || runtime.mimeType || 'audio/webm';
    const fallbackExt = mimeType.split('/')[1] || 'webm';
    const filename =
      runtime.filename ||
      (filePath ? filePath.split('/').pop() : `recording-${blockId}.${fallbackExt}`);

    return {
      blob,
      mimeType,
      filename,
      duration: runtime.duration || 0,
    };
  }

  async function loadAudioFile(blockId, filePath) {
    state.updateRuntime(blockId, {
      processingState: 'loading',
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadingAudio'),
    });

    try {
      const buildAudioUrl = window.linnyaMedia?.buildAudioUrl;
      if (typeof buildAudioUrl !== 'function') {
        throw new Error('预加载 API 未注入 (linnyaMedia.buildAudioUrl)');
      }

      const audioUrl = buildAudioUrl(filePath);
      setAudioResourceUrl(blockId, audioUrl);
      state.updateRuntime(blockId, {
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
      state.updateRuntime(blockId, {
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
  }

  function setAudioBlobUrl(blockId, blobUrl) {
    const runtime = state.getRuntime(blockId);

    // 释放旧的 URL
    if (
      typeof runtime.audioFileObjectUrl === 'string' &&
      runtime.audioFileObjectUrl.startsWith('blob:') &&
      runtime.audioFileObjectUrl !== blobUrl
    ) {
      URL.revokeObjectURL(runtime.audioFileObjectUrl);
    }

    state.updateRuntime(blockId, {
      audioFileObjectUrl: blobUrl,
      showPlayer: true,
      audioLoadFailed: false,
      audioMissingReason: null,
    });
  }

  function setAudioResourceUrl(blockId, resourceUrl) {
    const runtime = state.getRuntime(blockId);

    // 释放旧的 blob URL
    if (
      typeof runtime.audioFileObjectUrl === 'string' &&
      runtime.audioFileObjectUrl.startsWith('blob:')
    ) {
      URL.revokeObjectURL(runtime.audioFileObjectUrl);
    }

    state.updateRuntime(blockId, {
      audioFileObjectUrl: resourceUrl,
      showPlayer: true,
      audioLoadFailed: false,
      audioMissingReason: null,
    });
  }

  function setAudioDataUrl(blockId, dataUrl) {
    setAudioResourceUrl(blockId, dataUrl);
  }

  function cleanupBlock(blockId) {
    const runtime = state.runtimes[blockId];
    if (!runtime) {
      console.warn(`[AudioRuntimeStore] Cleanup skipped: runtime for ${blockId} does not exist`);
      return;
    }

    // 停止录音和释放媒体资源
    if (runtime.mediaStream) {
      runtime.mediaStream.getTracks().forEach(track => track.stop());
      state.updateRuntime(blockId, { mediaStream: null });
    }
    if (runtime.mediaRecorder) {
      state.updateRuntime(blockId, { mediaRecorder: null });
    }

    // 释放 blob URL
    if (
      typeof runtime.audioFileObjectUrl === 'string' &&
      runtime.audioFileObjectUrl.startsWith('blob:')
    ) {
      URL.revokeObjectURL(runtime.audioFileObjectUrl);
      state.updateRuntime(blockId, { audioFileObjectUrl: null });
    }

    state.removeRuntime(blockId);
    console.log(`[AudioRuntimeStore] Cleaned up runtime for ${blockId}`);
  }
  const recordingPort = {
    getRuntime: state.getRuntime,
    updateRuntime: state.updateRuntime,
    startRecording: state.startRecording,
    stopRecording: state.stopRecording,
    setAudioBlobUrl,
    loadAudioFile,
    requestMicrophonePermission,
  };
  return {
    terminateAllRecordingsForSave,
    checkMicrophoneForBlock,
    requestMicrophonePermission,
    resolveAudioForTranscription,
    loadAudioFile,
    setAudioBlobUrl,
    setAudioResourceUrl,
    setAudioDataUrl,
    cleanupBlock,
    recordingPort,
  };
}
