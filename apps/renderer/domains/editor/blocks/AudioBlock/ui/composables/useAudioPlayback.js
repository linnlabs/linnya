/**
 * @file useAudioPlayback.js
 * @brief 音频播放核心逻辑
 * 
 * @description
 * 负责音频播放、暂停、进度更新等核心功能
 */

import { ref, watch } from 'vue';
import { useAudioRuntimeStore } from '../../store';
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage';

export function useAudioPlayback(audioPlayerRef, props, emit, progressRef, currentTimeRef) {
  const runtimeStore = useAudioRuntimeStore();
  
  const isLoaded = ref(false);
  const isPlaying = ref(false);
  const errorMessage = ref(null);
  const hasEmittedDuration = ref(false);

  /**
   * 播放/暂停切换
   */
  const togglePlay = () => {
    if (!audioPlayerRef.value) {
      console.warn("[AudioPlayer] Audio element ref is not available for togglePlay.");
      return;
    }

    if (props.duration <= 0) {
      console.warn("[AudioPlayer] Attempting to play, but duration is currently 0 or invalid.");
    }

    if (isPlaying.value) {
      audioPlayerRef.value.pause();
    } else {
      const playPromise = audioPlayerRef.value.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('[AudioPlayer] Play failed:', err);
          errorMessage.value = resolveCurrentEditorMessage('editor.audioBlock.status.playFailed');
        });
      }
    }
  };

  /**
   * 更新播放进度
   */
  const updateProgress = () => {
    if (!audioPlayerRef.value) return;
    if (currentTimeRef) {
      currentTimeRef.value = audioPlayerRef.value.currentTime;
    }
    
    // 同步当前播放时间到 Store
    runtimeStore.updateRuntime(props.blockId, { currentPlayTime: audioPlayerRef.value.currentTime });
    
    // 更新进度条
    if (progressRef && props.duration > 0) {
      progressRef.value = (audioPlayerRef.value.currentTime / props.duration) * 100;
    } else if (progressRef) {
      progressRef.value = 0;
    }
  };

  /**
   * 播放结束处理
   */
  const handleEnded = () => {
    isPlaying.value = false;
    if (currentTimeRef) {
      currentTimeRef.value = 0;
    }
    if (progressRef) {
      progressRef.value = 0;
    }
  };

  /**
   * 加载元数据
   */
  const handleLoadedMetadata = () => {
    isLoaded.value = true;
    
    const elementDuration = audioPlayerRef.value?.duration;
    
    if (elementDuration && isFinite(elementDuration) && elementDuration > 0) {
      const roundedElementDuration = Math.round(elementDuration);
      const roundedPropsDuration = Math.round(props.duration);
      
      if (!hasEmittedDuration.value || roundedElementDuration !== roundedPropsDuration) {
        console.log(`[AudioPlayer] 时长验证: props=${props.duration}s, element=${elementDuration}s`);
        emit('loaded', { 
          duration: elementDuration, 
          blockId: props.blockId 
        });
        hasEmittedDuration.value = true;
      }
    }

    if (props.autoplay && audioPlayerRef.value && props.duration > 0) {
      audioPlayerRef.value.play().catch(err => console.warn('[AudioPlayer] Autoplay failed:', err));
    }
  };

  /**
   * 时长变化处理
   */
  const handleDurationChange = () => {
    const elementDuration = audioPlayerRef.value?.duration;
    if (elementDuration && isFinite(elementDuration) && elementDuration > 0) {
      const roundedElementDuration = Math.round(elementDuration);
      const roundedPropsDuration = Math.round(props.duration);
      
      if (!hasEmittedDuration.value || roundedElementDuration !== roundedPropsDuration) {
        console.log(`[AudioPlayer] 时长更新 (durationchange): element=${elementDuration}s`);
        emit('loaded', { 
          duration: elementDuration, 
          blockId: props.blockId 
        });
        hasEmittedDuration.value = true;
      }
    }
  };

  /**
   * 错误处理
   */
  const handleError = (event) => {
    const error = event.target.error;
    console.error('[AudioPlayer] Audio error:', error);
    errorMessage.value = resolveCurrentEditorMessage('editor.audioBlock.status.audioError');
    emit('error', { error, blockId: props.blockId });
  };

  /**
   * 监听 URL 变化，重置状态
   */
  watch(() => props.audioUrl, (newUrl, oldUrl) => {
    if (newUrl !== oldUrl) {
      isLoaded.value = false;
      isPlaying.value = false;
      if (currentTimeRef) {
        currentTimeRef.value = 0;
      }
      errorMessage.value = null;
      hasEmittedDuration.value = false;

      if (audioPlayerRef.value) {
        audioPlayerRef.value.load();
      }
    }
  }, { immediate: false });

  return {
    isLoaded,
    isPlaying,
    errorMessage,
    togglePlay,
    updateProgress,
    handleEnded,
    handleLoadedMetadata,
    handleDurationChange,
    handleError,
  };
}
