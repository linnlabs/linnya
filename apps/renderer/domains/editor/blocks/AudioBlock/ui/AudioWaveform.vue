<!-- src/renderer/components/Block/AudioBlock/AudioWaveform.vue -->
 
<template>
  <div 
    class="audio-waveform"
    :class="{ 'is-recording': isRecording, 'is-paused': isPaused }"
  >
    <canvas ref="waveformCanvas" class="waveform-canvas"></canvas>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useAudioAnalyser } from '../composables/useAudioAnalyser';

const props = defineProps({
  isRecording: {
    type: Boolean,
    default: false
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  mediaStream: {
    type: Object,
    default: null
  }
});

// 引用和状态
const waveformCanvas = ref(null);
const analyserStarted = ref(false);

// 使用音频分析器Composable
const { start, pause, resume, stop, isActive } = useAudioAnalyser(waveformCanvas);

// 监听录音状态变化
watch(() => props.isRecording, async (newIsRecording) => {
  console.log(`[AudioWaveform] isRecording changed: ${newIsRecording}`);
  
  if (newIsRecording) {
    if (props.mediaStream) {
      analyserStarted.value = await start(props.mediaStream);
      console.log(`[AudioWaveform] Analyser started: ${analyserStarted.value}`);
    }
  } else {
    await stop(false); // 不完全清理AudioContext，只是暂停
    analyserStarted.value = false;
  }
}, { immediate: false });

// 监听暂停状态变化
watch(() => props.isPaused, async (newIsPaused) => {
  console.log(`[AudioWaveform] isPaused changed: ${newIsPaused}`);
  
  if (!props.isRecording) return;
  
  if (newIsPaused) {
    await pause();
  } else {
    await resume();
  }
}, { immediate: false });

// 监听媒体流变化
watch(() => props.mediaStream, async (newStream, oldStream) => {
  console.log(`[AudioWaveform] mediaStream changed. New: ${newStream !== null}`);
  
  if (newStream && props.isRecording) {
    analyserStarted.value = await start(newStream);
    console.log(`[AudioWaveform] Analyser started with new stream: ${analyserStarted.value}`);
  } else if (!newStream) {
    await stop(true); // 彻底清理
    analyserStarted.value = false;
  }
}, { immediate: false });

// 组件挂载
onMounted(() => {
  console.log('[AudioWaveform] Mounted');
  
  // 在挂载时，如果已经在录音并且有媒体流，启动分析器
  if (props.isRecording && props.mediaStream) {
    nextTick(async () => {
      analyserStarted.value = await start(props.mediaStream);
      console.log(`[AudioWaveform] Analyser started on mount: ${analyserStarted.value}`);
    });
  }
});

// 组件卸载
onBeforeUnmount(() => {
  console.log('[AudioWaveform] Before Unmount');
  // useAudioAnalyser内部会在onBeforeUnmount中进行清理
});
</script>
