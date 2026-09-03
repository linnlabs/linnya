<template>
  <node-view-wrapper class="audio-block-border">
    <!-- 录音控制 -->
    <RecordingControls
      v-if="showRecordingControls"
      :block-id="audioBlockId"
      :is-recording="isRecording"
      :is-paused="isPaused"
      :can-record="canRecord"
      :status-message="statusMessage"
      :error-message="errorMessage"
      :microphone-device="microphoneDevice"
      :media-stream="mediaStream"
      :processing-state="processingState"
      @start-recording="startRecording"
      @pause-recording="pauseRecording"
      @resume-recording="resumeRecording"
      @terminate-recording="terminateRecording"
      @retry-save-recording="retrySaveRecording"
      @retry-device-check="retryDeviceCheck"
      @toggle-notes="handleToggleNotes"
    />

    <!-- 播放器 -->
    <AudioPlayer
      v-if="showPlayer && audioFileObjectUrl"
      :key="audioFileObjectUrl"
      :block-id="audioBlockId"
      :audio-url="audioFileObjectUrl"
      :duration="props.node.attrs.duration || 0"
      :transcription-state="transcriptionState"
      ref="audioPlayerRef"
      @error="handlePlayerError"
      @loaded="handlePlayerLoaded"
    />

    <button
      v-if="audioMissingReason"
      type="button"
      class="audio-missing-placeholder"
      contenteditable="false"
      @click.stop.prevent="selectAudioBlock"
    >
      <span class="audio-missing-placeholder__icon" aria-hidden="true"></span>
      <span class="audio-missing-placeholder__text">{{ audioMissingText }}</span>
    </button>

    <!-- 内容面板 -->
    <AudioContentPanel
      v-if="isPanelVisible"
      :block-id="audioBlockId"
      :is-recording-mode="isRecording"
    />

    <span v-if="shouldShowStatusMessage" class="audio-block-status">{{ resolvedStatusMessage }}</span>
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAudioContentStore, useAudioRuntimeStore } from '../store'
import AudioRecordingService from '../services/AudioRecordingService'
import RecordingControls from './RecordingControls.vue'
import AudioPlayer from './AudioPlayer.vue'
import AudioContentPanel from './content-panel/AudioContentPanel.vue'
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation'
import { useBlockKeepAlive } from '../../../ui/composables/useBlockKeepAlive'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { createAudioBlockMessage, resolveAudioBlockStatusMessage } from '../functions/audioBlockPresentation'
import {
  canLoadPersistedAudioSource,
  normalizeAudioBooleanAttr,
  resolveAudioMissingMessageKey,
  resolvePersistedAudioMissingReason,
} from '../functions/audioBlockMediaState'

const props = defineProps(nodeViewProps)

// 块激活状态
const blockActivation = useCurrentBlockActivation()
const keepAlive = useBlockKeepAlive()

const audioBlockId = computed(() => props.node.attrs.id)

const contentStore = useAudioContentStore()
const runtimeStore = useAudioRuntimeStore()
const { editorMessage } = useEditorLocalization()

const audioPlayerRef = ref(null)

contentStore.initContent(audioBlockId.value)
runtimeStore.initRuntime(audioBlockId.value, {
  isFinalized: props.node.attrs.isFinalized,
  src: props.node.attrs.src,
  isTempSrc: props.node.attrs.isTempSrc,
  duration: props.node.attrs.duration,
  mimeType: props.node.attrs.mimeType,
  saveStatus: props.node.attrs.saveStatus
})

const content = computed(() => contentStore.getContent(audioBlockId.value))
const runtime = computed(() => runtimeStore.getRuntime(audioBlockId.value))

const isRecording = computed(() => runtime.value.isRecording)
const isPaused = computed(() => runtime.value.isPaused)
const audioFileObjectUrl = computed(() => runtime.value.audioFileObjectUrl)
const duration = computed(() => runtime.value.duration)
const statusMessage = computed(() => runtime.value.statusMessage)
const resolvedStatusMessage = computed(() => resolveAudioBlockStatusMessage(statusMessage.value, editorMessage))
const canRecord = computed(() => runtime.value.canRecord)
const processingState = computed(() => runtime.value.processingState)
const errorMessage = computed(() => runtime.value.errorMessage)
const microphoneDevice = computed(() => runtime.value.microphoneDevice)
const mediaStream = computed(() => runtime.value.mediaStream)
const transcriptionState = computed(() => runtime.value.transcriptionState || 'idle')
const isPanelVisible = computed(() => runtime.value.isPanelVisible)
const audioMissingReason = computed(() => runtime.value.audioMissingReason)
const audioMissingText = computed(() => {
  if (!audioMissingReason.value) return ''
  return editorMessage(resolveAudioMissingMessageKey(audioMissingReason.value))
})

