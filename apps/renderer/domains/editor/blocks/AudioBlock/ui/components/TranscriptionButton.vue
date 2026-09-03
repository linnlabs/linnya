<template>
  <button 
    class="audio-transcription-button"
    :class="`transcription-state-${transcriptionState}`"
    @click="$emit('click')"
    :disabled="isDisabled"
    :title="buttonTitle"
  >
    <div class="audio-transcription-icon-wrapper">
      <RippleLoadingIcon v-if="transcriptionState === 'loading'" />
      <SpeechToTextIcon v-else class="transcription-icon" />
    </div>
  </button>
</template>

<script setup>
import { computed } from 'vue';
import { SpeechToTextIcon } from '@linnya/renderer-ui/icons';
import { RippleLoadingIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { resolveAudioBlockTranscriptionButtonTitle } from '../../functions/audioBlockPresentation';

const props = defineProps({
  transcriptionState: { type: String, default: 'idle' },
});

defineEmits(['click']);
const { editorMessage } = useEditorLocalization();

const buttonTitle = computed(() => {
  return resolveAudioBlockTranscriptionButtonTitle(props.transcriptionState, editorMessage);
});

const isDisabled = computed(() => {
  return props.transcriptionState === 'loading' || props.transcriptionState === 'success';
});
</script>
