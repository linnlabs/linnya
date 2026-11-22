<template>
  <main class="plugin-store-view">
    <div class="plugin-store-inner">
      <div v-if="selectedPluginId" class="plugin-store-detail-nav">
        <button class="plugin-store-back-button" type="button" @click="closePluginDetail">
          <ChevronIcon class="plugin-store-back-icon" direction="left" />
          <span>{{ pluginStoreMessage('pluginStore.back') }}</span>
        </button>
      </div>

      <PageSectionHeader
        v-else
        :title="pluginStoreMessage('pluginStore.title')"
        :subtitle="pluginStoreMessage('pluginStore.subtitle')"
        :meta="pluginHeaderMeta"
      >
        <template #tabs>
          <SegmentedTabs
            :model-value="activeStoreTab"
            :tabs="pluginStoreTabs"
            :aria-label="pluginStoreMessage('pluginStore.tabs.ariaLabel')"
            @update:model-value="setActiveStoreTab"
          />
        </template>
      </PageSectionHeader>

      <p v-if="!remoteServiceEnabled" class="plugin-store-availability" role="status">
        {{ pluginStoreMessage('pluginStore.remoteUnavailable') }}
      </p>
      <p v-else-if="isCatalogUnavailable" class="plugin-store-availability" role="status">
        {{ pluginStoreMessage('pluginStore.remote.offline') }}
      </p>

      <section v-if="storeItemsError" class="plugin-store-alert" role="alert">
        {{ storeItemsErrorMessage }}
      </section>

      <section v-if="selectedPluginId" class="plugin-store-detail-shell">
        <Skeleton
          v-if="isDetailLoading"
          class="plugin-store-detail-skeleton"
          :label="pluginStoreMessage('pluginStore.loading.detail')"
        >
          <div class="plugin-store-detail-skeleton__hero">
            <SkeletonBlock width="20px" height="20px" radius="sm" />
            <SkeletonBlock width="32%" height="14px" />
          </div>
          <SkeletonBlock v-for="width in DETAIL_SKELETON_LINES" :key="width" :width="width" />
        </Skeleton>

        <section v-else-if="selectedDetail" class="plugin-store-detail">
          <section class="plugin-store-detail-hero" aria-labelledby="plugin-store-detail-title">
            <div class="plugin-store-detail-hero-main">
              <div class="plugin-store-detail-title-line">
                <span class="plugin-store-plugin-symbol">
                  <component
                    :is="resolvePluginStoreIconComponent(selectedDetail.meta.id)"
                    class="plugin-store-plugin-symbol-component"
                    role="img"
                    :aria-label="pluginIconAriaLabel(selectedDetail.meta.name)"
                  />
                </span>
                <h1 id="plugin-store-detail-title">{{ selectedDetail.meta.name }}</h1>
                <TagChip
                  class="plugin-store-state-chip"
                  :class="`is-${resolvePluginChip(selectedDetail).tone}`"
                  :label="resolvePluginChip(selectedDetail).label"
                  :class-names="{ label: 'plugin-store-state-chip-label' }"
                />
              </div>
              <p>{{ selectedDetail.meta.description }}</p>
              <p v-if="selectedDetail.runtimeUnavailable">{{ pluginStoreMessage('pluginStore.reason.runtimeUnavailable') }}</p>
              <p v-if="selectedDetail.data?.status === 'legacy'">{{ formatLegacyStorageNotice(selectedDetail.data.bytes) }}</p>
            </div>

            <div class="plugin-store-detail-actions">
              <ActionButtons
                v-if="isRemoteInstalling(selectedDetail.meta.id)"
                class="plugin-store-install-actions"
                :secondary-action-text="pluginStoreMessage('pluginStore.action.cancel')"
                :secondary-button-attributes="{ class: 'plugin-store-cancel-install-button' }"
                :show-primary-action="false"
                @secondary-click="cancelRemoteInstall(selectedDetail.meta.id)"
              />
              <template v-else>
                <Switch
                  v-if="!selectedDetail.runtimeUnavailable && !canInstallSelectedPlugin(selectedDetail) && !isRemoteInstallBlocked(selectedDetail)"
                  :model-value="selectedDetail.state === 'enabled'"
                  :disabled="!canToggleSelectedPlugin(selectedDetail) || isSelectedPluginBusy(selectedDetail)"
                  :ariaLabel="pluginToggleAriaLabel(selectedDetail.meta.name)"
                  @update:model-value="enabled => handleSelectedPluginEnabledChange(selectedDetail, enabled)"
                />
                <ActionButtons
                  v-if="hasPluginRemoteUpdate(selectedDetail)"
                  class="plugin-store-install-actions"
                  :primary-action-text="pluginStoreMessage('pluginStore.action.update')"
                  :primary-button-attributes="{ class: 'plugin-store-update-button' }"
                  :is-primary-action-disabled="isSelectedPluginBusy(selectedDetail) || isCatalogUnavailable"
                  :show-secondary-action="false"
                  @primary-click="handleSelectedRemoteUpdate(selectedDetail)"
                />
                <ActionButtons
                  v-if="canInstallSelectedPlugin(selectedDetail) || isRemoteInstallBlocked(selectedDetail)"
                  class="plugin-store-install-actions"
                  :primary-action-text="installActionText(selectedDetail)"
                  :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                  :is-primary-action-disabled="isSelectedPluginBusy(selectedDetail) || isRemoteInstallBlocked(selectedDetail)"
                  :show-secondary-action="false"
                  @primary-click="handleSelectedInstall(selectedDetail)"
                />
              </template>
            </div>
          </section>

          <div
            v-if="selectedInstallSummary"
            class="plugin-store-install-status"
            role="status"
          >
            <div class="plugin-store-install-line">
              <span>{{ resolveInstallPhaseText(selectedDetail, selectedInstallSummary) }}</span>
              <span v-if="selectedInstallSummary.ratio !== null" class="plugin-store-install-percent">
                {{ Math.round(selectedInstallSummary.ratio * 100) }}%
              </span>
            </div>
            <div
              v-if="selectedInstallSummary.ratio !== null"
              class="plugin-store-progress"
              role="progressbar"
              :aria-label="pluginStoreMessage('pluginStore.install.progressAriaLabel', { pluginName: selectedDetail.meta.name })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="Math.round(selectedInstallSummary.ratio * 100)"
            >
              <span class="plugin-store-progress-fill" :style="{ width: `${selectedInstallSummary.ratio * 100}%` }" />
            </div>
            <p class="plugin-store-install-hint">{{ resolveBackgroundHint(selectedInstallSummary) }}</p>
          </div>
          <p
            v-else-if="selectedOutcome?.kind === 'cancelled'"
            class="plugin-store-install-status plugin-store-install-hint"
            role="status"
          >
            {{ pluginStoreMessage('pluginStore.remote.cancelled') }}
          </p>
          <p
            v-else-if="selectedOutcome?.kind === 'failed'"
            class="plugin-store-install-status plugin-store-install-error"
            role="alert"
          >
            {{ resolveFailureMessage(selectedDetail, selectedOutcome.error) }}
          </p>

          <section v-if="selectedDetail.details?.length" class="plugin-store-detail-section">
            <h2>{{ pluginStoreMessage('pluginStore.section.introduction') }}</h2>
            <div class="plugin-store-detail-copy">
              <p v-for="detail in selectedDetail.details" :key="detail">
                {{ detail }}
              </p>
            </div>
          </section>

          <section v-if="selectedDetail.skills?.length" class="plugin-store-detail-section">
            <h2>{{ buildCapabilitySectionTitle('skill', selectedDetail.skills.length) }}</h2>
            <PluginCapabilityList :items="selectedDetail.skills" />
          </section>

          <section v-if="selectedDetail.agents?.length" class="plugin-store-detail-section">
            <h2>{{ buildCapabilitySectionTitle('agent', selectedDetail.agents.length) }}</h2>
            <PluginCapabilityList :items="selectedDetail.agents" />
          </section>

          <PluginDataPanel
            v-if="selectedDetail.data || selectedDetail.dataMeasurement"
            :data="selectedDetail.data"
            :measurement="selectedDetail.dataMeasurement"
            :locale="currentLocale"
            :can-delete="selectedDetail.data?.canDelete ?? false"
            @delete="openDataDelete(selectedDetail)"
            @retry="retryDataCleanup(selectedDetail)"
            @stop="stopDataCleanup(selectedDetail)"
            @reveal="showDataLocation(selectedDetail)"
            @measure="setSelectedDataMeasurementPaused"
          />

          <section
            class="plugin-store-detail-footer"
            :aria-label="pluginStoreMessage('pluginStore.section.infoManagement')"
          >
            <div class="plugin-store-detail-facts">
              <div class="plugin-store-detail-fact">
                <span>{{ pluginStoreMessage('pluginStore.fact.version') }}</span>
                <strong>{{ selectedDetail.meta.version }}</strong>
              </div>
              <div class="plugin-store-detail-fact">
                <span>{{ pluginStoreMessage('pluginStore.fact.developer') }}</span>
                <strong>{{ selectedDetail.meta.developer }}</strong>
              </div>
              <div v-if="selectedRemoteSize" class="plugin-store-detail-fact">
                <span>{{ pluginStoreMessage('pluginStore.fact.size') }}</span>
                <strong>{{ selectedRemoteSize }}</strong>
              </div>
              <div v-else-if="selectedDetail.sizeBytes !== undefined" class="plugin-store-detail-fact">
                <span>{{ pluginStoreMessage('pluginStore.fact.size') }}</span>
                <strong>{{ formatStorageBytes(selectedDetail.sizeBytes, currentLocale) }}</strong>
              </div>
              <button
                v-if="selectedDetail.homepage"
                class="plugin-store-detail-fact is-link"
                type="button"
                @click="openExternalHomepage(selectedDetail.homepage)"
              >
                <span>{{ pluginStoreMessage('pluginStore.fact.homepage') }}</span>
                <strong>{{ pluginStoreMessage('pluginStore.fact.open') }}</strong>
              </button>
            </div>

            <div v-if="canUninstallPlugin(selectedDetail, remoteServiceEnabled)" class="plugin-store-detail-danger-zone">
              <ActionButtons
                class="plugin-store-uninstall-action"
                :primary-button-attributes="{ class: 'plugin-store-uninstall-button' }"
                :is-primary-action-disabled="isPluginBusy(selectedDetail.meta.id)"
                primary-variant="danger"
                :show-secondary-action="false"
                @primary-click="handlePluginUninstall(selectedDetail)"
              >
                <template #primary-content>
                  <DeleteIcon class="plugin-store-uninstall-icon" />
                  <span>{{ pluginStoreMessage('pluginStore.action.uninstall') }}</span>
                </template>
              </ActionButtons>
            </div>
          </section>

          <p v-for="note in selectedRuntimeNotes" :key="note" class="plugin-store-install-hint plugin-store-runtime-note">
            {{ note }}
          </p>

          <section
            v-if="visibleReleaseNotes.length"
            class="plugin-store-detail-section plugin-store-release-section"
          >
            <div class="plugin-store-release-header">
              <h2>{{ pluginStoreMessage('pluginStore.section.releaseNotes') }}</h2>
              <button
                v-if="hasHiddenReleaseNotes"
                class="plugin-store-release-toggle"
                type="button"
                @click="toggleReleaseNotesExpanded"
              >
                <span>{{ releaseNotesToggleLabel }}</span>
                <ChevronIcon
                  class="plugin-store-release-toggle-icon"
                  :direction="releaseNotesExpanded ? 'up' : 'down'"
                />
              </button>
            </div>
            <ol class="plugin-store-release-list">
              <li v-for="note in visibleReleaseNotes" :key="note.version">
                <div class="plugin-store-release-heading">
                  <strong>{{ note.version }}</strong>
                  <span v-if="note.title">{{ note.title }}</span>
                </div>
                <p v-if="note.description">{{ note.description }}</p>
              </li>
            </ol>
          </section>
        </section>

        <section v-else class="plugin-store-placeholder" role="alert">
          <p>{{ detailErrorMessage }}</p>
        </section>
      </section>

      <Skeleton
        v-else-if="isStoreItemsLoading && !hasStoreItems"
        class="plugin-store-list-skeleton"
        :label="pluginStoreMessage('pluginStore.loading.list')"
      >
        <!-- 与插件卡片同构：图标 + 名称、描述、版本信息，行尾开关 -->
        <div v-for="card in LIST_SKELETON_CARDS" :key="card.title" class="plugin-store-list-skeleton__card">
          <div class="plugin-store-list-skeleton__main">
            <div class="plugin-store-list-skeleton__heading">
              <SkeletonBlock width="20px" height="20px" radius="sm" />
              <SkeletonBlock :width="card.title" height="12px" />
            </div>
            <SkeletonBlock :width="card.description" />
            <SkeletonBlock width="28%" height="8px" />
          </div>
          <SkeletonBlock width="32px" height="18px" />
        </div>
      </Skeleton>

      <section v-else-if="!hasVisibleStoreItems" class="plugin-store-empty-state">
        <p class="plugin-store-empty-title">{{ visibleStoreEmptyTitle }}</p>
        <button
          v-if="activeStoreTab === 'installed'"
          class="plugin-store-empty-action"
          type="button"
          @click="setActiveStoreTab('market')"
        >
          {{ pluginStoreMessage('pluginStore.empty.installFromMarket') }}
        </button>
      </section>

      <section v-else class="plugin-store-list" :aria-label="pluginStoreMessage('pluginStore.list.ariaLabel')">
        <article
          v-for="item in visibleStoreItems"
          :key="item.meta.id"
          class="plugin-store-card"
          :class="{ 'is-busy': isPluginBusy(item.meta.id) && !isRemoteInstalling(item.meta.id) }"
          tabindex="0"
          :aria-label="pluginDetailAriaLabel(item.meta.name)"
          @click="handlePluginCardClick(item)"
          @keydown.enter.prevent="handlePluginCardClick(item)"
          @keydown.space.prevent="handlePluginCardClick(item)"
        >
          <div class="plugin-store-card-main">
            <div class="plugin-store-card-heading">
              <span class="plugin-store-plugin-symbol">
                <component
                  :is="resolvePluginStoreIconComponent(item.meta.id)"
                  class="plugin-store-plugin-symbol-component"
                  role="img"
                  :aria-label="pluginIconAriaLabel(item.meta.name)"
                />
              </span>
              <h2>{{ item.meta.name }}</h2>
              <TagChip
                class="plugin-store-state-chip"
                :class="`is-${resolvePluginChip(item).tone}`"
                :label="resolvePluginChip(item).label"
                :class-names="{ label: 'plugin-store-state-chip-label' }"
              />
            </div>

            <p class="plugin-store-card-description">
              {{ item.meta.description }}
            </p>
            <div class="plugin-store-card-meta">
              <span v-for="line in resolveCardMeta(item)" :key="line">{{ line }}</span>
            </div>
            <div
              v-if="cardInstallRatio(item) !== null"
              class="plugin-store-progress"
              role="progressbar"
              :aria-label="pluginStoreMessage('pluginStore.install.progressAriaLabel', { pluginName: item.meta.name })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="Math.round((cardInstallRatio(item) ?? 0) * 100)"
            >
              <span class="plugin-store-progress-fill" :style="{ width: `${(cardInstallRatio(item) ?? 0) * 100}%` }" />
            </div>
          </div>

          <div v-if="!isRemoteInstalling(item.meta.id)" class="plugin-store-card-actions" @click.stop @keydown.stop>
            <ActionButtons
              v-if="hasPluginRemoteUpdate(item)"
              class="plugin-store-install-actions"
              :primary-action-text="pluginStoreMessage('pluginStore.action.update')"
              :primary-button-attributes="{ class: 'plugin-store-update-button' }"
              :is-primary-action-disabled="isPluginBusy(item.meta.id) || isCatalogUnavailable"
              :show-secondary-action="false"
              @primary-click="handleRemoteUpdate(item)"
            />
            <Switch
              v-else-if="!item.runtimeUnavailable && !canInstallPlugin(item) && !isRemoteInstallBlocked(item)"
              :model-value="item.state === 'enabled'"
              :disabled="!canTogglePlugin(item) || isPluginBusy(item.meta.id)"
              :ariaLabel="pluginToggleAriaLabel(item.meta.name)"
              @update:model-value="enabled => handlePluginEnabledChange(item, enabled)"
            />

            <ActionButtons
              v-if="canInstallPlugin(item) || isRemoteInstallBlocked(item)"
              class="plugin-store-install-actions"
              :primary-action-text="installActionText(item)"
              :primary-button-attributes="{ class: 'plugin-store-install-button' }"
              :is-primary-action-disabled="isPluginBusy(item.meta.id) || isRemoteInstallBlocked(item)"
              :show-secondary-action="false"
              @primary-click="handleInstall(item)"
            />
          </div>
        </article>
      </section>
    </div>

    <Modal
      :is-visible="uninstallDialogItem !== null"
      :title="pluginStoreMessage(uninstallDialogItem?.state === 'missing' ? 'pluginStore.data.delete' : 'pluginStore.dialog.uninstallTitle')"
      width="480px"
      min-height="auto"
      layer="alert"
      @close="closeUninstallDialog"
    >
      <div v-if="uninstallDialogItem" class="plugin-store-uninstall-dialog">
        <p v-if="uninstallDialogItem.state !== 'missing'">
          {{ pluginStoreMessage('pluginStore.data.uninstallMessage', { pluginName: uninstallDialogItem.meta.name }) }}
        </p>
        <p v-if="uninstallDialogItem.data?.status === 'cleaning'" class="plugin-store-alert">
          {{ pluginStoreMessage('pluginStore.data.cleaningHint') }}
        </p>
        <CustomCheckbox v-if="uninstallDialogItem.state !== 'missing' && uninstallDialogItem.data?.canDelete" v-model="deleteDataChecked">
          {{ pluginStoreMessage('pluginStore.data.deleteOption', { bytes: formatStorageBytes(uninstallDialogItem.data.bytes, currentLocale) }) }}
        </CustomCheckbox>
        <div v-if="deleteDataChecked && uninstallDialogItem.data" class="plugin-store-uninstall-dialog__details">
          <p>{{ pluginStoreMessage('pluginStore.data.deleteRisk') }}</p>
          <dl>
            <div><dt>{{ pluginStoreMessage('pluginStore.data.source') }}</dt><dd>{{ formatStorageBytes(uninstallDialogItem.data.directories.source, currentLocale) }}</dd></div>
            <div><dt>{{ pluginStoreMessage('pluginStore.data.derived') }}</dt><dd>{{ formatStorageBytes(uninstallDialogItem.data.directories.derived, currentLocale) }}</dd></div>
            <div><dt>{{ pluginStoreMessage('pluginStore.data.runtime') }}</dt><dd>{{ formatStorageBytes(uninstallDialogItem.data.directories.runtime, currentLocale) }}</dd></div>
          </dl>
        </div>
      </div>
      <template #footer>
        <div class="alert-dialog-footer">
          <ActionButtons
            :secondary-action-text="pluginStoreMessage('pluginStore.dialog.cancel')"
            :primary-action-text="uninstallDialogItem?.state === 'missing' ? pluginStoreMessage('pluginStore.data.delete') : deleteDataChecked ? pluginStoreMessage('pluginStore.dialog.uninstallDelete') : pluginStoreMessage('pluginStore.action.uninstall')"
            :primary-variant="deleteDataChecked ? 'danger' : 'default'"
            @secondary-click="closeUninstallDialog"
            @primary-click="confirmUninstall"
          />
        </div>
      </template>
    </Modal>
  </main>