const isNodeFinalized = computed(() => normalizeAudioBooleanAttr(props.node.attrs.isFinalized))
const hasAudioFile = computed(() => canLoadPersistedAudioSource(props.node.attrs))
const hasRuntimeAudioForRetry = computed(() =>
  runtime.value.saveStatus === 'failed'
  && runtime.value.audioBlob instanceof Blob
  && !!audioFileObjectUrl.value
)
const isSaveFailedRetryable = computed(() =>
  hasRuntimeAudioForRetry.value
  && !audioMissingReason.value
)

const showPlayer = computed(() => runtime.value.showPlayer && !!audioFileObjectUrl.value)
const showRecordingControls = computed(() =>
  (!isNodeFinalized.value && !hasAudioFile.value && props.node.attrs.saveStatus !== 'failed' && !audioMissingReason.value)
  || isSaveFailedRetryable.value
)

// 块是否有活跃操作（录音中、转录中），用于保活判断
const isBlockBusy = computed(() =>
  isRecording.value
  || transcriptionState.value === 'loading'
  || processingState.value === 'recording'
  || isSaveFailedRetryable.value
)

// 将忙碌状态同步到保活系统：录音/转录期间阻止块被虚拟化冻结
watch(isBlockBusy, (busy) => {
  if (!keepAlive) return
  if (busy) keepAlive.register('audio-busy')
  else keepAlive.unregister('audio-busy')
}, { immediate: true })

const shouldShowStatusMessage = computed(() => {
  const hasMessage = !!statusMessage.value
  const noPlayer = !showPlayer.value
  const noControls = isNodeFinalized.value || (!isRecording.value && hasAudioFile.value)
  const notInDeviceCheck = processingState.value !== 'loading'
  return hasMessage && noPlayer && noControls && notInDeviceCheck && !audioMissingReason.value
})

const recordingService = new AudioRecordingService(
  audioBlockId.value,
  runtimeStore,
  (attrs) => props.updateAttributes(attrs)
)

// 将录音能力注册到 runtimeStore，供“切换文件/保存前”统一终止录音使用
runtimeStore.registerRecordingController(audioBlockId.value, {
  terminateForSave: async () => {
    const runtimeState = runtimeStore.getRuntime(audioBlockId.value)
    if (!runtimeState?.isRecording) {
      return true
    }

    // 说明：录音时长由 RecordingControls 每秒同步到 runtimeStore.recordingTime
    const durationSeconds = typeof runtimeState.recordingTime === 'number' ? runtimeState.recordingTime : 0
    const ok = await recordingService.terminateRecording(durationSeconds)
    return ok === true
  }
})

const loadAudio = async (src) => {
  if (!src) return

  runtimeStore.updateRuntime(audioBlockId.value, {
    audioLoadFailed: false,
    audioMissingReason: null
  })

  try {
    if (src.startsWith('blob:')) {
      runtimeStore.setAudioBlobUrl(audioBlockId.value, src)
    } else if (src.startsWith('data:')) {
      runtimeStore.setAudioDataUrl(audioBlockId.value, src)
    } else {
      await runtimeStore.loadAudioFile(audioBlockId.value, src)
    }
  } catch (error) {
    console.error('[AudioBlockView] 加载音频失败:', error)
    runtimeStore.updateRuntime(audioBlockId.value, {
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailedWithMessage'),
      processingState: 'error',
      showPlayer: false,
      audioLoadFailed: true,
      audioMissingReason: 'saved-source-missing'
    })
  }
}

const resolveCurrentMissingReason = () => {
  const missingReason = resolvePersistedAudioMissingReason(props.node.attrs)
  if (missingReason === 'save-failed-without-runtime-audio' && hasRuntimeAudioForRetry.value) {
    return null
  }
  return missingReason
}

const showAudioMissingPlaceholder = (missingReason) => {
  runtimeStore.updateRuntime(audioBlockId.value, {
    statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadFailed'),
    processingState: 'error',
    showPlayer: false,
    audioLoadFailed: true,
    audioMissingReason: missingReason
  })
}

const startRecording = async () => {
  await recordingService.startRecording()
}

const pauseRecording = () => {
  recordingService.pauseRecording()
}

const resumeRecording = () => {
  recordingService.resumeRecording()
}

const terminateRecording = (durationFromControls) => {
  recordingService.terminateRecording(durationFromControls)
  nextTick(() => {
    runtimeStore.updateRuntime(audioBlockId.value, { mediaStream: null })
  })
}

const retrySaveRecording = () => {
  recordingService.retrySavePendingRecording()
}

