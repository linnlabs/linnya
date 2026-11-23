<!--
  apps/renderer/app/pages/ScheduledTasksPage/ScheduledTasksPage.vue

  定时任务页面：装配 scheduled-tasks 领域的整页视图，把“打开对话”接到 app 层导航。
-->
<template>
  <ScheduledTasksView
    :project-id="projectId"
    :initial-task-id="scheduledTaskId"
    @open-conversation="handleOpenConversation"
  />
</template>

<script setup lang="ts">
import { ScheduledTasksView } from '@/domains/scheduled-tasks';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

defineProps<{
  projectId: string | null;
  scheduledTaskId: string | null;
}>();

function handleOpenConversation(projectId: string, conversationId: string): void {
  void getWorkspaceNavigationPort().openConversation({
    conversationId,
    scope: { kind: 'project', projectId },
  });
}
</script>
