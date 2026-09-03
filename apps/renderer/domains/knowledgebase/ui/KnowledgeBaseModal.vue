<template>
  <Modal
    :isVisible="props.isVisible"
    :title="knowledgeBaseMessage('knowledgeBase.modal.title')"
    @close="closeModal"
    width="950px"
    maxWidth="90vw"
    height="540px"
  >
    <div class="kb-layout">
      <!-- 标签页导航 -->
      <div class="tab-navigation">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          :class="['tab-button', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.name }}
        </button>
      </div>

      <!-- 主要内容区域 -->
      <div class="main-content">
        <FileUploadTab 
          v-show="activeTab === 'upload'" 
          v-model:selectedKbId="kbStore.currentKbId"
        />
        <FileManageTab 
          v-show="activeTab === 'manage'" 
          :selectedKbId="kbStore.currentKbId"
        />
        <KnowledgeBaseSettingsTab
          v-show="activeTab === 'config'" 
          :selectedKbId="kbStore.currentKbId"
        />
        <ParsingSettingsTab 
          v-show="activeTab === 'parsing'" 
          :selectedKbId="kbStore.currentKbId"
        />
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useKnowledgeBaseStore } from '../stores/knowledgeBase'
import { Modal } from '@linnya/renderer-ui'
import FileUploadTab from './FileUploadTab.vue'
import FileManageTab from './FileManageTab.vue'
import KnowledgeBaseSettingsTab from './KnowledgeBaseSettingsTab.vue'
import ParsingSettingsTab from './ParsingSettingsTab.vue' // 🔥 新增：导入解析设置组件
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization'

// --- Props ---
const props = defineProps({
  isVisible: Boolean
})
const emit = defineEmits(['close'])

// --- Stores ---
const kbStore = useKnowledgeBaseStore()
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization()

// --- State ---
const activeTab = ref('upload')

// --- Tab Configuration ---
const tabs = computed(() => [
  { id: 'upload', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.upload') },
  { id: 'manage', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.manage') },
  { id: 'config', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.settings') },
  { id: 'parsing', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.parsing') },
])

// --- Methods ---
const closeModal = () => emit('close')

// --- Lifecycle ---
// 中文说明：该旧模态目前不参与主导航；若再次启用，打开/关闭由父组件控制，
// 不能反向调用 uiStore 导航 action，避免知识库页面和模态入口重新耦合。
</script>
