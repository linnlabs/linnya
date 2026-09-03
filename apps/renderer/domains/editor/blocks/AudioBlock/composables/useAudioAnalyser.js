import { ref, shallowRef, onBeforeUnmount, watch } from 'vue';
import WaveformRenderer from '../ui/WaveformRenderer';

/**
 * 音频分析器 Composable
 * 
 * 为Vue组件提供音频分析和波形图渲染功能
 * 内部管理AudioContext和相关资源的生命周期
 * 
 * @param {import('vue').Ref} canvasRef Canvas元素的引用
 */
export function useAudioAnalyser(canvasRef) {
  // 使用shallowRef存放大型对象，避免Vue深度监听带来的性能开销
  const audioContext = shallowRef(null);
  const analyser = shallowRef(null);
  const source = shallowRef(null);
  const mediaStream = shallowRef(null);
  
  // 状态
  const isActive = ref(false);
  const isPaused = ref(false);
  const isContextSuspended = ref(false);
  
  // 渲染器
  let renderer = null;
  
  /**
   * 初始化音频分析器
   * @param {MediaStream} stream 媒体流
   */
  async function initialize(stream) {
    if (!stream || !canvasRef.value) {
      console.warn('[useAudioAnalyser] Cannot initialize: missing stream or canvas');
      return false;
    }
    
    // 如果当前已有上下文，则尝试恢复使用，而非重新创建
    if (audioContext.value) {
      if (audioContext.value.state === 'suspended') {
        try {
          await audioContext.value.resume();
          console.log('[useAudioAnalyser] Resumed existing AudioContext');
          isContextSuspended.value = false;
        } catch (error) {
          console.error('[useAudioAnalyser] Failed to resume AudioContext:', error);
          // 如果恢复失败，则关闭当前上下文并创建新的
          await cleanup(true);
        }
      }
    }
    
    // 如果没有可用的上下文，创建新的
    if (!audioContext.value) {
      try {
        audioContext.value = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[useAudioAnalyser] Created new AudioContext');
      } catch (error) {
        console.error('[useAudioAnalyser] Failed to create AudioContext:', error);
        return false;
      }
    }
    
    try {
      // 创建分析器
      analyser.value = audioContext.value.createAnalyser();
      analyser.value.fftSize = 256;
      const bufferLength = analyser.value.frequencyBinCount;
      
      // 连接到媒体流
      mediaStream.value = stream;
      source.value = audioContext.value.createMediaStreamSource(stream);
      source.value.connect(analyser.value);
      
      // 监听流的结束事件
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          console.log('[useAudioAnalyser] Audio track ended');
          stop();
        };
      });
      
      // 设置渲染器
      if (canvasRef.value) {
        const canvasCtx = canvasRef.value.getContext('2d');
        if (!canvasCtx) {
          console.error('[useAudioAnalyser] Failed to get canvas context');
          return false;
        }
        
        renderer = new WaveformRenderer(
          analyser.value, 
          canvasCtx, 
          bufferLength,
          { isPaused: isPaused.value }
        );
        
        // 设置画布尺寸 - 考虑 devicePixelRatio 以提高清晰度
        const canvas = canvasRef.value;
        const rect = canvas.getBoundingClientRect(); // 获取CSS像素尺寸

        const dpr = window.devicePixelRatio || 1;
        // 计算实际绘图表面需要的像素数量，并四舍五入到整数
        const newCanvasDrawingWidth = Math.round(rect.width * dpr);
        const newCanvasDrawingHeight = Math.round(rect.height * dpr);

        // 仅当尺寸有变化时才更新canvas的width/height属性，避免不必要的重绘
        // 并确保尺寸大于0，以防止无效的canvas尺寸
        if ((canvas.width !== newCanvasDrawingWidth || canvas.height !== newCanvasDrawingHeight) && 
            newCanvasDrawingWidth > 0 && newCanvasDrawingHeight > 0) {
          canvas.width = newCanvasDrawingWidth;
          canvas.height = newCanvasDrawingHeight;
        }
        
        // WaveformRenderer 使用这些调整后的尺寸进行绘制
        // 如果canvas.width/height由于rect为0而未改变，则renderer使用其默认或旧值
        renderer.updateCanvasSize(canvas.width, canvas.height);
        
        // CSS样式 (width: 100%, height: 100%) 会将这个高分辨率的绘图表面
        // 缩放到canvas元素的显示尺寸，从而在HDPI屏幕上获得更清晰的图像。
      }
      
      isActive.value = true;
      return true;
    } catch (error) {
      console.error('[useAudioAnalyser] Failed to setup analyser:', error);
      await cleanup(true);
      return false;
    }
  }
  
  /**
   * 开始分析和渲染
   * @param {MediaStream} stream 媒体流
   * @returns {Promise<boolean>} 是否成功启动
   */
  async function start(stream) {
    if (isActive.value && !isPaused.value) {
      console.log('[useAudioAnalyser] Already active');
      return true;
    }
    
    if (!stream) {
      console.warn('[useAudioAnalyser] No stream provided');
      return false;
    }
    
    let success = false;
    
    // 如果当前处于暂停状态，且媒体流相同，则直接恢复
    if (isActive.value && isPaused.value && mediaStream.value === stream) {
      isPaused.value = false;
      if (renderer) {
        renderer.setPaused(false);
        renderer.start();
      }
      success = true;
    } else {
      // 否则，初始化新的分析
      success = await initialize(stream);
      if (success && renderer) {
        renderer.start();
      }
    }
    
    return success;
  }
  
  /**
   * 暂停分析和渲染
   * @returns {Promise<boolean>} 是否成功暂停
   */
  async function pause() {
    if (!isActive.value || isPaused.value) {
      return false;
    }
    
    isPaused.value = true;
    if (renderer) {
      renderer.setPaused(true);
    }
    
    return true;
  }
  
  /**
   * 恢复分析和渲染
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async function resume() {
    if (!isActive.value || !isPaused.value) {
      return false;
    }
    
    isPaused.value = false;
    if (renderer) {
      renderer.setPaused(false);
    }
    
    return true;
  }
  
  /**
   * 停止分析和渲染
   * @param {boolean} fullCleanup 是否完全清理资源（包括关闭AudioContext）
   * @returns {Promise<boolean>} 是否成功停止
   */
  async function stop(fullCleanup = false) {
    return await cleanup(fullCleanup);
  }
  
  /**
   * 清理资源
   * @param {boolean} fullCleanup 是否完全清理（包括关闭AudioContext）
   * @returns {Promise<boolean>} 是否成功清理
   */
  async function cleanup(fullCleanup = false) {
    if (!isActive.value && !mediaStream.value) {
      return true;
    }
    
    console.log(`[useAudioAnalyser] Cleaning up (full: ${fullCleanup})`);
    
    // 停止渲染器
    if (renderer) {
      renderer.stop();
      renderer = null;
    }
    
    // 断开连接
    if (source.value) {
      try {
        source.value.disconnect();
      } catch (e) {
        console.warn('[useAudioAnalyser] Error disconnecting source:', e);
      }
      source.value = null;
    }
    
    if (analyser.value) {
      try {
        analyser.value.disconnect();
      } catch (e) {
        console.warn('[useAudioAnalyser] Error disconnecting analyser:', e);
      }
      analyser.value = null;
    }
    
    if (audioContext.value) {
      if (fullCleanup) {
        // 完全关闭
        try {
          if (audioContext.value.state !== 'closed') {
            await audioContext.value.close();
            console.log('[useAudioAnalyser] AudioContext closed');
          }
          audioContext.value = null;
        } catch (e) {
          console.warn('[useAudioAnalyser] Error closing audio context:', e);
        }
      } else {
        // 暂停而非关闭
        try {
          if (audioContext.value.state === 'running') {
            await audioContext.value.suspend();
            isContextSuspended.value = true;
            console.log('[useAudioAnalyser] AudioContext suspended');
          }
        } catch (e) {
          console.warn('[useAudioAnalyser] Error suspending audio context:', e);
        }
      }
    }
    
    mediaStream.value = null;
    isActive.value = false;
    isPaused.value = false;
    
    return true;
  }
  
  // 在组件卸载前进行完全清理
  onBeforeUnmount(() => {
    cleanup(true);
  });
  
  // 在窗口关闭前清理所有资源
  if (typeof window !== 'undefined') {
    const handleBeforeUnload = () => {
      cleanup(true);
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  }
  
  return {
    start,
    pause,
    resume,
    stop,
    isActive,
    isPaused
  };
}

export default useAudioAnalyser; 