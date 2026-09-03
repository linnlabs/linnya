/**
 * 现代化音频波形渲染控制器
 * 负责管理波形图的渲染循环，与组件生命周期解耦
 */
export class WaveformRenderer {
  constructor(analyser, canvasCtx, bufferLength, options = {}) {
    this.analyser = analyser;
    this.canvasCtx = canvasCtx; 
    this.bufferLength = bufferLength;
    this.dataArray = new Uint8Array(bufferLength);
    this.running = false;
    this.rafId = null;
    this.width = 0;
    this.height = 0;
    this.isPaused = options.isPaused || false;
    
    // 启用图像平滑以获得更好的线条效果
    if (this.canvasCtx) {
      this.canvasCtx.imageSmoothingEnabled = true;
      this.canvasCtx.webkitImageSmoothingEnabled = true;
      this.canvasCtx.mozImageSmoothingEnabled = true;
      this.canvasCtx.msImageSmoothingEnabled = true;
    }
    
    // 现代化配色方案：canvas 不能直接继承主题 token，因此从画布上的 CSS 变量读取。
    this.colors = {
      recording: {
        primary: this._resolveCanvasColor('--audio-waveform-recording-color', 'gray'),
      },
      paused: {
        primary: this._resolveCanvasColor('--audio-waveform-paused-color', 'color-mix(in srgb, gray 40%, transparent)'),
      }
    };
    
    // 柱状图参数
    this.amplification = 2.5;
    this.amplitudeHistory = [];
    this.historyLength = 200; // 默认历史长度
  }

  /**
   * 从 canvas 元素读取 CSS 变量，保证波形颜色跟随主题入口。
   * @private
   */
  _resolveCanvasColor(variableName, fallback) {
    const canvas = this.canvasCtx?.canvas;
    if (!canvas || typeof getComputedStyle !== 'function') {
      return fallback;
    }

    return getComputedStyle(canvas).getPropertyValue(variableName).trim() || fallback;
  }

  /**
   * 开始渲染循环
   */
  start() {
    if (this.running) return;
    
    console.log('[WaveformRenderer] Starting render loop');
    this.running = true;
    this._loop();
  }

  /**
   * 停止渲染循环
   */
  stop() {
    if (!this.running) return;
    
    console.log('[WaveformRenderer] Stopping render loop');
    this.running = false;
    
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 更新画布尺寸
   * @param {number} width 宽度
   * @param {number} height 高度
   */
  updateCanvasSize(width, height) {
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      this.width = width;
      this.height = height;

      // 根据画布宽度计算历史记录的长度
      const barWidth = 1; // 保持粗一点
      const barSpacing = 1; // 减小间距以降速
      this.historyLength = Math.floor(this.width / (barWidth + barSpacing));
      
      // 调整历史记录数组
      if (this.amplitudeHistory.length > this.historyLength) {
        this.amplitudeHistory = this.amplitudeHistory.slice(0, this.historyLength);
      } else {
        while (this.amplitudeHistory.length < this.historyLength) {
          // 用0填充，使启动时有一个平滑的动画
          this.amplitudeHistory.push(0);
        }
      }
    }
  }

  /**
   * 更新暂停状态
   * @param {boolean} isPaused 是否暂停
   */
  setPaused(isPaused) {
    this.isPaused = isPaused;
  }

  /**
   * 渲染循环
   * @private
   */
  _loop() {
    if (!this.running) return;
    
    this.rafId = requestAnimationFrame(() => {
      try {
        this._render();
      } catch (error) {
        console.error('[WaveformRenderer] Render error:', error);
        this.stop();
      }
      
      if (this.running) {
        this._loop();
      }
    });
  }

  /**
   * 执行实际的渲染 - 滑动柱状图
   * @private
   */
  _render() {
    if (!this.running || !this.analyser || !this.canvasCtx) {
      return;
    }
    
    try {
      this.analyser.getByteTimeDomainData(this.dataArray);
      
      const width = this.width;
      const height = this.height;
      
      if (width <= 0 || height <= 0) {
        return;
      }
      
      // 计算当前振幅 (RMS)
      let sumSquares = 0.0;
      for (let i = 0; i < this.bufferLength; i++) {
        const norm = (this.dataArray[i] / 128.0) - 1.0; // 归一化到 -1.0 to 1.0
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / this.bufferLength);
      
      // 更新历史记录
      this.amplitudeHistory.unshift(this.isPaused ? 0 : rms);
      if (this.amplitudeHistory.length > this.historyLength) {
        this.amplitudeHistory.pop();
      }
      
      // --- 绘制逻辑 ---
      this.canvasCtx.clearRect(0, 0, width, height);
      this._drawSlidingBars();
      
    } catch (error) {
      console.error('[WaveformRenderer] Render error in _render:', error);
      this.stop();
    }
  }

  /**
   * 绘制滑动的柱状波形
   * @private
   */
  _drawSlidingBars() {
    const ctx = this.canvasCtx;
    const width = this.width;
    const height = this.height;
    const activeColors = this.isPaused ? this.colors.paused : this.colors.recording;

    const barWidth = 1; // 保持粗一点
    const barSpacing = 1; // 减小间距以降速
    const step = barWidth + barSpacing;

    ctx.save();

    // 绘制所有历史记录中的柱子
    for (let i = 0; i < this.amplitudeHistory.length; i++) {
      const amplitude = this.amplitudeHistory[i] * this.amplification;
      
      // 确保柱子有最小高度，即使在静音时
      const barHeight = Math.max(2, amplitude * height * 0.8);
      
      const x = width - (i * step) - barWidth;
      const y = (height - barHeight) / 2;
      
      // 使用带圆角的线条来绘制柱子
      ctx.beginPath();
      ctx.moveTo(x + barWidth / 2, y);
      ctx.lineTo(x + barWidth / 2, y + barHeight);
      ctx.lineWidth = barWidth;
      ctx.strokeStyle = activeColors.primary; // 使用朴素的单色
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    
    ctx.restore();
  }
}

export default WaveformRenderer;
