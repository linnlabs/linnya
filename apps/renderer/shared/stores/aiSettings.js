import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getRendererPersistStorage } from '../persistence/rendererPersistStorage';

// TODO: 在主入口文件 (main.js 或类似文件) 确保 Pinia 实例已创建并传递给应用
// import { createPinia } from 'pinia'
// app.use(createPinia())

export const useAiSettingsStore = defineStore('aiSettings', () => {
  // --- State ---
  // 自动补全总开关，默认开启
  const isAutocompleteEnabled = ref(false); 
  // 段落内补全开关，默认开启
  const isIntraParagraphCompletionEnabled = ref(true); 
  // 重命名: 延迟等级 (1-5), 默认中等
  const delayLevel = ref(3); 
  // 修改: 频率等级 (1-6), 默认中等触发 (等级3)
  const frequencyLevel = ref(3); 
  // +++ 新增：程序化禁用 Autocomplete 的状态 +++
  const isProgrammaticallyDisabled = ref(false);

  // 补全长度偏好 (1=短, 2=中, 3=长)
  const completionLengthLevel = ref(2);  // 默认：中

  // --- Getters (Computed) ---
  // 触发延迟 (毫秒)
  const autocompleteDebounceMs = computed(() => {
    switch(delayLevel.value) {
      case 1: return 4000; // 极低 -> 4秒
      case 2: return 2500; // 较低 -> 2.5秒
      case 3: return 1500; // 中等 -> 1.5秒 (默认)
      case 4: return 1000; // 较高 -> 1秒
      case 5: return 500;  // 极高 -> 0.5秒
      default: return 1500;
    }
  });

  // 修改: 最小触发间隔 (毫秒), 基于 frequencyLevel
  const minTimeBetweenSuggestionsMs = computed(() => {
    // 使用一个简单的伪随机函数，基于frequencyLevel作为种子
    // 这确保了同一等级会生成相对稳定的随机值
    const getRandomInRange = (min, max, seed) => {
      // 简单的伪随机数生成，使用等级作为种子
      const seedValue = (seed * 9301 + 49297) % 233280;
      const rnd = seedValue / 233280;
      return Math.floor(min + rnd * (max - min));
    };

    switch(frequencyLevel.value) {
      case 1: return getRandomInRange(150, 210, 1) * 1000; // 等级1: 极低 -> 约2.5-3.5分钟随机
      case 2: return getRandomInRange(45, 75, 2) * 1000;   // 等级2: 较低 -> 约45-75秒随机
      case 3: return getRandomInRange(15, 30, 3) * 1000;   // 等级3: 中等 -> 约15-30秒随机
      case 4: return getRandomInRange(5, 12, 4) * 1000;    // 等级4: 较高 -> 约5-12秒随机
      case 5: return 3 * 1000;  // 等级5: 极高 -> 固定3秒
      case 6: return 0;         // 等级6: 总是允许
      default: return 0;
    }
  });
  
  // 获取对应的 Prompt 提示
  const completionLengthPromptHint = computed(() => {
    switch(completionLengthLevel.value) {
      case 1: return 'Output exactly 1 short sentence.';
      case 2: return 'Output 2-3 sentences.';
      case 3: return 'Output a full paragraph.';
      default: return 'Output 2-3 sentences.';
    }
  });


  // --- Actions ---
  function updateAutocompleteEnabled(value) {
    isAutocompleteEnabled.value = !!value; // 确保是布尔值
    // console.log('[AI Settings Store] Autocomplete enabled:', isAutocompleteEnabled.value);
  }

  function updateIntraParagraphCompletionEnabled(value) {
    isIntraParagraphCompletionEnabled.value = !!value;
    // console.log('[AI Settings Store] Intra-paragraph completion enabled:', isIntraParagraphCompletionEnabled.value);
  }

  // 重命名: 更新延迟等级
  function updateDelayLevel(value) { 
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 5) {
      delayLevel.value = numValue; // 更新 delayLevel
      // console.log('[AI Settings Store] Delay level updated:', delayLevel.value, '-> Debounce:', autocompleteDebounceMs.value);
    }
  }
  
  // 重命名: 更新频率等级
  function updateFrequencyLevel(value) { 
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 6) {
          frequencyLevel.value = numValue; // 更新 frequencyLevel
          // console.log('[AI Settings Store] Frequency level updated:', frequencyLevel.value, '-> Min time:', minTimeBetweenSuggestionsMs.value);
      }
  }

  // +++ 新增：用于程序化控制 Autocomplete 禁用的 Action +++
  function setProgrammaticAutocompleteDisabled(disabled) {
    isProgrammaticallyDisabled.value = !!disabled;
    // console.log('[AI Settings Store] Autocomplete programmatically disabled state:', isProgrammaticallyDisabled.value);
  }

  // 更新补全长度等级
  function updateCompletionLengthLevel(value) {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 3) {
      completionLengthLevel.value = numValue;
    }
  }

  return {
    // State
    isAutocompleteEnabled,
    isIntraParagraphCompletionEnabled,
    delayLevel, // 重命名 state
    frequencyLevel, // 使用 frequencyLevel
    isProgrammaticallyDisabled, // +++ 暴露新状态 +++
    completionLengthLevel, // 补全长度等级
    // Getters
    autocompleteDebounceMs,
    minTimeBetweenSuggestionsMs, // 新增 getter
    completionLengthPromptHint, // 补全长度 Prompt 提示
    // Actions
    updateAutocompleteEnabled,
    updateIntraParagraphCompletionEnabled,
    updateDelayLevel, // 重命名 action
    updateFrequencyLevel, // 使用 updateFrequencyLevel
    setProgrammaticAutocompleteDisabled, // +++ 暴露新 Action +++
    updateCompletionLengthLevel, // 更新补全长度等级
  }
}, {
  persist: {
    key: 'ai-settings',
    storage: getRendererPersistStorage(),
    // isProgrammaticallyDisabled 是临时状态，不需要持久化
    paths: ['isAutocompleteEnabled', 'isIntraParagraphCompletionEnabled', 'delayLevel', 'frequencyLevel', 'completionLengthLevel'],
  }
}); 
