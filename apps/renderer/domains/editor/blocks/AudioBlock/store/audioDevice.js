import { defineStore } from 'pinia';
import { ref } from 'vue';
import { createAudioBlockMessage } from '../functions/audioBlockPresentation';

function buildMicrophonePermissionError(errorName) {
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return createAudioBlockMessage('editor.audioBlock.status.microphonePermissionDenied');
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return createAudioBlockMessage('editor.audioBlock.status.microphoneNotFound');
  }
  return createAudioBlockMessage('editor.audioBlock.status.microphoneAccessFailed');
}

/**
 * 音频设备状态管理
 * 职责：管理全局的麦克风设备状态、权限检查
 * 
 * 为什么独立？
 * - 设备状态是全局的，不属于某个特定的音频块
 * - 设备检查逻辑可以被多个组件复用
 * - 独立后可以在应用启动时预先检查设备
 */
export const useAudioDeviceStore = defineStore('audioDevice', {
  state: () => ({
    // 全局麦克风访问权限
    activeMicrophoneAccess: ref(true),
    
    // 当前使用的麦克风设备
    activeMicrophoneDevice: ref(null),
    
    // 可用麦克风设备列表
    availableMicrophoneDevices: ref([]),
    
    // 设备检查进行中标志
    deviceCheckInProgress: ref(false),
  }),

  actions: {
    /**
     * 获取可用麦克风设备列表
     * @param {boolean} forceRefresh - 是否强制刷新设备列表
     * @returns {Promise} 包含设备列表的Promise
     */
    async getAvailableMicrophoneDevices(forceRefresh = false) {
      if (this.deviceCheckInProgress && !forceRefresh) {
        // 如果检查已在进行中，等待其完成
        return new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.deviceCheckInProgress) {
              clearInterval(checkInterval);
              resolve({
                success: this.availableMicrophoneDevices.length > 0,
                devices: this.availableMicrophoneDevices,
                currentDevice: this.activeMicrophoneDevice
              });
            }
          }, 100);
        });
      }

      this.deviceCheckInProgress = true;

      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        this.deviceCheckInProgress = false;
        return { 
          success: false, 
          message: createAudioBlockMessage('editor.audioBlock.status.unsupportedDeviceDetection'),
          devices: [] 
        };
      }
      
      try {
        // 先请求权限，这样才能获取设备标签
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.activeMicrophoneAccess = true;
        } catch (err) {
          console.error('获取麦克风权限失败:', err);
          this.activeMicrophoneAccess = false;
          this.deviceCheckInProgress = false;
          
          return { 
            success: false, 
            message: buildMicrophonePermissionError(err.name),
            errorName: err.name,
            devices: []
          };
        }
        
        // 枚举设备
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
        
        // 更新设备列表
        this.availableMicrophoneDevices = audioInputDevices;
        
        // 尝试确定当前使用的设备
        if (stream) {
          const tracks = stream.getAudioTracks();
          if (tracks.length > 0) {
            const currentTrack = tracks[0];
            const trackSettings = currentTrack.getSettings();
            const trackDeviceId = trackSettings.deviceId;
            
            // 查找匹配的设备
            const currentDevice = audioInputDevices.find(d => d.deviceId === trackDeviceId);
            this.activeMicrophoneDevice = currentDevice || {
              deviceId: trackDeviceId,
              label: '',
              kind: 'audioinput'
            };
          }
          
          // 释放请求的流
          stream.getTracks().forEach(track => track.stop());
        }
        
        this.deviceCheckInProgress = false;
        return { 
          success: audioInputDevices.length > 0, 
          devices: audioInputDevices,
          currentDevice: this.activeMicrophoneDevice
        };
      } catch (error) {
        console.error('枚举录音设备失败:', error);
        this.deviceCheckInProgress = false;
        return { 
          success: false, 
          message: createAudioBlockMessage('editor.audioBlock.status.deviceDetectionFailed'),
          devices: []
        };
      }
    },

    /**
     * 请求麦克风权限
     * @returns {Promise} 包含流或错误信息的Promise
     */
    async requestMicrophonePermission() {
      // 先检查设备是否可用
      if (this.availableMicrophoneDevices.length === 0) {
        const deviceResult = await this.getAvailableMicrophoneDevices();
        if (!deviceResult.success) {
          // 如果设备检测失败，直接返回错误，避免重复尝试
          return deviceResult;
        }
      }
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.activeMicrophoneAccess = false;
        return { 
          success: false, 
          message: createAudioBlockMessage('editor.audioBlock.status.unsupportedRecording')
        };
      }
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.activeMicrophoneAccess = true;
        
        // 更新当前使用的设备信息
        const tracks = stream.getAudioTracks();
        if (tracks.length > 0) {
          const currentTrack = tracks[0];
          const trackSettings = currentTrack.getSettings();
          const trackDeviceId = trackSettings.deviceId;
          
          // 查找匹配的设备
          const currentDevice = this.availableMicrophoneDevices.find(d => d.deviceId === trackDeviceId);
          this.activeMicrophoneDevice = currentDevice || {
            deviceId: trackDeviceId,
            label: '',
            kind: 'audioinput'
          };
        }
        
        return { success: true, stream };
      } catch (err) {
        console.error('获取麦克风权限失败:', err);
        this.activeMicrophoneAccess = false;
        
        return { 
          success: false, 
          message: buildMicrophonePermissionError(err.name),
          errorName: err.name
        };
      }
    },
  }
});
