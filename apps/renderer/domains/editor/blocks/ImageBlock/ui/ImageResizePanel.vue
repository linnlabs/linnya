<template>
  <Transition name="resize-panel-fade">
    <div
      v-if="isVisible"
      class="image-resize-panel"
      :style="panelStyle"
      @keydown.esc.prevent="handleCancel"
      @mousedown.stop
    >
      <div class="resize-panel-main-content">
        <div class="resize-input-group">
          <label for="img-width-input">{{ editorMessage('editor.imageBlock.resize.width') }}</label>
          <CustomNumberInput
            id="img-width-input"
            ref="widthInputRef"
            :model-value="widthInput"
            :input-width="72"
            align="left"
            :full-width="true"
            :show-spin-buttons="true"
            :min="36"
            :max="740"
            :step="1"
            @update:model-value="handleWidthInput"
            @keydown.enter.prevent="handleSubmit"
            @step-up="adjustWidth(1)"
            @step-down="adjustWidth(-1)"
          />
          <button
            class="resize-panel-button submit"
            :disabled="!isInputValid"
            @click="handleSubmit"
          >
            {{ editorMessage('editor.imageBlock.resize.confirm') }}
          </button>
          
          <label for="img-height-input">{{ editorMessage('editor.imageBlock.resize.height') }}</label>
          <CustomNumberInput
            id="img-height-input"
            :model-value="heightInput"
            :input-width="72"
            align="left"
            :full-width="true"
            :show-spin-buttons="true"
            :min="36"
            :step="1"
            @update:model-value="handleHeightInput"
            @keydown.enter.prevent="handleSubmit"
            @step-up="adjustHeight(1)"
            @step-down="adjustHeight(-1)"
          />
          <button
            class="resize-panel-button cancel"
            @click="handleCancel"
          >
            {{ editorMessage('editor.imageBlock.resize.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { CustomNumberInput } from '@linnya/renderer-ui';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

// Props
const props = defineProps({
  isVisible: {
    type: Boolean,
    default: false
  },
  initialWidth: {
    type: Number,
    default: 0
  },
  initialHeight: {
    type: Number,
    default: 0
  },
  naturalWidth: {
    type: Number,
    default: 0
  },
  naturalHeight: {
    type: Number,
    default: 0
  },
  position: {
    type: Object,
    default: () => ({ top: 0, left: 0 })
  }
});

// Emits
const emit = defineEmits(['confirm', 'cancel']);
const { editorMessage } = useEditorLocalization();

// Refs
const widthInputRef = ref(null);
const widthInput = ref(0);
const heightInput = ref(0);

// Constants
const MAX_WIDTH = 740;

// Computed
const panelStyle = computed(() => ({
  position: 'fixed',
  top: `${props.position.top}px`,
  left: `${props.position.left}px`,
  zIndex: 1100,
}));

const isInputValid = computed(() => {
  return widthInput.value >= 36 && heightInput.value >= 36;
});

// Methods
const updateHeightFromWidth = () => {
  // 应用最大宽度限制
  if (widthInput.value > MAX_WIDTH) {
    widthInput.value = MAX_WIDTH;
  }
  
  if (props.naturalWidth > 0 && widthInput.value > 0) {
    const aspectRatio = props.naturalHeight / props.naturalWidth;
    heightInput.value = Math.round(widthInput.value * aspectRatio);
  }
};

const updateWidthFromHeight = () => {
  if (props.naturalHeight > 0 && heightInput.value > 0) {
    const aspectRatio = props.naturalWidth / props.naturalHeight;
    let calculatedWidth = Math.round(heightInput.value * aspectRatio);
    
    // 应用最大宽度限制
    if (calculatedWidth > MAX_WIDTH) {
      calculatedWidth = MAX_WIDTH;
      // 如果宽度被限制，重新计算高度
      const newAspectRatio = props.naturalHeight / props.naturalWidth;
      heightInput.value = Math.round(calculatedWidth * newAspectRatio);
    }
    
    widthInput.value = calculatedWidth;
  }
};

const handleWidthInput = (value) => {
  widthInput.value = value;
  updateHeightFromWidth();
};

const handleHeightInput = (value) => {
  heightInput.value = value;
  updateWidthFromHeight();
};

// Custom spin button handlers
const adjustWidth = (delta) => {
  const currentVal = widthInput.value || 0;
  const newVal = currentVal + delta;
  if (newVal >= 36 && newVal <= MAX_WIDTH) {
    widthInput.value = newVal;
    updateHeightFromWidth();
  }
};

const adjustHeight = (delta) => {
  const currentVal = heightInput.value || 0;
  const newVal = currentVal + delta;
  if (newVal >= 36) {
    heightInput.value = newVal;
    updateWidthFromHeight();
  }
};

const handleSubmit = () => {
  if (!isInputValid.value) return;
  
  emit('confirm', {
    width: parseInt(widthInput.value, 10),
    height: parseInt(heightInput.value, 10)
  });
};

const handleCancel = () => {
  emit('cancel');
};

// Watchers
watch(() => props.isVisible, (isVisible) => {
  if (isVisible) {
    let initialWidth = props.initialWidth || props.naturalWidth || 0;
    let initialHeight = props.initialHeight || props.naturalHeight || 0;
    
    // 确保初始宽度不超过最大限制
    if (initialWidth > MAX_WIDTH) {
      initialWidth = MAX_WIDTH;
      // 如果宽度被限制，根据比例重新计算高度
      if (props.naturalWidth > 0 && props.naturalHeight > 0) {
        const aspectRatio = props.naturalHeight / props.naturalWidth;
        initialHeight = Math.round(initialWidth * aspectRatio);
      }
    }
    
    widthInput.value = initialWidth;
    heightInput.value = initialHeight;
    
    nextTick(() => {
      window.setTimeout(() => {
        if (widthInputRef.value) {
          widthInputRef.value.focus();
          widthInputRef.value.select();
        }
      }, 10);
    });
  }
});
</script>
