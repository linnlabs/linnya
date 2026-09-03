// src/renderer/extensions/annotation/utils/autoResize.js
/**
 * autoResize.js
 * 
 * 文本框自动高度调整的自定义指令
 * 职责:
 * 1. 根据内容自动调整textarea的高度
 * 2. 在输入时实时调整
 * 3. 处理挂载和卸载的清理工作
 */

import { nextTick } from 'vue';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

// 调整大小的核心函数
function resize(textarea) {
  if (!textarea) return;
  
  // 记录当前滚动位置
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  const newHeight = applyTextareaAutoResize(textarea);
  
  // 恢复滚动位置，防止页面跳动
  window.scrollTo({top: scrollTop});
  
  // 触发自定义事件，通知高度已改变 (使用 newHeight)
  textarea.dispatchEvent(new CustomEvent('autoresize', {
    detail: {
      height: newHeight, // 使用计算后的 newHeight
      element: textarea
    },
    bubbles: true
  }));
}

// 输入事件处理函数
function onInput(event) {
  resize(event.target);
}

// 定义自定义指令对象
const autoResize = {
  // 指令挂载到元素上时
  mounted(el, binding) {
    // 确保元素是textarea
    if (el.tagName !== 'TEXTAREA') {
      console.warn('v-autoresize只能用于textarea元素');
      return;
    }
    
    // 设置默认样式: 不允许手动调整大小，由指令控制
    el.style.overflow = 'hidden';
    el.style.resize = 'none';
    
    // 如果传入了参数，可以进行额外配置
    if (binding.value) {
      // 例如: v-autoresize="{ minHeight: '100px' }"
      if (binding.value.minHeight) {
        el.style.minHeight = binding.value.minHeight;
      }
    }

    // 初始时立即执行一次
    nextTick(() => {
      resize(el);
    });

    // 监听input事件，每次输入都重新计算高度
    el.addEventListener('input', onInput);
    
    // 存储事件处理函数引用，用于卸载时移除
    el._autoResizeInputHandler = onInput;
  },
  
  // 元素更新时
  updated(el) {
    // 确保在值变化后更新高度（例如通过v-model改变）
    nextTick(() => {
      resize(el);
    });
  },
  
  // 组件卸载前移除事件监听
  unmounted(el) {
    // 移除事件监听
    if (el._autoResizeInputHandler) {
      el.removeEventListener('input', el._autoResizeInputHandler);
      delete el._autoResizeInputHandler;
    }
  }
};

// 以默认方式导出
export default autoResize;

// 提供一个用于全局注册的辅助函数
export function registerAutoResizeDirective(app) {
  app.directive('autoresize', autoResize);
}
