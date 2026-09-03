<template>
  <div class="audio-player-container">
    <audio 
      ref="audioPlayerRef" 
      :src="audioUrl"
      :id="`audio-player-${blockId}`"
      @error="handleError" 
      @loadedmetadata="handleLoadedMetadata"
      @durationchange="handleDurationChange"
      @timeupdate="updateProgress"
      @ended="handleEnded"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      preload="metadata"
    ></audio>
    
    <div class="player-controls">
      <button class="play-button" @click="togglePlay">
        <PlayIcon v-if="!isPlaying" class="play-icon" />
        <PauseIcon v-else class="pause-icon" />
      </button>
      
      <div class="time-display">{{ currentTimeFormatted }} / {{ durationFormatted }}</div>
      
      <ProgressBar 
        :progress="progress"
        @seek="seek"
        @start-drag="startDrag"
        ref="progressBarRef"
      />
      
      <TranscriptionButton 
        :transcription-state="transcriptionState"
        @click="handleAiClick"
      />

      <CreateMenu @action="handleCreateAction" />

      <PanelToggleButton 
        :is-panel-visible="isPanelVisible"
        @toggle="togglePanel"
      />
    </div>
    
    <span v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </span>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useNotificationStore } from '@/app/notification';
import { useAudioRuntimeStore } from '../store/index.js';
import { formatDuration } from '@/shared/utils/dateFormatter.js';
import { PlayIcon } from '@linnya/renderer-ui/icons';
import { PauseIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

// 导入子组件
import ProgressBar from './components/ProgressBar.vue';
import TranscriptionButton from './components/TranscriptionButton.vue';
import CreateMenu from './components/CreateMenu.vue';
import PanelToggleButton from './components/PanelToggleButton.vue';

// 导入 composables
import { useAudioPlayback } from './composables/useAudioPlayback.js';
import { useProgressControl } from './composables/useProgressControl.js';
import { useCreateActions } from './composables/useCreateActions.js';
import { useTranscriptionRequest } from './composables/useTranscriptionRequest.js';

const props = defineProps({
  blockId: { type: String, required: true },
  audioUrl: { type: String, required: true },
  duration: { type: Number, default: 0 },
  autoplay: { type: Boolean, default: false },
  transcriptionState: { type: String, default: 'idle' }
});

const emit = defineEmits(['error', 'loaded']);
const notificationStore = useNotificationStore();
const runtimeStore = useAudioRuntimeStore();
const { editorMessage } = useEditorLocalization();
const audioPlayerRef = ref(null);
const progressBarRef = ref(null);

// 监听转录状态变化，完成时显示通知
watch(() => props.transcriptionState, (newState, oldState) => {
  if (oldState === 'loading' && newState === 'success') {
    notificationStore.show(editorMessage('editor.audioBlock.toast.transcriptionCompleted'), 'success', 2000);
  } else if (oldState === 'loading' && newState === 'error') {
    notificationStore.show(editorMessage('editor.audioBlock.toast.transcriptionFailedRetry'), 'error', 3000);
  }
});

// 先初始化进度控制以获取 progress 和 currentTime ref
const {
  progress,
  progressContainerRef,
  currentTime,
  seek,
  startDrag,
} = useProgressControl(audioPlayerRef, props);

// 连接进度条容器 ref
watch(progressBarRef, (newVal) => {
  if (newVal?.containerRef) {
    progressContainerRef.value = newVal.containerRef;
  }
});

// 然后初始化播放控制，传入 progress 和 currentTime ref
const {
  isLoaded,
  isPlaying,
  errorMessage,
  togglePlay,
  updateProgress,
  handleEnded,
  handleLoadedMetadata,
  handleDurationChange,
  handleError,
} = useAudioPlayback(audioPlayerRef, props, emit, progress, currentTime);

const { handleCreateAction } = useCreateActions(props);
const { requestTranscription } = useTranscriptionRequest(props);

// 展开/隐藏内容面板
const isPanelVisible = computed(() => runtimeStore.getRuntime(props.blockId).isPanelVisible);

const togglePanel = () => {
  const currentState = runtimeStore.getRuntime(props.blockId).isPanelVisible;
  runtimeStore.updateRuntime(props.blockId, { isPanelVisible: !currentState });
};

// 格式化时间显示
const durationFormatted = computed(() => formatDuration(props.duration));
const currentTimeFormatted = computed(() => formatDuration(currentTime.value));

// AI按钮点击处理
const handleAiClick = async () => {
  try {
    await requestTranscription({ blockId: props.blockId, notify: true });
  } catch (error) {
    console.error('[AudioPlayer] 转录触发失败:', error);
  }
};

onMounted(() => {
  if (audioPlayerRef.value && props.audioUrl && !isLoaded.value) {
    audioPlayerRef.value.load();
  }
});

// 暴露给父组件的方法
defineExpose({
  audioPlayer: audioPlayerRef,
  reload: () => {
    if (audioPlayerRef.value) {
      audioPlayerRef.value.load();
      return true;
    }
    return false;
  },
  play: () => {
    if (audioPlayerRef.value && props.duration > 0) {
      return audioPlayerRef.value.play().catch(err => {
        console.warn('[AudioPlayer] Expose play() failed:', err);
        errorMessage.value = editorMessage('editor.audioBlock.status.playFailed');
        return false;
      });
    }
    return Promise.resolve(false);
  },
  pause: () => {
    if (audioPlayerRef.value) {
      audioPlayerRef.value.pause();
      return true;
    }
    return false;
  }
});
</script>
