<!-- src/renderer/features/KnowledgeBase/ui/ParsingSettingsTab.vue -->
<!-- 解析设置Tab组件，负责知识库相关模型的配置和PDF解析设置 -->

<template>
  <div class="config-tab">
    <div class="config-main-view">
      <div class="parsing-settings-section">
        <div class="field-header">
          <label class="field-label">{{ knowledgeBaseMessage('knowledgeBase.parsing.settings.title') }}</label>
          <button
            type="button"
            class="action-btn secondary model-settings-btn"
            @click="openModelParsingSettings"
          >
            <SettingsIcon />
            <span>{{ knowledgeBaseMessage('knowledgeBase.parsing.modelSettings.open') }}</span>
          </button>
        </div>
        
        <div class="parsing-options">
          <div class="parsing-option-item">
            <div class="option-label">
              <span class="option-title">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.graph.title') }}
                <span class="scope-hint">{{ knowledgeBaseMessage('knowledgeBase.parsing.scope.current') }}</span>
              </span>
              <p class="option-description">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.graph.description') }}
              </p>
            </div>
            <div class="option-control">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  :checked="localEnableGraphIndexing"
                  @change="updateEnableGraphIndexing"
                />
                <span class="slider"></span>
              </label>
              <p class="setting-note">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.resourceNote') }}
              </p>
            </div>
          </div>

          <div class="parsing-option-item">
            <div class="option-label">
              <span class="option-title">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.title') }}
                <span class="scope-hint">{{ knowledgeBaseMessage('knowledgeBase.parsing.scope.all') }}</span>
              </span>
              <p class="option-description">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.description') }}
              </p>
            </div>
            <div class="option-control">
              <CustomSelect
                :model-value="pdfParsingStrategy"
                class="pdf-strategy-select"
                :options="pdfParsingStrategyOptions"
                :title="knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.selectTitle')"
                :placeholder="knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.smart')"
                :class-names="{ trigger: 'pdf-strategy-select-trigger' }"
                font-size="13px"
                @update:model-value="updatePdfParsingStrategy"
              />
              <p class="setting-note">
                {{ knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.note') }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useUIStore } from '@shared/stores/ui'
import { useKnowledgeBaseStore } from '../stores/knowledgeBase'
import { useNotificationStore } from '@/app/notification'
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization'
import { SettingsIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';

/**
 * 解析设置属于“当前选中的知识库”：
 * - 在详情页：kbId 来自路由/props，并不一定同步到 kbStore.currentKbId
 * - 在弹窗：用户可能没切到上传Tab，也不会触发 v-model 写入 kbStore.currentKbId
 * 因此这里以 props 作为唯一真实来源，避免读取 store.currentKbId 造成“未选中”的误判。
 */
const props = defineProps({
  selectedKbId: {
    type: String,
    default: null
  }
})

// --- Stores ---
const uiStore = useUIStore()
const kbStore = useKnowledgeBaseStore()
const notificationStore = useNotificationStore()
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization()

// --- State ---
const localForceVisionMode = ref(false)
// 知识图谱构建：默认关闭（只有显式开启才会触发后续抽取/索引）
const localEnableGraphIndexing = ref(false)

// --- Computed ---
const storeForceVisionMode = computed(() => kbStore.parsingSettings?.forceVisionMode ?? false)
const pdfParsingStrategy = computed(() => localForceVisionMode.value ? 'forceOcr' : 'smart')
const pdfParsingStrategyOptions = computed(() => [
  {
    value: 'smart',
    label: knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.smart'),
    text: knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.smart')
  },
  {
    value: 'forceOcr',
    label: knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.forceOcr'),
    text: knowledgeBaseMessage('knowledgeBase.parsing.pdfStrategy.forceOcr')
  }
])
const currentKbId = computed(() => props.selectedKbId)
const currentKb = computed(() => {
  const kbId = currentKbId.value
  if (typeof kbId !== 'string' || kbId.trim().length === 0) return null
  // 直接从列表查找当前知识库（不依赖 store.currentKbId）
  return kbStore.getKnowledgeBaseById(kbId)
})

/**
 * 从当前知识库读取“图谱构建开关”：
 * - 约定：默认关闭；只有显式 true 才视为开启；
 * - 这里不做补丁式兜底：只做明确的结构检查与默认值。
 */
const storeEnableGraphIndexing = computed(() => {
  const kb = currentKb.value
  if (!kb || typeof kb !== 'object') return false
  const raw = kb.enableGraphIndexing
  return raw === true ? true : false
})

// --- Methods ---
const openModelParsingSettings = () => {
  uiStore.openSettingsModal('model-config')
}

const updatePdfParsingStrategy = (strategy) => {
  const newValue = strategy === 'forceOcr'
  localForceVisionMode.value = newValue
  kbStore.updateParsingSettings({ forceVisionMode: newValue })
}

const updateEnableGraphIndexing = async (event) => {
  const kbId = currentKbId.value
  if (typeof kbId !== 'string' || kbId.trim().length === 0) {
    notificationStore.show(
      knowledgeBaseMessage('knowledgeBase.parsing.toast.noKnowledgeBase'),
      'error',
      3000
    )
    return
  }

  const newValue = event.target.checked === true
  localEnableGraphIndexing.value = newValue
  try {
    await kbStore.updateKbModelSettings(kbId, { enableGraphIndexing: newValue })
    notificationStore.show(
      newValue
        ? knowledgeBaseMessage('knowledgeBase.parsing.toast.graphEnabled')
        : knowledgeBaseMessage('knowledgeBase.parsing.toast.graphDisabled'),
      'success',
      2500
    )
  } catch (error) {
    console.error('[ParsingSettingsTab] 更新知识图谱构建开关失败:', error)
    // 回滚 UI（以 store 为准）
    localEnableGraphIndexing.value = storeEnableGraphIndexing.value
    notificationStore.show(
      knowledgeBaseMessage('knowledgeBase.parsing.toast.updateFailed'),
      'error',
      3500
    )
  }
}

// --- Lifecycle ---
onMounted(() => {
  // 从store初始化本地状态
  localForceVisionMode.value = storeForceVisionMode.value
  localEnableGraphIndexing.value = storeEnableGraphIndexing.value
})

watch(
  storeEnableGraphIndexing,
  (v) => {
    localEnableGraphIndexing.value = v
  },
  { immediate: true }
)

</script>
