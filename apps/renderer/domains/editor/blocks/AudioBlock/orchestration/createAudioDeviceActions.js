import { createAudioBlockMessage } from '../functions/audioBlockPresentation';
import { buildMicrophonePermissionError } from '../functions/buildMicrophonePermissionError';
export function createAudioDeviceActions(state) {
  async function getAvailableMicrophoneDevices(forceRefresh = false) {
    if (state.deviceCheckInProgress && !forceRefresh) {
      // 如果检查已在进行中，等待其完成
      return new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!state.deviceCheckInProgress) {
            clearInterval(checkInterval);
            resolve({
              success: state.availableMicrophoneDevices.length > 0,
              devices: state.availableMicrophoneDevices,
              currentDevice: state.activeMicrophoneDevice,
            });
          }
        }, 100);
      });
    }

    state.setDeviceCheckInProgress(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      state.setDeviceCheckInProgress(false);
      return {
        success: false,
        message: createAudioBlockMessage('editor.audioBlock.status.unsupportedDeviceDetection'),
        devices: [],
      };
    }

    try {
      // 先请求权限，这样才能获取设备标签
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.setMicrophoneAccess(true);
      } catch (err) {
        console.error('获取麦克风权限失败:', err);
        state.setMicrophoneAccess(false);
        state.setDeviceCheckInProgress(false);

        return {
          success: false,
          message: buildMicrophonePermissionError(err.name),
          errorName: err.name,
          devices: [],
        };
      }

      // 枚举设备
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

      // 更新设备列表
      state.setAvailableDevices(audioInputDevices);

      // 尝试确定当前使用的设备
      if (stream) {
        const tracks = stream.getAudioTracks();
        if (tracks.length > 0) {
          const currentTrack = tracks[0];
          const trackSettings = currentTrack.getSettings();
          const trackDeviceId = trackSettings.deviceId;

          // 查找匹配的设备
          const currentDevice = audioInputDevices.find(d => d.deviceId === trackDeviceId);
          state.setCurrentDevice(
            currentDevice || {
              deviceId: trackDeviceId,
              label: '',
              kind: 'audioinput',
            }
          );
        }

        // 释放请求的流
        stream.getTracks().forEach(track => track.stop());
      }

      state.setDeviceCheckInProgress(false);
      return {
        success: audioInputDevices.length > 0,
        devices: audioInputDevices,
        currentDevice: state.activeMicrophoneDevice,
      };
    } catch (error) {
      console.error('枚举录音设备失败:', error);
      state.setDeviceCheckInProgress(false);
      return {
        success: false,
        message: createAudioBlockMessage('editor.audioBlock.status.deviceDetectionFailed'),
        devices: [],
      };
    }
  }

  async function requestMicrophonePermission() {
    // 先检查设备是否可用
    if (state.availableMicrophoneDevices.length === 0) {
      const deviceResult = await getAvailableMicrophoneDevices();
      if (!deviceResult.success) {
        // 如果设备检测失败，直接返回错误，避免重复尝试
        return deviceResult;
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.setMicrophoneAccess(false);
      return {
        success: false,
        message: createAudioBlockMessage('editor.audioBlock.status.unsupportedRecording'),
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.setMicrophoneAccess(true);

      // 更新当前使用的设备信息
      const tracks = stream.getAudioTracks();
      if (tracks.length > 0) {
        const currentTrack = tracks[0];
        const trackSettings = currentTrack.getSettings();
        const trackDeviceId = trackSettings.deviceId;

        // 查找匹配的设备
        const currentDevice = state.availableMicrophoneDevices.find(
          d => d.deviceId === trackDeviceId
        );
        state.setCurrentDevice(
          currentDevice || {
            deviceId: trackDeviceId,
            label: '',
            kind: 'audioinput',
          }
        );
      }

      return { success: true, stream };
    } catch (err) {
      console.error('获取麦克风权限失败:', err);
      state.setMicrophoneAccess(false);

      return {
        success: false,
        message: buildMicrophonePermissionError(err.name),
        errorName: err.name,
      };
    }
  }
  return { getAvailableMicrophoneDevices, requestMicrophonePermission };
}
