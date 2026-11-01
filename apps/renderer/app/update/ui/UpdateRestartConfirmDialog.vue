<template>
  <Modal
    :is-visible="activities !== null"
    :title="title"
    :close-on-overlay-click="!store.requestingRestart"
    width="400px"
    scroll-mode="internal"
    @close="store.declineRestart()"
  >
    <div class="app-update-confirm">
      <p class="app-update-confirm__description">
        {{ updateMessage('update.restartConfirm.description') }}
      </p>
      <p
        v-if="store.activitiesChanged"
        class="app-update-confirm__changed"
      >
        {{ updateMessage('update.restartConfirm.changed') }}
      </p>
      <ul class="app-update-confirm__list">
        <li
          v-for="activity in activities ?? []"
          :key="activity.key"
        >
          <span class="app-update-confirm__kind">{{ updateMessage(KIND_KEYS[activity.kind]) }}</span>
          <span class="app-update-confirm__name">{{ activityName(activity) }}</span>
        </li>
      </ul>
    </div>
    <template #footer>
      <div class="app-update-confirm__footer">
        <ActionButtons
          :secondary-action-text="updateMessage('update.restartConfirm.actions.later')"
          :primary-action-text="updateMessage('update.restartConfirm.actions.confirm')"
          :is-primary-action-disabled="store.requestingRestart"
          @secondary-click="store.declineRestart()"
          @primary-click="store.confirmRestart()"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { ActionButtons, Modal } from '@linnya/renderer-ui';
import type {
  AppUpdateActivity,
  AppUpdateActivityKind,
} from '../../../../../src/shared/update/definitions/updateMessage';
import type { UpdateMessageKey } from '../definitions/updateMessages';
import { useUpdateStore } from '../store/updateStore';
import { useUpdateLocalization } from './useUpdateLocalization';

const KIND_KEYS: Readonly<Record<AppUpdateActivityKind, UpdateMessageKey>> = {
  conversation: 'update.restartConfirm.kind.conversation',
  commands: 'update.restartConfirm.kind.commands',
  knowledge_ingestion: 'update.restartConfirm.kind.knowledgeIngestion',
};

const store = useUpdateStore();
const { pendingActivities: activities } = storeToRefs(store);
const { updateMessage } = useUpdateLocalization();

const title = computed(() => updateMessage('update.restartConfirm.title', { count: String(activities.value?.length ?? 0) }));

function activityName(activity: AppUpdateActivity): string {
  if (activity.kind === 'commands') return updateMessage('update.restartConfirm.commands');
  if (activity.kind === 'knowledge_ingestion') return updateMessage('update.restartConfirm.knowledgeIngestion');
  return activity.title || updateMessage('update.restartConfirm.untitledConversation');
}
</script>
