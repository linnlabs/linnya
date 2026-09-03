<template>
  <div class="create-menu-container" ref="containerRef">
    <button 
      class="create-button" 
      :title="editorMessage('editor.audioBlock.action.transcribeAndCreate')"
      @click.stop="toggleMenu"
      ref="buttonRef"
    >
      <PlusCircleIcon class="plus-icon" />
    </button>
    
    <!-- 使用 Teleport 将菜单渲染到 body -->
    <Teleport to="body">
      <transition name="audio-create-menu-fade">
        <div 
          v-if="isMenuOpen" 
          :style="{ ...menuPosition, zIndex: 10000 }"
        >
          <CustomSelect
            :model-value="null"
            :options="selectOptions"
            :manual-mode="true"
            :external-trigger-ref="buttonRef"
            min-width="100px"
            @update:model-value="handleSelect"
            @close="handleClose"
          />
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { PlusCircleIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { useCurrentBlockActivation } from '../../../../ui/composables/useCurrentBlockActivation';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { buildAudioBlockCreateOptions } from '../../functions/audioBlockPresentation';

const emit = defineEmits(['action']);
const { editorMessage } = useEditorLocalization();

// 块激活状态：离屏时暂停全局事件监听
const blockActivation = useCurrentBlockActivation();

const isMenuOpen = ref(false);
const containerRef = ref(null);
const buttonRef = ref(null);
const menuPosition = ref({});

/**
 * 转换为 CustomSelect 需要的格式
 */
const selectOptions = computed(() => {
  return buildAudioBlockCreateOptions(editorMessage);
});

/**
 * 更新菜单位置
 */
const updateMenuPosition = () => {
  if (!buttonRef.value) return;
  
  const buttonRect = buttonRef.value.getBoundingClientRect();
  menuPosition.value = {
    position: 'fixed',
    top: `${buttonRect.bottom + 4}px`,
    left: `${buttonRect.right - 100}px`, // 100px 是菜单的 min-width，实现右对齐
  };
};

/**
 * 切换菜单显示
 */
const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
  if (isMenuOpen.value) {
    nextTick(() => {
      updateMenuPosition();
    });
  }
};

/**
 * 处理选项选择
 */
const handleSelect = (value) => {
  if (value) {
    emit('action', value);
  }
};

/**
 * 处理关闭
 */
const handleClose = () => {
  isMenuOpen.value = false;
};

// 全局事件监听只在块激活或菜单打开时注册，离屏时暂停
let listenersRegistered = false;

const registerListeners = () => {
  if (listenersRegistered) return;
  window.addEventListener('scroll', updateMenuPosition, true);
  window.addEventListener('resize', updateMenuPosition);
  listenersRegistered = true;
};

const unregisterListeners = () => {
  if (!listenersRegistered) return;
  window.removeEventListener('scroll', updateMenuPosition, true);
  window.removeEventListener('resize', updateMenuPosition);
  listenersRegistered = false;
};

watch(
  () => blockActivation.isUiActive.value || isMenuOpen.value,
  (shouldListen) => {
    if (shouldListen) {
      registerListeners();
    } else {
      unregisterListeners();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  unregisterListeners();
});
</script>
