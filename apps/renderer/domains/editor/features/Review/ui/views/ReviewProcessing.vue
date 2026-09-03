<template>
  <div class="review-section processing-view review-processing-view">
    <div class="processing-content">
      <RippleLoadingIcon class="loading-icon" />
      <h3>{{ editorMessage('editor.review.processing.title') }}</h3>

      <!-- 角色标签 + 进度文字 -->
      <div class="progress-info">
        <span v-if="currentAgentName" class="agent-badge">
          <LinnyaIcon class="agent-icon" />
          {{ currentAgentName }}
        </span>
        <p class="progress-text">{{ progressText }}</p>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${reviewStore.progress}%` }"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useReviewStore } from '../../store/reviewStore';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import { RippleLoadingIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { readReviewProgressPresentation } from '../../functions/reviewProgressPresentation';

const reviewStore = useReviewStore();
const { editorMessage } = useEditorLocalization();

const progressPresentation = computed(() => readReviewProgressPresentation(
  reviewStore.progressState,
  reviewStore.availableAgents,
  editorMessage,
));

const currentAgentName = computed(() => progressPresentation.value.agentName);
const progressText = computed(() => progressPresentation.value.text);
</script>
