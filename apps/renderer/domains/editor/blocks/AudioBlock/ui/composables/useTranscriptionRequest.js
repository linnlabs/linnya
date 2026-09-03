import { onBeforeUnmount, ref } from 'vue'
import { useNotificationStore } from '@/app/notification'
import { useAudioContentStore, useAudioRuntimeStore } from '../../store/index.js'
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage'
import { createAudioBlockMessage } from '../../functions/audioBlockPresentation'

export function useTranscriptionRequest(props) {
  const notificationStore = useNotificationStore()
  const contentStore = useAudioContentStore()
  const runtimeStore = useAudioRuntimeStore()

  const resetTimer = ref(null)

  const scheduleReset = (blockId, expectedState) => {
    if (resetTimer.value) {
      clearTimeout(resetTimer.value)
      resetTimer.value = null
    }
    resetTimer.value = setTimeout(() => {
      resetTimer.value = null
      const runtime = runtimeStore.getRuntime(blockId)
      if (runtime && runtime.transcriptionState === expectedState) {
        runtimeStore.updateRuntime(blockId, { transcriptionState: 'idle' })
      }
    }, 2500)
  }

  const requestTranscription = async ({ blockId = props.blockId, notify = true } = {}) => {
    if (!blockId) {
      throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.missingBlockId'))
    }

    const runtime = runtimeStore.getRuntime(blockId)
    if (!runtime) {
      throw new Error(resolveCurrentEditorMessage('editor.audioBlock.error.noRuntime'))
    }

    if (runtime.transcriptionState === 'loading') {
      if (notify) {
        notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.transcriptionInProgress'), 'info', 2000)
      }
      return { success: false, inProgress: true }
    }

    runtimeStore.updateRuntime(blockId, {
      transcriptionState: 'loading',
      statusMessage: createAudioBlockMessage('editor.audioBlock.status.transcribingAudio')
    })

    if (notify) {
      notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.transcribingAudio'), 'info', 2000)
    }

    try {
      const { blob, mimeType, filename, duration } = await runtimeStore.resolveAudioForTranscription(blockId)
      const { transcribeAudio } = await import('../../services/transcriptionService.js')
      const result = await transcribeAudio(blob, mimeType, filename, duration)

      if (!result.success) {
        throw new Error(result.error || resolveCurrentEditorMessage('editor.audioBlock.error.transcriptionFailed'))
      }

      let segments = Array.isArray(result.segments) ? result.segments : []
      if ((!segments || segments.length === 0) && result.text) {
        segments = [{ text: result.text, start: 0 }]
      }

      let transcriptDoc = null
      if (segments.length > 0) {
        const { segmentsToProseMirrorDoc } = await import('../content-panel/transcriptDataConverter.js')
        transcriptDoc = segmentsToProseMirrorDoc(segments)
        contentStore.setTranscriptContentDraft(blockId, transcriptDoc)
      }

      runtimeStore.updateRuntime(blockId, {
        transcriptionState: 'success',
        statusMessage: segments.length > 0
          ? createAudioBlockMessage('editor.audioBlock.status.transcriptionCompletedGenerated')
          : createAudioBlockMessage('editor.audioBlock.status.transcriptionCompletedEmpty')
      })

      if (notify) {
        notificationStore.show(
          segments.length > 0
            ? resolveCurrentEditorMessage('editor.audioBlock.toast.transcriptionCompletedFilled')
            : resolveCurrentEditorMessage('editor.audioBlock.toast.transcriptionCompletedEmpty'),
          segments.length > 0 ? 'success' : 'warning',
          2500
        )
      }

      scheduleReset(blockId, 'success')

      return {
        success: true,
        transcriptDoc,
        segments,
        text: result.text
      }
    } catch (error) {
      runtimeStore.updateRuntime(blockId, {
        transcriptionState: 'error',
        statusMessage: createAudioBlockMessage('editor.audioBlock.action.transcriptionFailed')
      })

      if (notify) {
        notificationStore.show(
          resolveCurrentEditorMessage('editor.audioBlock.toast.transcriptionFailedWithMessage'),
          'error',
          4000
        )
      }

      scheduleReset(blockId, 'error')

      throw error
    }
  }

  onBeforeUnmount(() => {
    if (resetTimer.value) {
      clearTimeout(resetTimer.value)
      resetTimer.value = null
    }
  })

  return {
    requestTranscription
  }
}
