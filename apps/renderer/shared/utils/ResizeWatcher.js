// src/renderer/utils/ResizeWatcher.js

/**
 * ResizeWatcher.js
 * 
 * 封装 ResizeObserver API 的工具类，提供元素尺寸变化监听功能
 * 支持配置节流和变化阈值
 */

import { throttle } from 'lodash';

export class ResizeWatcher {
  /**
   * 创建一个尺寸变化监听器
   * @param {Object} options - 配置选项
   * @param {Function} options.onResize - 尺寸变化回调函数，接收 entry 参数
   * @param {number} options.throttleDelay - 节流延迟时间(ms)，默认 200ms
   * @param {number} options.heightThreshold - 高度变化阈值(px)，超过此值才触发回调，默认 5px
   * @param {boolean} options.watchWidth - 是否监听宽度变化，默认 false
   * @param {boolean} options.watchHeight - 是否监听高度变化，默认 true
   */
  constructor(options = {}) {
    this.options = {
      onResize: () => {},
      throttleDelay: 200,
      heightThreshold: 5,
      watchWidth: false,
      watchHeight: true,
      ...options
    };
    
    this.observer = null;
    this.observedElements = new Map(); // 用于存储被观察的元素和它们的之前尺寸
    this.throttledHandler = throttle(this._handleResize.bind(this), this.options.throttleDelay);
    
    this._init();
  }
  
  /**
   * 初始化 ResizeObserver
   * @private
   */
  _init() {
    if (typeof window === 'undefined' || !window.ResizeObserver) {
      console.warn('[ResizeWatcher] ResizeObserver not supported in this environment');
      return;
    }
    
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.throttledHandler(entry);
      }
    });
  }
  
  /**
   * 处理尺寸变化
   * @param {ResizeObserverEntry} entry - ResizeObserver 回调的 entry 对象
   * @private
   */
  _handleResize(entry) {
    const element = entry.target;
    const previousDimensions = this.observedElements.get(element) || {
      width: entry.contentRect.width,
      height: entry.contentRect.height
    };
    
    const currentDimensions = {
      width: entry.contentRect.width,
      height: entry.contentRect.height
    };
    
    let shouldTrigger = false;
    
    // 检查高度变化
    if (this.options.watchHeight) {
      const heightChange = Math.abs(currentDimensions.height - previousDimensions.height);
      if (heightChange > this.options.heightThreshold) {
        shouldTrigger = true;
      }
    }
    
    // 检查宽度变化
    if (this.options.watchWidth) {
      const widthChange = Math.abs(currentDimensions.width - previousDimensions.width);
      if (widthChange > this.options.heightThreshold) {
        shouldTrigger = true;
      }
    }
    
    // 更新存储的尺寸
    this.observedElements.set(element, currentDimensions);
    
    // 触发回调
    if (shouldTrigger) {
      this.options.onResize(entry, {
        previousDimensions,
        currentDimensions,
        element
      });
    }
  }
  
  /**
   * 开始观察元素的尺寸变化
   * @param {HTMLElement} element - 要观察的 DOM 元素
   * @returns {boolean} - 是否成功开始观察
   */
  observe(element) {
    if (!this.observer || !element) {
      return false;
    }
    
    try {
      this.observer.observe(element);
      this.observedElements.set(element, null); // 初始尺寸将在首次回调中设置
      return true;
    } catch (error) {
      console.error('[ResizeWatcher] Failed to observe element:', error);
      return false;
    }
  }
  
  /**
   * 停止观察特定元素
   * @param {HTMLElement} element - 要停止观察的 DOM 元素
   */
  unobserve(element) {
    if (!this.observer || !element) {
      return;
    }
    
    try {
      this.observer.unobserve(element);
      this.observedElements.delete(element);
    } catch (error) {
      console.error('[ResizeWatcher] Failed to unobserve element:', error);
    }
  }
  
  /**
   * 清理资源，停止所有观察
   */
  disconnect() {
    if (!this.observer) {
      return;
    }
    
    try {
      this.observer.disconnect();
      this.observedElements.clear();
      
      // 取消正在进行的节流函数
      if (this.throttledHandler && this.throttledHandler.cancel) {
        this.throttledHandler.cancel();
      }
    } catch (error) {
      console.error('[ResizeWatcher] Failed to disconnect observer:', error);
    }
  }
}

export default ResizeWatcher; 