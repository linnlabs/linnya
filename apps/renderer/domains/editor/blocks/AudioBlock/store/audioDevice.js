import { defineStore } from 'pinia';
import { ref } from 'vue';

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
    setDeviceCheckInProgress(value) {
      this.deviceCheckInProgress = value;
    },
    setMicrophoneAccess(value) {
      this.activeMicrophoneAccess = value;
    },
    setAvailableDevices(devices) {
      this.availableMicrophoneDevices = devices;
    },
    setCurrentDevice(device) {
      this.activeMicrophoneDevice = device;
    },

    /**
     * 请求麦克风权限
     * @returns {Promise} 包含流或错误信息的Promise
     */
  },
});
