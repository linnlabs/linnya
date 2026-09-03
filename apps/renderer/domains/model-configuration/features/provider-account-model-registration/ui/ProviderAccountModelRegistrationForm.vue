<template>
  <div class="add-model-provider-form" data-registration-kind="provider-account">
    <SettingsRow
      :label="settingsMessage('settings.addModel.account.label')"
      :hint="settingsMessage('settings.addModel.account.description')"
    >
      <SettingsState
        v-if="accountStatus === 'loading'"
        kind="loading"
        :message="settingsMessage('settings.addModel.account.loading')"
      />
      <template v-else-if="accountStatus === 'disconnected'">
        <ActionButtons
          :primary-action-text="connectText"
          :is-primary-action-disabled="accountBusy"
          @primary-click="authorize"
        />
      </template>
      <template v-else>
        <SettingsFeedback
          kind="success"
          :message="
            settingsMessage('settings.addModel.account.connected', {
              provider: selectedConnection?.display_name ?? '',
            })
          "
        />
        <ActionButtons
          :secondary-action-text="settingsMessage('settings.addModel.account.disconnect')"
          :show-primary-action="false"
          :is-secondary-action-disabled="accountBusy"
          @secondary-click="disconnect"
        />
      </template>
    </SettingsRow>

    <SettingsFeedback :kind="feedbackKind" :message="feedbackMessage" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ActionButtons } from '@linnya/renderer-ui';
import {
  SettingsFeedback,
  SettingsRow,
  SettingsState,
  useSettingsLocalization,
} from '@/domains/settings/public';
import { useProviderCatalogReadModel } from '../../provider-catalog';
import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';
import { resolveProviderAccountAuthorizationOperations } from '../registry/providerAccountAuthorizationRegistry';

type AccountStatus = 'loading' | 'connected' | 'disconnected';
type FeedbackKind = 'info' | 'error';

const props = defineProps<{
  readonly providerConnectionDefinitionId: string;
  readonly refreshModelCatalog: () => Promise<void>;
}>();
const providerCatalog = useProviderCatalogReadModel();
const { settingsMessage } = useSettingsLocalization();
const accountStatus = ref<AccountStatus>('loading');
const accountBusy = ref(false);
const feedbackKind = ref<FeedbackKind>('info');
const feedbackMessage = ref('');

const selectedConnection = computed(() =>
  providerCatalog.providers.value
    .flatMap(provider => provider.connections)
    .find(connection => connection.id === props.providerConnectionDefinitionId)
);
const connectText = computed(() =>
  accountBusy.value
    ? settingsMessage('settings.addModel.account.connecting')
    : settingsMessage('settings.addModel.account.connect', {
        provider: selectedConnection.value?.display_name ?? '',
      })
);

function setFailure(error: unknown): void {
  feedbackKind.value = 'error';
  feedbackMessage.value =
    error instanceof ProviderAccountAuthorizationError
      ? error.message
      : settingsMessage('settings.addModel.error.unknown');
}

async function authorize(): Promise<void> {
  accountBusy.value = true;
  feedbackMessage.value = '';
  try {
    const operations = resolveProviderAccountAuthorizationOperations(
      props.providerConnectionDefinitionId
    );
    const result = await operations.authorize();
    accountStatus.value = result.status;
    await props.refreshModelCatalog();
  } catch (error: unknown) {
    setFailure(error);
  } finally {
    accountBusy.value = false;
  }
}

async function disconnect(): Promise<void> {
  accountBusy.value = true;
  feedbackMessage.value = '';
  try {
    const operations = resolveProviderAccountAuthorizationOperations(
      props.providerConnectionDefinitionId
    );
    const result = await operations.disconnect();
    accountStatus.value = result.status;
    await props.refreshModelCatalog();
  } catch (error: unknown) {
    setFailure(error);
  } finally {
    accountBusy.value = false;
  }
}

onMounted(async () => {
  try {
    const operations = resolveProviderAccountAuthorizationOperations(
      props.providerConnectionDefinitionId
    );
    accountStatus.value = (await operations.getStatus()).status;
  } catch (error: unknown) {
    accountStatus.value = 'disconnected';
    setFailure(error);
  }
});
</script>
