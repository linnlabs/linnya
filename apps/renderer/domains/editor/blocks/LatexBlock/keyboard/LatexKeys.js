import { useLatexEditorStore } from '../../../stores/latexEditor'; 

// 定义调试标志和日志函数
const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) {
    console.log('[LatexKeys]', ...args);
  }
};

/**
 * 检查当前事件是否发生在激活的 LaTeX 输入面板中
 * @param {Event} event - Keydown event
 * @returns {boolean}
 */
function isEventInLatexPanel(event) {
    const latexStore = useLatexEditorStore();
    if (!latexStore.isPanelVisible) {
        return false;
    }
    // 检查事件目标是否是面板内的 textarea
    // 注意：这依赖于面板内部结构，如果 DOM 改变可能需要调整
    const target = event.target;
    return target && target.tagName === 'TEXTAREA' && target.classList.contains('latex-panel-textarea');
}

/**
 * 处理在 LaTeX 面板中按下 Enter 键 (提交)
 * @param {object} context - 包含 view, event, latexStore 等的对象
 * @returns {boolean} - 是否处理了该事件
 */
export function handleLatexEnter({ event }) {
    if (!isEventInLatexPanel(event)) {
        return false;
    }
    
    // 阻止默认行为 (如果还没被阻止) 并在特定处理函数中提交
    event.preventDefault();
    debugLog('Handling Enter in LaTeX Panel');

    // 获取 store 实例并调用提交逻辑 (需要从外部触发，例如通过 Pinia action)
    const latexStore = useLatexEditorStore();
    
    // 找到 LatexInputPanel.vue 中的 handleSubmit 逻辑
    // 这里不能直接调用组件方法，需要通过 store 或其他方式触发
    // 假设 store 有一个 submit 方法 (需要添加)
    if (latexStore.submitCurrentLatex) { 
        latexStore.submitCurrentLatex();
    } else {
        console.warn('[LatexKeys] latexStore.submitCurrentLatex method not found!');
    }

    return true; // 事件已被处理
}

/**
 * 处理在 LaTeX 面板中按下 Shift + Enter 键 (换行)
 * @param {object} context - 包含 view, event, latexStore 等的对象
 * @returns {boolean} - 是否处理了该事件
 */
export function handleLatexShiftEnter({ event }) {
    if (!isEventInLatexPanel(event)) {
        return false;
    }

    // 显式处理换行
    debugLog('Handling Shift+Enter in LaTeX Panel');
    
    const textarea = event.target;
    const currentVal = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;

    // 在光标位置插入换行符
    const newValue = currentVal.substring(0, selectionStart) + '\n' + currentVal.substring(selectionEnd);
    
    // 更新 textarea 的值
    // 注意：直接修改 value 可能不会触发 Vue 的响应式更新，需要通过 store
    const latexStore = useLatexEditorStore();
    latexStore.updateSource(newValue); 
    
    // 手动将光标移动到换行符之后
    // 需要在 nextTick 中执行，因为 store 更新可能是异步的
    requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + 1;
        textarea.selectionEnd = selectionStart + 1;
        
        // 触发一次自动调整大小 (假设 store 更新后 autoResize 会自动运行，
        // 或者需要一个方法来手动触发，例如 latexStore.triggerResize())
        // 如果 autoResizeTextarea 在组件内部，这里无法直接调用
        // 更好的方式是让组件 watch store.currentSource 的变化并自动调整
    });


    event.preventDefault(); // 阻止默认的换行行为（如果需要精确控制）
    return true; // 事件已被处理
}

// 可能还需要处理 Esc 键来取消，但这已在 LatexInputPanel.vue 中通过 @keydown.esc 实现 