</template>

<script setup lang="ts">
import { formatStorageBytes, useLocalization } from '@app/localization';
import type { PluginId, PluginRemoteCatalogItem, PluginStoreDetail, PluginStoreListItem } from '@app/schemas';
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, type Component, type PropType } from 'vue';
import { storeToRefs } from 'pinia';
import { AppsIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { DeleteIcon } from '@linnya/renderer-ui/icons';
import {
  ActionButtons,
  CustomCheckbox,
  Modal,
  PageSectionHeader,
  SegmentedTabs,
  Skeleton,
  SkeletonBlock,
  Switch,
  TagChip,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { useNotificationStore } from '@/app/notification';
import { confirm } from '@/shared/composables/confirmDialog';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { loadRuntimeRendererPlugins } from '@/app/plugins/loader/runtimeRendererPluginLoader';
import { useDocumentTypes } from '@/app/plugins/composables';
import {
  normalizePluginRuntimeUserError,
  type PluginRuntimeUserError,
} from '@/app/plugins/definitions/pluginRuntimeErrors';
import {
  canInstallPluginFromBundled,
  canInstallPluginFromRemote,
  canTogglePlugin,
  canUninstallPlugin,
  getPluginStateLabel,
  getPluginStateTone,
  isRequiredPlugin,
} from '../functions/pluginStorePresentation';
import { resolvePluginRuntimeUserErrorMessage } from '../functions/pluginRuntimeErrorPresentation';
import {
  canRetryRemoteFailure,
  hasRemoteUpdate,
  isRemoteInstallable,
  resolveRemoteFailureMessage,
  resolveRemoteFailureShortMessage,
  resolveRuntimeDisplayName,
  toRemoteOnlyStoreItem,
} from '../functions/pluginRemoteInstallPresentation';
import {
  summarizeRemoteInstallProgress,
  type RemoteInstallProgressSummary,
} from '../functions/pluginRemoteInstallProgress';
import { usePluginRemoteInstallStore } from '../store/pluginRemoteInstallStore';
import { usePluginStoreLocalization } from './usePluginStoreLocalization';
import PluginDataPanel from './PluginDataPanel.vue';
import type { PluginStoreMessageKey } from '../definitions/pluginStoreMessages';

/* 加载骨架的固定形状：与真实卡片、详情的版式一致，每次渲染保持不变。 */
const LIST_SKELETON_CARDS = [
  { title: '22%', description: '64%' },
  { title: '30%', description: '52%' },
  { title: '18%', description: '70%' },
] as const;
const DETAIL_SKELETON_LINES = ['92%', '86%', '74%', '48%'] as const;

type PluginStoreTabId = 'installed' | 'market';
type PluginCapabilityItem = NonNullable<PluginStoreDetail['skills']>[number];

const PluginCapabilityList = defineComponent({
  name: 'PluginCapabilityList',
  props: {
    items: {
      type: Array as PropType<readonly PluginCapabilityItem[]>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(
        'ul',
        { class: 'plugin-store-capability-list' },
        props.items.map(item =>
          h('li', { key: item.name }, [
            h('strong', item.name),
            item.description ? h('span', item.description) : null,
          ])
        )
      );
  },
});

const pluginsStore = useEnabledPluginsStore();
const notificationStore = useNotificationStore();
const documentTypes = useDocumentTypes();
const { pluginStoreMessage } = usePluginStoreLocalization();
const { currentLocale } = useLocalization();
const { storeItems, isStoreItemsLoading, storeItemsError, storeDetailsByPluginId, remoteServiceEnabled } =
  storeToRefs(pluginsStore);
const remoteInstallStore = usePluginRemoteInstallStore();
const { catalogItemsById, isCatalogUnavailable, progressByPluginId, outcomeByPluginId } = storeToRefs(remoteInstallStore);

const busyPluginIds = ref<ReadonlySet<PluginId>>(new Set());
const selectedPluginId = ref<PluginId | null>(null);
const isDetailLoading = ref(false);
const detailError = ref<PluginRuntimeUserError | null>(null);
const activeStoreTab = ref<PluginStoreTabId>('installed');
const releaseNotesExpanded = ref(false);
const uninstallDialogItem = ref<PluginStoreListItem | null>(null);
const deleteDataChecked = ref(false);
const localPluginIds = computed<ReadonlySet<PluginId>>(() => new Set(storeItems.value.map(item => item.meta.id)));
/** 只在已验签 catalog 中、本机从未登记的插件（例如不随安装包分发的插件）。 */
const remoteOnlyStoreItems = computed<PluginStoreListItem[]>(() =>
  [...catalogItemsById.value.values()]
    .filter(item => !localPluginIds.value.has(item.id))
    .map(toRemoteOnlyStoreItem)
);
const manageableStoreItems = computed<PluginStoreListItem[]>(() => [
  ...storeItems.value.filter(item => !isRequiredPlugin(item)),
  ...remoteOnlyStoreItems.value,
]);
const hasStoreItems = computed(() => manageableStoreItems.value.length > 0);
const installedStoreItems = computed<PluginStoreListItem[]>(() =>
  manageableStoreItems.value.filter(item => item.state !== 'missing')
);
const marketplaceStoreItems = computed<PluginStoreListItem[]>(() =>
  manageableStoreItems.value.filter(item => item.state === 'missing')
);
const visibleStoreItems = computed<PluginStoreListItem[]>(() =>
  activeStoreTab.value === 'market' ? marketplaceStoreItems.value : installedStoreItems.value
);
const hasVisibleStoreItems = computed(() => visibleStoreItems.value.length > 0);
const pluginStoreTabs = computed<readonly SegmentedTabItem[]>(() => [
  {
    id: 'installed',
    label: pluginStoreMessage('pluginStore.tabs.installed'),
    count: installedStoreItems.value.length,
  },
  {
    id: 'market',
    label: pluginStoreMessage('pluginStore.tabs.market'),
    count: marketplaceStoreItems.value.length,
  },
]);
const pluginHeaderMeta = computed(() => {
  if (!hasStoreItems.value) {
    return undefined;
  }
  if (activeStoreTab.value === 'market') {
    return pluginStoreMessage('pluginStore.headerMeta.market', {
      count: marketplaceStoreItems.value.length,
    });
  }
  return pluginStoreMessage('pluginStore.headerMeta.installed', {
    count: installedStoreItems.value.length,
  });
});
const visibleStoreEmptyTitle = computed(() =>
  activeStoreTab.value === 'market'
    ? pluginStoreMessage('pluginStore.empty.market')
    : pluginStoreMessage('pluginStore.empty.installed')
);
const storeItemsErrorMessage = computed(() =>
  storeItemsError.value === null
    ? null
    : resolvePluginRuntimeUserErrorMessage(storeItemsError.value, pluginStoreMessage)
);
const detailErrorMessage = computed(() =>
  detailError.value === null
    ? pluginStoreMessage('pluginStore.error.detailReadFallback')
    : resolvePluginRuntimeUserErrorMessage(detailError.value, pluginStoreMessage)
);
const releaseNotesToggleLabel = computed(() => (
  releaseNotesExpanded.value
    ? pluginStoreMessage('pluginStore.release.collapse')
    : pluginStoreMessage('pluginStore.release.expandAll')
));
const selectedDetail = computed<PluginStoreDetail | null>(() => {
  if (!selectedPluginId.value) {
    return null;
  }
  if (isRemoteOnly(selectedPluginId.value)) {
    // 本机没有该插件的详情来源；用 catalog 展示字段，安装完成后切回 Host 详情。
    return remoteOnlyStoreItems.value.find(item => item.meta.id === selectedPluginId.value) ?? null;
  }
  const detail = storeDetailsByPluginId.value[selectedPluginId.value] ?? null;
  if (!detail) {
    return null;
  }
  const liveStoreItem = storeItems.value.find(item => item.meta.id === selectedPluginId.value);
  if (!liveStoreItem) {
    return detail;
  }
  // 中文说明：详情接口会返回插件元信息和介绍，但启停/安装状态仍以运行态列表为准；
  // 否则后台刷新后卡片已更新，打开的详情弹窗还可能显示旧状态。
  return {
    ...detail,
    ...liveStoreItem,
  };
});
const selectedInstallSummary = computed(() =>
  selectedPluginId.value ? installSummaryFor(selectedPluginId.value) : null
);
const selectedOutcome = computed(() =>
  selectedPluginId.value ? outcomeByPluginId.value[selectedPluginId.value] ?? null : null
);
const selectedRemoteInstallable = computed(() => {
  const detail = selectedDetail.value;
  if (!detail || detail.state !== 'missing' || canInstallPluginFromBundled(detail)) return null;
  const remote = remoteItemFor(detail.meta.id);
  return remote?.availability.status === 'installable' ? remote.availability : null;
});
const selectedRemoteSize = computed(() => {
  const availability = selectedRemoteInstallable.value;
  return availability
    ? pluginStoreMessage('pluginStore.fact.sizeRemote', {
      download: formatStorageBytes(availability.downloadBytes, currentLocale.value),
      installed: formatStorageBytes(availability.unpackedBytes, currentLocale.value),
    })
    : null;
});
const selectedRuntimeNotes = computed(() => (selectedRemoteInstallable.value?.runtimes ?? []).map(runtime => {
  const params = {
    runtimeName: resolveRuntimeDisplayName(runtime.id, pluginStoreMessage),
    runtimeLabel: capitalize(runtime.id),
    version: runtime.version,
  };
  return runtime.installed
    ? pluginStoreMessage('pluginStore.runtime.installed', params)
    : pluginStoreMessage('pluginStore.runtime.included', { ...params, size: formatStorageBytes(runtime.downloadBytes, currentLocale.value) });
}));
const allReleaseNotes = computed(() => selectedDetail.value?.releaseNotes ?? []);
const visibleReleaseNotes = computed(() =>
  releaseNotesExpanded.value ? allReleaseNotes.value : allReleaseNotes.value.slice(0, 1)
);
const hasHiddenReleaseNotes = computed(() => allReleaseNotes.value.length > 1);
const pluginIconComponents = computed<ReadonlyMap<PluginId, Component>>(() => {
  const byPluginId = new Map<PluginId, Component>();
  const sortedDocumentTypes = [...documentTypes.value].sort(
    (left, right) => left.createPriority - right.createPriority
  );
  for (const documentType of sortedDocumentTypes) {
    if (!byPluginId.has(documentType.pluginId)) {
      byPluginId.set(documentType.pluginId, documentType.iconComponent);
    }
  }
  return byPluginId;
});

function resolvePluginStoreIconComponent(pluginId: PluginId): Component {
  return pluginIconComponents.value.get(pluginId) ?? AppsIcon;
}

function buildCapabilitySectionTitle(kind: 'skill' | 'agent', count: number): string {
  if (kind === 'skill') {
    return pluginStoreMessage(count === 1
      ? 'pluginStore.section.skill'
      : 'pluginStore.section.skills');
  }
  return pluginStoreMessage(count === 1
    ? 'pluginStore.section.agent'
    : 'pluginStore.section.agents');
}



function isPluginBusy(pluginId: PluginId): boolean {
  return busyPluginIds.value.has(pluginId) || isRemoteInstalling(pluginId);
}

function isRemoteOnly(pluginId: PluginId): boolean {
  return !localPluginIds.value.has(pluginId) && catalogItemsById.value.has(pluginId);
}

function remoteItemFor(pluginId: PluginId): PluginRemoteCatalogItem | undefined {
  return catalogItemsById.value.get(pluginId);
}

function isRemoteInstalling(pluginId: PluginId): boolean {
  return Object.prototype.hasOwnProperty.call(progressByPluginId.value, pluginId);
}

function installSummaryFor(pluginId: PluginId): RemoteInstallProgressSummary | null {
  const progress = progressByPluginId.value[pluginId];
  return progress ? summarizeRemoteInstallProgress(progress) : null;
}

function cardInstallRatio(item: PluginStoreListItem): number | null {
  return installSummaryFor(item.meta.id)?.ratio ?? null;
}

function hasPluginRemoteUpdate(item: PluginStoreListItem): boolean {
  return remoteServiceEnabled.value && !isRemoteInstalling(item.meta.id) && hasRemoteUpdate(item, remoteItemFor(item.meta.id));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type PluginChipTone = ReturnType<typeof getPluginStateTone> | 'error';

/** 状态标签：安装中与安装失败优先于安装状态；失败用错误色调，便于在列表里一眼认出。 */
function resolvePluginChip(item: PluginStoreListItem): { readonly label: string; readonly tone: PluginChipTone } {
  if (isRemoteInstalling(item.meta.id)) return { label: pluginStoreMessage('pluginStore.state.installing'), tone: 'warning' };
  if (outcomeByPluginId.value[item.meta.id]?.kind === 'failed') {
    return { label: pluginStoreMessage('pluginStore.state.installFailed'), tone: 'error' };
  }
  if (hasPluginRemoteUpdate(item)) return { label: pluginStoreMessage('pluginStore.state.updateAvailable'), tone: 'warning' };
  return { label: resolvePluginStateLabel(item), tone: item.runtimeUnavailable ? 'warning' : getPluginStateTone(item.state) };
}

function resolveCardMeta(item: PluginStoreListItem): string[] {
  const summary = installSummaryFor(item.meta.id);
  if (summary) {
    return [summary.totalBytes === null
      ? resolvePhaseLabel(item, summary)
      : pluginStoreMessage('pluginStore.card.downloading', {
        received: formatStorageBytes(summary.receivedBytes, currentLocale.value),
        total: formatStorageBytes(summary.totalBytes, currentLocale.value),
      })];
  }
  const outcome = outcomeByPluginId.value[item.meta.id];
  if (outcome?.kind === 'failed') return [resolveRemoteFailureShortMessage(outcome.error, pluginStoreMessage)];
  const remote = remoteItemFor(item.meta.id);
  if (remote && hasPluginRemoteUpdate(item) && remote.availability.status === 'installable') {
    return [
      pluginStoreMessage('pluginStore.card.updateFromTo', { current: item.meta.version, latest: remote.version }),
      pluginStoreMessage('pluginStore.card.downloadSize', { size: formatStorageBytes(remote.availability.downloadBytes, currentLocale.value) }),
    ];
  }
  const version = `${pluginStoreMessage('pluginStore.fact.version')} ${item.meta.version}`;
  if (remote && item.state === 'missing' && !canInstallPluginFromBundled(item)) {
    const availability = remote.availability;
    if (availability.status === 'installable') {
      return [version, pluginStoreMessage('pluginStore.card.downloadSize', { size: formatStorageBytes(availability.downloadBytes, currentLocale.value) })];
    }
    if (availability.status === 'requires-app-update') {
      return [version, pluginStoreMessage('pluginStore.card.requiresAppUpdate', { minApp: availability.minApp })];
    }
    return [version, pluginStoreMessage(availability.status === 'incompatible'
      ? 'pluginStore.card.incompatible'
      : 'pluginStore.card.unsupportedPlatform')];
  }
  return [
    version,
    `${pluginStoreMessage('pluginStore.fact.developer')} ${item.meta.developer}`,
    ...(item.data?.status === 'legacy' ? [formatLegacyStorageNotice(item.data.bytes)] : []),
  ];
}

function resolvePhaseLabel(item: PluginStoreListItem, summary: RemoteInstallProgressSummary): string {
  const current = summary.current;
  if (!current) return pluginStoreMessage('pluginStore.install.phase.preparing');
  if (current.stage === 'installing') return pluginStoreMessage('pluginStore.install.phase.installing');
  return current.item.kind === 'runtime'
    ? pluginStoreMessage('pluginStore.install.phase.runtime', { runtimeName: resolveRuntimeDisplayName(current.item.id, pluginStoreMessage) })
    : pluginStoreMessage('pluginStore.install.phase.plugin', { pluginName: item.meta.name });
}

function resolveInstallPhaseText(item: PluginStoreListItem, summary: RemoteInstallProgressSummary): string {
  const phase = resolvePhaseLabel(item, summary);
  const current = summary.current;
  if (current?.stage !== 'downloading' || current.item.totalBytes === null) return phase;
  const progress = progressByPluginId.value[item.meta.id];
  const key = `${current.item.kind}:${current.item.id}@${current.item.version}`;
  return pluginStoreMessage('pluginStore.install.phaseBytes', {
    phase,
    received: formatStorageBytes(Math.min(progress?.receivedByItem[key] ?? 0, current.item.totalBytes), currentLocale.value),
    total: formatStorageBytes(current.item.totalBytes, currentLocale.value),
  });
}

function resolveBackgroundHint(summary: RemoteInstallProgressSummary): string {
  return summary.totalBytes === null
    ? pluginStoreMessage('pluginStore.install.backgroundHintNoTotal')
    : pluginStoreMessage('pluginStore.install.backgroundHint', { total: formatStorageBytes(summary.totalBytes, currentLocale.value) });
}

function resolveFailureMessage(item: PluginStoreListItem, error: PluginRuntimeUserError): string {
  return resolveRemoteFailureMessage({
    error,
    pluginName: item.meta.name,
    remote: remoteItemFor(item.meta.id),
    resolveMessage: pluginStoreMessage,
    formatBytes: bytes => formatStorageBytes(bytes, currentLocale.value),
  });
}

function installActionText(item: PluginStoreListItem): string {
  const outcome = outcomeByPluginId.value[item.meta.id];
  return outcome?.kind === 'failed' && canRetryRemoteFailure(outcome.error)
    ? pluginStoreMessage('pluginStore.action.retry')
    : pluginStoreMessage('pluginStore.action.install');
}

async function cancelRemoteInstall(pluginId: PluginId): Promise<void> {
  await remoteInstallStore.cancel(pluginId);
}

function canInstallSelectedPlugin(detail: PluginStoreDetail | null): boolean {
  return detail !== null && canInstallPlugin(detail);
}

function canInstallPlugin(item: PluginStoreListItem): boolean {
  const blockedByCleanup = item.data?.status === 'cleaning' || item.data?.status === 'failed';
  return !blockedByCleanup && (canInstallPluginFromBundled(item) || canInstallRemotely(item));
}

/** 来源已开放但暂时连不上：未安装且没有随包来源的插件显示不可点的安装按钮，原因由页面顶部提示说明。 */
function isRemoteInstallBlocked(item: PluginStoreListItem): boolean {
  return remoteServiceEnabled.value
    && isCatalogUnavailable.value
    && item.state === 'missing'
    && !isRequiredPlugin(item)
    && !canInstallPluginFromBundled(item);
}

/** 远程安装需要来源开放、catalog 可用且列出本 Host 可装的版本。 */
function canInstallRemotely(item: PluginStoreListItem): boolean {
  return canInstallPluginFromRemote(item, remoteServiceEnabled.value)
    && !isCatalogUnavailable.value
    && isRemoteInstallable(remoteItemFor(item.meta.id));
}

function canToggleSelectedPlugin(detail: PluginStoreDetail | null): boolean {
  return detail !== null && canTogglePlugin(detail);
}

function isSelectedPluginBusy(detail: PluginStoreDetail | null): boolean {
  return detail !== null && isPluginBusy(detail.meta.id);
}

function handleSelectedPluginEnabledChange(
  detail: PluginStoreDetail | null,
  enabled: boolean,
): void {
  if (detail === null) {
    return;
  }
  void handlePluginEnabledChange(detail, enabled);
}

function handleSelectedInstall(detail: PluginStoreDetail | null): void {
  if (detail === null) {
    return;
  }
  void handleInstall(detail);
}

function setPluginBusy(pluginId: PluginId, busy: boolean): void {
  const next = new Set(busyPluginIds.value);
  if (busy) {
    next.add(pluginId);
  } else {
    next.delete(pluginId);
  }
  busyPluginIds.value = next;
}

function readErrorMessage(caught: unknown): PluginRuntimeUserError {
  return pluginsStore.normalizeUserError(caught);
}

function resolveErrorMessage(error: PluginRuntimeUserError): string {
  return resolvePluginRuntimeUserErrorMessage(error, pluginStoreMessage);
}

function resolveDeactivationFailure(caught: unknown, fallback: 'pluginStore.error.toggleFailed' | 'pluginStore.error.uninstallFailed'): string {
  const error = readErrorMessage(caught);
  return error.code === 'pluginOperationActiveTool' ? resolveErrorMessage(error) : pluginStoreMessage(fallback);
}

function resolvePluginStateLabel(item: PluginStoreListItem): string {
  if (item.runtimeUnavailable) return pluginStoreMessage('pluginStore.state.runtimeUnavailable');
  if (item.data?.status === 'cleaning') return pluginStoreMessage('pluginStore.data.status.cleaning');
  if (item.data?.status === 'failed') return pluginStoreMessage('pluginStore.data.status.failed');
  if (item.data?.status === 'unavailable') return pluginStoreMessage('pluginStore.data.status.unavailable');
  if (item.data?.status === 'retained') return pluginStoreMessage('pluginStore.data.status.retained');
  return getPluginStateLabel(item.state, pluginStoreMessage);
}

function formatLegacyStorageNotice(bytes: number): string {
  return pluginStoreMessage('pluginStore.state.legacyStorage', { bytes: formatStorageBytes(bytes, currentLocale.value) });
}

function pluginDetailAriaLabel(pluginName: string): string {
  return pluginStoreMessage('pluginStore.card.viewDetail', { pluginName });
}

function pluginIconAriaLabel(pluginName: string): string {
  return pluginStoreMessage('pluginStore.pluginIcon.ariaLabel', { pluginName });
}

function pluginToggleAriaLabel(pluginName: string): string {
  return pluginStoreMessage('pluginStore.toggle.ariaLabel', { pluginName });
}

function setActiveStoreTab(tabId: string): void {
  if (tabId === 'installed' || tabId === 'market') {
    activeStoreTab.value = tabId;
  }
}

async function refreshPluginStoreItems(): Promise<void> {
  try {
    await pluginsStore.refreshStoreItems();
  } catch (caught) {
    notificationStore.show(
      pluginStoreMessage('pluginStore.error.listRefreshFailed', {
        errorMessage: resolveErrorMessage(readErrorMessage(caught)),
      }),
      'error',
      4000,
    );
  }
}

async function handlePluginEnabledChange(
  item: PluginStoreListItem,
  enabled: boolean
): Promise<void> {
  if (!canTogglePlugin(item) || isPluginBusy(item.meta.id)) {
    return;
  }

  setPluginBusy(item.meta.id, true);
  try {
    await pluginsStore.setPluginEnabled(item.meta.id, enabled);
    await loadRuntimeRendererPlugins();
    if (selectedPluginId.value === item.meta.id) {
      await pluginsStore.loadStoreDetail(item.meta.id);
    }
    notificationStore.show(
      pluginStoreMessage(enabled ? 'pluginStore.toast.enabled' : 'pluginStore.toast.disabled', {
        pluginName: item.meta.name,
      }),
      'success',
      2500,
    );
  } catch (caught) {
    notificationStore.show(
      resolveDeactivationFailure(caught, 'pluginStore.error.toggleFailed'),
      'error',
      4000,
    );
    await refreshPluginStoreItems();
  } finally {
    setPluginBusy(item.meta.id, false);
  }
}

async function refreshSelectedPluginDetail(pluginId: PluginId): Promise<void> {
  if (selectedPluginId.value === pluginId) {
    await pluginsStore.loadStoreDetail(pluginId);
  }
}

interface RemotePluginInstallOptions {
  readonly notifyCurrent: boolean;
  readonly failureMessageKey: Extract<
    PluginStoreMessageKey,
    'pluginStore.error.installFailed' | 'pluginStore.error.updateFailed'
  >;
}

async function runRemotePluginInstall(
  item: PluginStoreListItem,
  options: RemotePluginInstallOptions
): Promise<void> {
  if (isPluginBusy(item.meta.id)) {
    return;
  }

  setPluginBusy(item.meta.id, true);
  try {
    const result = await remoteInstallStore.install(item.meta.id);

    if (result.status === 'installed') {
      if (item.state !== 'disabled') {
        await loadRuntimeRendererPlugins();
      }
      await refreshSelectedPluginDetail(item.meta.id);
      notificationStore.show(
        pluginStoreMessage(
          result.restartRequired
            ? (item.state === 'missing'
              ? 'pluginStore.toast.installedRestart'
              : 'pluginStore.toast.updatedRestart')
            : (item.state === 'missing' ? 'pluginStore.toast.installed' : 'pluginStore.toast.updated'),
          { pluginName: item.meta.name },
        ),
        result.restartRequired ? 'warning' : 'success',
        5000
      );
    } else if (result.status === 'failed') {
      throw normalizePluginRuntimeUserError({
        code: result.errorCode ?? 'unknown',
        pluginId: result.pluginId,
      });
    } else if (result.reason === 'current') {
      if (options.notifyCurrent) {
        notificationStore.show(
          pluginStoreMessage('pluginStore.toast.current', { pluginName: item.meta.name }),
          'info',
          3000,
        );
      }
    } else {
      notificationStore.show(
        pluginStoreMessage('pluginStore.toast.incompatible', {
          pluginName: item.meta.name,
        }),
        'warning',
        5000
      );
    }
  } catch (caught) {
    const error = readErrorMessage(caught);
    // 用户主动取消不是错误：详情页显示“已取消”，不再弹出失败提示。
    if (error.code !== 'pluginOperationCancelled') {
      notificationStore.show(
        pluginStoreMessage(options.failureMessageKey === 'pluginStore.error.installFailed'
          ? 'pluginStore.error.installFailedWithReason'
          : options.failureMessageKey, {
          errorMessage: resolveFailureMessage(item, error),
        }),
        'error',
        5000,
      );
    }
    await refreshPluginStoreItems();
  } finally {
    setPluginBusy(item.meta.id, false);
  }
}

async function handleRemoteInstall(item: PluginStoreListItem): Promise<void> {
  if (!canInstallRemotely(item)) {
    return;
  }

  await runRemotePluginInstall(item, {
    notifyCurrent: true,
    failureMessageKey: 'pluginStore.error.installFailed',
  });
}

async function handleBundledInstall(item: PluginStoreListItem): Promise<void> {
  if (!canInstallPluginFromBundled(item) || isPluginBusy(item.meta.id)) {
    return;
  }

  setPluginBusy(item.meta.id, true);
  try {
    const result = await pluginsStore.installPluginFromBundled(item.meta.id);
    if (result.status === 'installed') {
      if (!result.restartRequired) {
        await loadRuntimeRendererPlugins();
      }
      await refreshSelectedPluginDetail(item.meta.id);
      notificationStore.show(
        pluginStoreMessage(
          result.restartRequired
            ? 'pluginStore.toast.installedRuntimeRefresh'
            : 'pluginStore.toast.installed',
          { pluginName: item.meta.name },
        ),
        result.restartRequired ? 'warning' : 'success',
        5000,
      );
    } else if (result.status === 'failed') {
      throw normalizePluginRuntimeUserError({
        code: result.errorCode ?? 'unknown',
        pluginId: result.pluginId,
      });
    }
  } catch (caught) {
    notificationStore.show(
      pluginStoreMessage('pluginStore.error.installFailedWithReason', {
        errorMessage: resolveErrorMessage(readErrorMessage(caught)),
      }),
      'error',
      5000,
    );
    await refreshPluginStoreItems();
  } finally {
    setPluginBusy(item.meta.id, false);
  }
}

async function handleInstall(item: PluginStoreListItem): Promise<void> {
  if (canInstallPluginFromBundled(item)) {
    await handleBundledInstall(item);
    return;
  }
  await handleRemoteInstall(item);
}

async function handleRemoteUpdate(item: PluginStoreListItem): Promise<void> {
  if (!hasPluginRemoteUpdate(item) || isCatalogUnavailable.value) {
    return;
  }
  await runRemotePluginInstall(item, {
    notifyCurrent: false,
    failureMessageKey: 'pluginStore.error.updateFailed',
  });
}

function handleSelectedRemoteUpdate(detail: PluginStoreDetail | null): void {
  if (detail !== null) void handleRemoteUpdate(detail);
}

async function handlePluginUninstall(item: PluginStoreListItem): Promise<void> {
  if (!canUninstallPlugin(item, remoteServiceEnabled.value) || isPluginBusy(item.meta.id)) {
    return;
  }
  if (item.data?.canDelete) {
    uninstallDialogItem.value = item;
    deleteDataChecked.value = false;
    return;
  }
  const confirmed = await confirm({
    message: pluginStoreMessage('pluginStore.confirm.uninstall', {
      pluginName: item.meta.name,
    }),
    isDangerousAction: true,
  });
  if (!confirmed) {
    return;
  }

  await executeUninstall(item, false);
}

function closeUninstallDialog(): void {
  uninstallDialogItem.value = null;
  deleteDataChecked.value = false;
}

async function confirmUninstall(): Promise<void> {
  const item = uninstallDialogItem.value;
  if (!item) return;
  const deleteData = deleteDataChecked.value;
  closeUninstallDialog();
  if (item.state === 'missing') await retryDataCleanup(item);
  else await executeUninstall(item, deleteData);
}

function openDataDelete(item: PluginStoreListItem): void {
  uninstallDialogItem.value = item;
  deleteDataChecked.value = true;
}

function showDataLocation(item: PluginStoreListItem): void {
  void (async () => {
    try {
      const result = await window.electronAPI?.plugins.revealData(item.meta.id);
      if (!result?.success) throw new Error('file manager reveal failed');
    } catch {
      notificationStore.show(pluginStoreMessage('pluginStore.data.revealFailed'), 'error', 3500);
    }
  })();
}

async function retryDataCleanup(item: PluginStoreListItem): Promise<void> {
  if (isPluginBusy(item.meta.id)) return;
  setPluginBusy(item.meta.id, true);
  try {
    const result = await window.electronAPI?.plugins.cleanupData(item.meta.id);
    if (!result?.success) throw normalizePluginRuntimeUserError(result?.error);
    await refreshPluginStoreItems();
    await refreshSelectedPluginDetail(item.meta.id);
    notificationStore.show(pluginStoreMessage('pluginStore.toast.cleanupCompleted', {
      pluginName: item.meta.name,
      bytes: formatStorageBytes(result.data?.releasedBytes ?? 0, currentLocale.value),
    }), 'success', 5000);
  } catch (caught) {
    notificationStore.show(pluginStoreMessage('pluginStore.error.uninstallFailed', {
      errorMessage: resolveErrorMessage(readErrorMessage(caught)),
    }), 'error', 5000);
  } finally {
    setPluginBusy(item.meta.id, false);
  }
}

async function stopDataCleanup(item: PluginStoreListItem): Promise<void> {
  await window.electronAPI?.plugins.stopCleanup(item.meta.id);
  await refreshPluginStoreItems();
  await refreshSelectedPluginDetail(item.meta.id);
}

async function setSelectedDataMeasurementPaused(paused: boolean): Promise<void> {
  const item = selectedDetail.value;
  if (!item) return;
  try {
    const result = await window.electronAPI?.plugins.setDataMeasurementPaused(item.meta.id, paused);
    if (!result?.success) throw normalizePluginRuntimeUserError(result?.error);
    // Host 通知后只刷新列表和当前数据；不会触发插件重新装配。
  } catch {
    notificationStore.show(pluginStoreMessage('pluginStore.data.measurementControlFailed'), 'error', 3500);
  }
}

async function executeUninstall(item: PluginStoreListItem, deleteData: boolean): Promise<void> {
  setPluginBusy(item.meta.id, true);
  try {
    const result = await pluginsStore.uninstallPlugin(item.meta.id, deleteData ? { deleteData: true } : {});
    await refreshSelectedPluginDetail(item.meta.id);
    if (result?.cleanupIncomplete) return;
    notificationStore.show(
      pluginStoreMessage(deleteData ? 'pluginStore.toast.cleanupCompleted' : 'pluginStore.toast.uninstalledRetained', {
        pluginName: item.meta.name,
        bytes: formatStorageBytes(result?.releasedBytes ?? 0, currentLocale.value),
      }),
      'success',
      5000,
    );
  } catch (caught) {
    notificationStore.show(
      resolveDeactivationFailure(caught, 'pluginStore.error.uninstallFailed'),
      'error',
      5000,
    );
    await refreshPluginStoreItems();
  } finally {
    setPluginBusy(item.meta.id, false);
  }
}

async function openPluginDetail(pluginId: PluginId): Promise<void> {
  selectedPluginId.value = pluginId;
  releaseNotesExpanded.value = false;
  detailError.value = null;
  if (isRemoteOnly(pluginId)) return;
  isDetailLoading.value = true;
  try {
    await pluginsStore.loadStoreDetail(pluginId);
  } catch (caught) {
    detailError.value = readErrorMessage(caught);
    notificationStore.show(
      pluginStoreMessage('pluginStore.error.detailReadFailed', {
        errorMessage: resolveErrorMessage(detailError.value),
      }),
      'error',
      4000,
    );
  } finally {
    isDetailLoading.value = false;
  }
}

async function handlePluginCardClick(item: PluginStoreListItem): Promise<void> {
  // 打开详情不再自动下载更新；是否有新版本来自已验签 catalog，由用户点“更新”。
  await openPluginDetail(item.meta.id);
}

function closePluginDetail(): void {
  selectedPluginId.value = null;
  releaseNotesExpanded.value = false;
  detailError.value = null;
}

function toggleReleaseNotesExpanded(): void {
  releaseNotesExpanded.value = !releaseNotesExpanded.value;
}

async function openExternalHomepage(url: string | undefined): Promise<void> {
  if (!url) {
    return;
  }

  try {
    const result = await window.electronAPI?.openExternalUrl(url);
    if (result && !result.success) {
      throw new Error(result.error ?? pluginStoreMessage('pluginStore.error.unknown'));
    }
    if (!result) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (caught) {
    notificationStore.show(
      pluginStoreMessage('pluginStore.error.homepageOpenFailed', {
        errorMessage: resolveErrorMessage(readErrorMessage(caught)),
      }),
      'error',
      3500,
    );
  }
}

let unsubscribeDataChanges: (() => void) | undefined;
onMounted(() => {
  unsubscribeDataChanges = pluginsStore.subscribeToDataChanges(() => selectedPluginId.value);
  void refreshPluginStoreItems();
  void remoteInstallStore.refreshCatalog();
});
onBeforeUnmount(() => unsubscribeDataChanges?.());
</script>
