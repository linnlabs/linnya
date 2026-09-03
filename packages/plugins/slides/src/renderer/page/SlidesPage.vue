<template>
  <div class="slides-page">
    <SlidesView
      :source-edit-busy="isSubmitting"
      @source-edit-submit="submitElementAiEdit"
    />
    <PresentationExportModals />
  </div>
</template>

<script setup lang="ts">
import SlidesView from './SlidesView.vue';
import { useSlidesElementAiEditWorkflow } from '../features/elementAiEdit';
import { PresentationExportModals } from '../features/presentationExport';

const {
  isSubmitting,
  submitElementAiEdit,
} = useSlidesElementAiEditWorkflow();
</script>
