<template>
  <div class="review-message-card" @click="handleClick">
    <div class="card-header">
      <div class="agent-info">
        <span class="agent-name">{{ agentName }}</span>
      </div>
      <div class="header-actions">
        <IconButton
          :label="editorMessage('editor.review.message.delete')"
          size="xs"
          tone="danger"
          class="delete-btn"
          @click.stop="handleDelete"
        >
          <CloseIcon />
        </IconButton>
      </div>
    </div>
    <div class="card-content">
      <p class="message-text">{{ annotation.content }}</p>
    </div>
    <div class="card-footer">
      <span class="timestamp">{{ formattedTime }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconButton } from '@linnya/renderer-ui';
import { computed } from 'vue';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import type { ReviewAnnotation } from '../../types/reviewAnnotation';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { formatReviewMessageTime } from '../../functions/reviewTimePresentation';

interface Props {
  annotation: ReviewAnnotation;
  agentName: string;
}

const props = defineProps<Props>();
const { editorMessage } = useEditorLocalization();
const emit = defineEmits<{
  click: [annotation: ReviewAnnotation];
  delete: [annotationId: string];
}>();

const formattedTime = computed(() => {
  return formatReviewMessageTime(props.annotation.createdAt, editorMessage);
});

const handleClick = () => {
  emit('click', props.annotation);
};

const handleDelete = () => {
  emit('delete', props.annotation.id);
};
</script>