const handlePlayerError = (payload) => {
  console.error(`[AudioBlockView] 播放器错误 (块ID: ${payload.blockId}):`, payload.error)
  runtimeStore.updateRuntime(audioBlockId.value, {
    statusMessage: createAudioBlockMessage('editor.audioBlock.status.audioError'),
    processingState: hasRuntimeAudioForRetry.value ? 'save_failed' : 'error',
    showPlayer: false,
    audioLoadFailed: !hasRuntimeAudioForRetry.value,
    audioMissingReason: hasRuntimeAudioForRetry.value ? null : 'saved-source-missing'
  })
}

const handlePlayerLoaded = (payload) => {
  if (!payload || !payload.duration || payload.duration <= 0) return

  const elementDuration = Math.round(payload.duration)
  const currentDuration = props.node.attrs.duration || 0

  if (elementDuration !== currentDuration) {
    props.updateAttributes({ duration: elementDuration })
    runtimeStore.updateRuntime(audioBlockId.value, { duration: elementDuration })
  }
}

const handleToggleNotes = () => {
  const currentState = runtimeStore.getRuntime(audioBlockId.value).isPanelVisible
  runtimeStore.updateRuntime(audioBlockId.value, {
    isPanelVisible: !currentState,
    activeTab: 'notes'
  })
}

const checkMicrophoneDevices = async () => {
  if (!isNodeFinalized.value) {
    await runtimeStore.checkMicrophoneForBlock(audioBlockId.value)
  }
}

const retryDeviceCheck = async () => {
  await runtimeStore.checkMicrophoneForBlock(audioBlockId.value, true)
}

const selectAudioBlock = () => {
  if (props.selected) return
  props.editor.commands.setNodeSelection(props.getPos())
}

watch(
  () => [props.node.attrs.src, props.node.attrs.isTempSrc, props.node.attrs.saveStatus],
  async ([newSrc, newIsTemp, newSaveStatus], [oldSrc, oldIsTemp, oldSaveStatus]) => {
    if (newSrc !== oldSrc || newIsTemp !== oldIsTemp || newSaveStatus !== oldSaveStatus) {
      runtimeStore.updateRuntime(audioBlockId.value, {
        src: newSrc,
        isTempSrc: newIsTemp,
        saveStatus: newSaveStatus
      })
    }

    const missingReason = resolveCurrentMissingReason()
    if (missingReason) {
      showAudioMissingPlaceholder(missingReason)
      return
    }

    if (newSrc && (newSrc !== oldSrc || newSaveStatus !== oldSaveStatus)) {
      await loadAudio(newSrc)
    }
  }
)

watch(() => props.node.attrs.isFinalized, async (newVal, oldVal) => {
  runtimeStore.updateRuntime(audioBlockId.value, { isFinalized: newVal })

  if (newVal && !oldVal && canLoadPersistedAudioSource(props.node.attrs)) {
    await loadAudio(props.node.attrs.src)
  }

  const missingReason = resolveCurrentMissingReason()
  if (newVal && missingReason) {
    showAudioMissingPlaceholder(missingReason)
  }
})

watch(() => props.node.attrs.duration, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    runtimeStore.updateRuntime(audioBlockId.value, {
      duration: newVal || 0
    })
  }
})

onMounted(async () => {
  console.log(`[AudioBlockView] 挂载 - ID: ${audioBlockId.value}`)
  await contentStore.loadContent(audioBlockId.value)

  const missingReason = resolveCurrentMissingReason()

  if (canLoadPersistedAudioSource(props.node.attrs)) {
    runtimeStore.updateRuntime(audioBlockId.value, {
      showPlayer: true,
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.loadingSavedAudio'),
      processingState: 'loading'
    })
    await loadAudio(props.node.attrs.src)
  } else if (missingReason) {
    showAudioMissingPlaceholder(missingReason)
  } else if (!isNodeFinalized.value) {
    checkMicrophoneDevices()
  } else {
    showAudioMissingPlaceholder('finalized-without-source')
  }
})

onBeforeUnmount(() => {
  console.log(`[AudioBlockView] 即将卸载 - ID: ${audioBlockId.value}`)
  keepAlive?.unregister('audio-busy')
  // 注意：切换文件时会先走 preSaveHook 终止录音并保存，然后再卸载 NodeView。
  // 这里不主动 cleanup，避免误清理音频数据块导致保存失败。
})

onUnmounted(() => {
  console.log(`[AudioBlockView] 已卸载 - ID: ${audioBlockId.value}`)
  contentStore.cleanupBlock(audioBlockId.value)
  runtimeStore.unregisterRecordingController(audioBlockId.value)
  runtimeStore.cleanupBlock(audioBlockId.value)
})
</script>
