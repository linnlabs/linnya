/**
 * @file useProgressControl.js
 * @brief 进度条拖拽和跳转控制
 * 
 * @description
 * 负责进度条的点击跳转、拖拽操作，以及 Store 跳转请求的监听
 */

import { ref, watch, onUnmounted } from 'vue';
import { useNotificationStore } from '@/app/notification';
import { useAudioRuntimeStore } from '../../store';
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage';

export function useProgressControl(audioPlayerRef, props) {
  const notificationStore = useNotificationStore();
  const runtimeStore = useAudioRuntimeStore();
  
  const progress = ref(0);
  const progressContainerRef = ref(null);
  const isDragging = ref(false);
  const currentTime = ref(0);

  /**
   * 点击进度条跳转
   */
  const seek = (event) => {
    if (!audioPlayerRef.value) return;
    if (props.duration <= 0) {
      console.warn('[AudioPlayer] Seek failed: duration is 0 or invalid.');
      notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.durationUnknownSeek'), 'info', 2000);
      return;
    }
    
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    let clickX = event.clientX - rect.left;
    const width = rect.width;
    if (width === 0) return;

    let percent = clickX / width;
    percent = Math.max(0, Math.min(1, percent));

    progress.value = percent * 100;
    const newTime = percent * props.duration;
    if (isFinite(newTime)) {
      audioPlayerRef.value.currentTime = newTime;
      currentTime.value = newTime;
    }
  };

  /**
   * 开始拖拽
   */
  const startDrag = (event) => {
    if (!audioPlayerRef.value) return;
    if (props.duration <= 0) {
      console.warn('[AudioPlayer] Drag failed: duration is 0 or invalid.');
      notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.durationUnknownDrag'), 'info', 2000);
      return;
    }
    isDragging.value = true;
    updateDragPosition(event);
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    event.preventDefault();
  };

  /**
   * 拖拽中
   */
  const handleDrag = (event) => {
    if (!isDragging.value) return;
    updateDragPosition(event);
    event.preventDefault();
  };

  /**
   * 更新拖拽位置
   */
  const updateDragPosition = (event) => {
    if (!progressContainerRef.value || !audioPlayerRef.value) return;
    if (props.duration <= 0) return;

    const rect = progressContainerRef.value.getBoundingClientRect();
    const width = rect.width;
    if (width === 0) return;

    let x = event.clientX - rect.left;
    let percent = x / width;
    percent = Math.max(0, Math.min(1, percent));

    progress.value = percent * 100;
    const newTime = percent * props.duration;
    if (isFinite(newTime)) {
      audioPlayerRef.value.currentTime = newTime;
      currentTime.value = newTime;
    }
  };

  /**
   * 停止拖拽
   */
  const stopDrag = () => {
    isDragging.value = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  };

  /**
   * 监听 Store 中的跳转请求
   */
  watch(() => runtimeStore.getRuntime(props.blockId).seekToTimeRequest, (newRequest) => {
    if (!newRequest || !audioPlayerRef.value) return;
    
    console.log('[AudioPlayer] 接收到跳转请求:', newRequest);
    
    const targetTime = newRequest.time;
    if (typeof targetTime === 'number' && isFinite(targetTime) && targetTime >= 0) {
      audioPlayerRef.value.currentTime = targetTime;
      currentTime.value = targetTime;
      
      if (props.duration > 0) {
        progress.value = (targetTime / props.duration) * 100;
      }
      
      // 跳转后自动播放
      if (audioPlayerRef.value.paused) {
        audioPlayerRef.value.play().catch(err => {
          console.warn('[AudioPlayer] 跳转后自动播放失败:', err);
        });
      }
      
      runtimeStore.clearSeekRequest(props.blockId);
      console.log('[AudioPlayer] 跳转请求已处理并清除');
    }
  });

  /**
   * 清理拖拽事件监听
   */
  onUnmounted(() => {
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  });

  return {
    progress,
    progressContainerRef,
    currentTime,
    isDragging,
    seek,
    startDrag,
  };
}
