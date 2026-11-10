<template>
  <Modal
    :isVisible="isVisible"
    :title="displayProjectName"
    width="620px"
    maxWidth="90%"
    height="min(640px, 80vh)"
    scroll-mode="internal"
    @close="emit('close')"
  >
    <div class="project-knowledge-base-modal-body">
      <ProjectKbSettingsPanel
        v-if="activeProjectId"
        class="kb-settings-embedded"
        :project-id="activeProjectId"
        :project-name="displayProjectName"
        @close="emit('close')"
      />
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Modal } from '@linnya/renderer-ui';
import ProjectKbSettingsPanel from '@/domains/workspace/ui/home/ProjectKbSettingsPanel.vue';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';

const props = defineProps<{
  isVisible: boolean;
  projectId: string | null;
  projectName?: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { workspaceMessage } = useWorkspaceLocalization();

const activeProjectId = computed(() => props.projectId?.trim() || '');
const displayProjectName = computed(() => {
  const projectName = props.projectName?.trim();
  return projectName && projectName.length > 0
    ? projectName
    : workspaceMessage('workspace.projectOverview.untitledProject');
});
</script>
