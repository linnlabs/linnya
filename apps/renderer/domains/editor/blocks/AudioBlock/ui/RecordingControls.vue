<template>
  <div
    class="recording-controls"
    :class="{
      'is-recording': isRecording,
      'is-paused': isPaused,
      'is-ready': canRecord && !isRecording
    }"
  >
    <!-- 左侧状态信息 -->
    <div class="left-section">
      <MicrophoneIcon class="icon" />
      
      <!-- 普通状态信息 -->
      <span v-if="!shouldShowErrorSeparately" class="status-text">
        {{ idleStatusText }}
        <span v-if="isRecording" class="recording-indicator">
          {{ !isPaused ? recordingText : editorMessage('editor.audioBlock.status.paused') }}
        </span>
        <span v-if="isRecording" class="recording-time" :class="{ 'near-limit': isNearTimeLimit }">
          {{ recordingTime }}
          <span v-if="isNearTimeLimit" class="limit-warning-container">
            <InfoIcon class="limit-warning-icon" />
            <span class="limit-warning-tooltip">{{ editorMessage('editor.audioBlock.status.maxDuration') }}</span>
          </span>
        </span>
      </span>
      
      <!-- 错误信息 -->
      <span v-if="shouldShowErrorSeparately" class="error-text">{{ resolvedErrorMessage }}</span>
    </div>
    
    <!-- 中间波形图 -->
    <div class="waveform-container">
    <AudioWaveform 
      v-if="isRecording"
      :is-recording="isRecording"
      :is-paused="isPaused"
      :media-stream="mediaStream"
    />
    </div>
    
    <!-- 右侧按钮 -->
    <div class="right-section">
      <!-- 未录音状态按钮 -->
      <button 
        v-if="!isRecording"
        @click="isSaveFailedState ? onRetrySaveRecording() : (canRecord ? onStartRecording() : onRetryDeviceCheck())"
        class="control-button"
        :class="{
          'start-button': canRecord && !isSaveFailedState,
          'retry-button': !canRecord || isSaveFailedState,
          'retry-save-button': isSaveFailedState
        }"
        :disabled="!isSaveFailedState && !canRecord && !errorMessage"
      >
        {{ idleButtonText }}
      </button>
      
      <!-- 录音状态按钮 -->
      <template v-else>
        <button @click="onToggleNotes" class="control-button notes-button">
          {{ editorMessage('editor.audioBlock.action.notes') }}
        </button>
        <button v-if="!isPaused" @click="onPauseRecording" class="control-button action-button">
          {{ editorMessage('editor.audioBlock.action.pause') }}
        </button>
        <button v-else @click="onResumeRecording" class="control-button action-button">
          {{ editorMessage('editor.audioBlock.action.resume') }}
        </button>
        <button @click="onTerminateRecording" class="control-button stop-button">
          {{ editorMessage('editor.audioBlock.action.finish') }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import AudioWaveform from './AudioWaveform.vue';
import { MicrophoneIcon } from '@linnya/renderer-ui/icons';
import { InfoIcon } from '@linnya/renderer-ui/icons';
import { useAudioRuntimeStore } from '../store';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { resolveAudioBlockStatusMessage } from '../functions/audioBlockPresentation';

const runtimeStore = useAudioRuntimeStore();
const { editorMessage } = useEditorLocalization();

const props = defineProps({
  blockId: {
    type: String,
    required: true
  },
  isRecording: {
    type: Boolean,
    default: false
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  canRecord: {
    type: Boolean,
    default: true
  },
  statusMessage: {
    type: [String, Object],
    default: ''
  },
  errorMessage: {
    type: [String, Object],
    default: ''
  },
  microphoneDevice: {
    type: Object,
    default: null
  },
  mediaStream: {
    type: Object,
    default: null
  },
  processingState: {
    type: String,
    default: 'idle'
  }
});

const emit = defineEmits([
  'start-recording', 
  'pause-recording', 
  'resume-recording', 
  'terminate-recording',
  'retry-save-recording',
  'retry-device-check',
  'toggle-notes'
]);

// 录音时间计时器
// 录音限制配置
const RECORDING_LIMITS = {
  maxDuration: 7200, // 2小时
  warningThreshold: 0.9, // 达到最大时长的 90% 时显示警告提示
  maxFileSize: 50 * 1024 * 1024, // 50MB
};

const recordingTimeSeconds = ref(0);
const recordingTime = computed(() => {
  if (isNaN(recordingTimeSeconds.value) || recordingTimeSeconds.value < 0) {
    recordingTimeSeconds.value = 0;
    return '00:00';
  }
  
  const minutes = Math.floor(recordingTimeSeconds.value / 60);
  const seconds = Math.floor(recordingTimeSeconds.value % 60);
  
  const timeDisplay = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  return timeDisplay;
});

const recordingText = computed(() => `● ${editorMessage('editor.audioBlock.status.recording')}`);
const resolvedStatusMessage = computed(() => resolveAudioBlockStatusMessage(props.statusMessage, editorMessage));
const resolvedErrorMessage = computed(() => resolveAudioBlockStatusMessage(props.errorMessage, editorMessage));
const isSaveFailedState = computed(() => props.processingState === 'save_failed');
const idleStatusText = computed(() => {
  if (props.isRecording) return '';
  if (isSaveFailedState.value) return resolvedStatusMessage.value;
  return props.canRecord ? editorMessage('editor.audioBlock.status.microphoneConnected') : resolvedStatusMessage.value;
});
const idleButtonText = computed(() => {
  if (isSaveFailedState.value) return editorMessage('editor.audioBlock.action.retrySaveRecording');
  return props.canRecord
    ? editorMessage('editor.audioBlock.action.startRecording')
    : editorMessage('editor.audioBlock.action.retryMicrophone');
});

// 检查是否接近时长限制
const isNearTimeLimit = computed(() => {
  return recordingTimeSeconds.value > RECORDING_LIMITS.maxDuration * RECORDING_LIMITS.warningThreshold;
});

let timerInterval = null;

// 计算属性
const hasError = computed(() => {
  return !!props.errorMessage && props.processingState !== 'loading';
});

// 判断是否应该单独显示错误信息
const shouldShowErrorSeparately = computed(() => {
  // 如果错误信息已经在状态消息中显示了，就不要单独显示
  // 或者如果正在加载中，也不显示错误信息
  return hasError.value && 
         props.errorMessage !== props.statusMessage && 
         props.processingState !== 'loading';
});

// 方法
const onStartRecording = () => {
  if (!props.canRecord) return;
  emit('start-recording');
  startTimer();
};

const onPauseRecording = () => {
  if (!props.isRecording || props.isPaused) return;
  emit('pause-recording');
  pauseTimer();
};

const onResumeRecording = () => {
  if (!props.isRecording || !props.isPaused) return;
  emit('resume-recording');
  resumeTimer();
};

const onTerminateRecording = () => {
  if (!props.isRecording) return;
  emit('terminate-recording', recordingTimeSeconds.value);
  stopTimer();
};

const onRetryDeviceCheck = () => {
  emit('retry-device-check');
};

const onRetrySaveRecording = () => {
  emit('retry-save-recording');
};

const onToggleNotes = () => {
  emit('toggle-notes');
};

// 计时器控制
const startTimer = () => {
  // 先停止可能存在的计时器
  stopTimer();
  
  recordingTimeSeconds.value = 0;
  timerInterval = setInterval(() => {
    if (!props.isPaused && props.isRecording) {
      recordingTimeSeconds.value += 1;
      
      // 同步录制时间到 store
      runtimeStore.updateRuntime(props.blockId, { recordingTime: recordingTimeSeconds.value });
      
      // 检查是否达到最大录音时长
      if (recordingTimeSeconds.value >= RECORDING_LIMITS.maxDuration) {
        console.warn(`[RecordingControls] 达到最大录音时长 ${RECORDING_LIMITS.maxDuration}秒，自动停止录制`);
        // 自动停止录音
        onTerminateRecording();
        return;
      }
      
      // 在接近限制时发出警告
      const warningTime = Math.floor(RECORDING_LIMITS.maxDuration * RECORDING_LIMITS.warningThreshold);
      if (recordingTimeSeconds.value === warningTime) {
        const warningPercent = Math.floor(RECORDING_LIMITS.warningThreshold * 100);
        console.warn(`[RecordingControls] 录音时长已达${warningPercent}%，建议尽快完成录制`);
      }
    }
  }, 1000);
};

const pauseTimer = () => {
  // 保持当前值，但不增加
};

const resumeTimer = () => {
  // 继续增加
};

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

// 观察录音状态变化
watch(() => props.isRecording, (isRecording) => {
  if (isRecording) {
    startTimer();
  } else {
    stopTimer();
  }
});

// 生命周期钩子
onMounted(() => {
  if (props.isRecording && !timerInterval) {
    startTimer();
  }
});

onBeforeUnmount(() => {
  stopTimer();
});
</script>
