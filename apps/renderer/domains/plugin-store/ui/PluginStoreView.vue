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
                  :class="`is-${getPluginStateTone(selectedDetail.state)}`"
                  :label="resolvePluginStateLabel(selectedDetail)"
                  :class-names="{ label: 'plugin-store-state-chip-label' }"
                />
              </div>
              <p>{{ selectedDetail.meta.description }}</p>
            </div>

            <div class="plugin-store-detail-actions">
              <Switch
                v-if="!canInstallSelectedPlugin(selectedDetail)"
                :model-value="selectedDetail.state === 'enabled'"
                :disabled="!canToggleSelectedPlugin(selectedDetail) || isSelectedPluginBusy(selectedDetail)"
                :ariaLabel="pluginToggleAriaLabel(selectedDetail.meta.name)"
                @update:model-value="enabled => handleSelectedPluginEnabledChange(selectedDetail, enabled)"
              />
              <ActionButtons
                v-if="canInstallSelectedPlugin(selectedDetail)"
                class="plugin-store-install-actions"
                :primary-action-text="pluginStoreMessage('pluginStore.action.install')"
                :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                :is-primary-action-disabled="isSelectedPluginBusy(selectedDetail)"
                :show-secondary-action="false"
                @primary-click="handleSelectedInstall(selectedDetail)"
              />
            </div>
          </section>

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
            v-if="selectedDetail.data"
            :data="selectedDetail.data"
            :locale="currentLocale"
            :can-delete="selectedDetail.data.canDelete"
            @delete="openDataDelete(selectedDetail)"
            @retry="retryDataCleanup(selectedDetail)"
            @stop="stopDataCleanup(selectedDetail)"
            @reveal="showDataLocation(selectedDetail)"
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
              <div v-if="selectedDetail.sizeBytes !== undefined" class="plugin-store-detail-fact">
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
          :class="{ 'is-busy': isPluginBusy(item.meta.id) }"
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
                :class="`is-${getPluginStateTone(item.state)}`"
                :label="resolvePluginStateLabel(item)"
                :class-names="{ label: 'plugin-store-state-chip-label' }"
              />
            </div>

            <p class="plugin-store-card-description">
              {{ item.meta.description }}
            </p>
            <div class="plugin-store-card-meta">
              <span>{{ pluginStoreMessage('pluginStore.fact.version') }} {{ item.meta.version }}</span>
              <span>{{ pluginStoreMessage('pluginStore.fact.developer') }} {{ item.meta.developer }}</span>
            </div>
          </div>

          <div class="plugin-store-card-actions" @click.stop @keydown.stop>
              <Switch
                v-if="!canInstallPlugin(item)"
                :model-value="item.state === 'enabled'"
                :disabled="!canTogglePlugin(item) || isPluginBusy(item.meta.id)"
                :ariaLabel="pluginToggleAriaLabel(item.meta.name)"
                @update:model-value="enabled => handlePluginEnabledChange(item, enabled)"
              />

            <ActionButtons
              v-if="canInstallPlugin(item)"
              class="plugin-store-install-actions"
              :primary-action-text="pluginStoreMessage('pluginStore.action.install')"
              :primary-button-attributes="{ class: 'plugin-store-install-button' }"
              :is-primary-action-disabled="isPluginBusy(item.meta.id)"
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
import type { PluginId, PluginStoreDetail, PluginStoreListItem } from '@app/schemas';
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
  canCheckPluginUpdateFromRemote,
  canInstallPluginFromBundled,
  canInstallPluginFromRemote,
  canTogglePlugin,
  canUninstallPlugin,
  getPluginStateLabel,
  getPluginStateTone,
  isRequiredPlugin,
} from '../functions/pluginStorePresentation';
import { resolvePluginRuntimeUserErrorMessage } from '../functions/pluginRuntimeErrorPresentation';
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

const busyPluginIds = ref<ReadonlySet<PluginId>>(new Set());
const selectedPluginId = ref<PluginId | null>(null);
const isDetailLoading = ref(false);
const detailError = ref<PluginRuntimeUserError | null>(null);
const activeStoreTab = ref<PluginStoreTabId>('installed');
const releaseNotesExpanded = ref(false);
const uninstallDialogItem = ref<PluginStoreListItem | null>(null);
const deleteDataChecked = ref(false);
const manageableStoreItems = computed<PluginStoreListItem[]>(() =>
  storeItems.value.filter(item => !isRequiredPlugin(item))
);
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
  return busyPluginIds.value.has(pluginId);
}

function canInstallSelectedPlugin(detail: PluginStoreDetail | null): boolean {
  return detail !== null && canInstallPlugin(detail);
}

function canInstallPlugin(item: PluginStoreListItem): boolean {
  const blockedByCleanup = item.data?.status === 'cleaning' || item.data?.status === 'failed';
  return !blockedByCleanup && (canInstallPluginFromBundled(item) || canInstallPluginFromRemote(item, remoteServiceEnabled.value));
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

function resolvePluginStateLabel(item: PluginStoreListItem): string {
  if (item.data?.status === 'cleaning') return pluginStoreMessage('pluginStore.data.status.cleaning');
  if (item.data?.status === 'failed') return pluginStoreMessage('pluginStore.data.status.failed');
  if (item.data?.status === 'unavailable') return pluginStoreMessage('pluginStore.data.status.unavailable');
  if (item.data?.status === 'legacy') return pluginStoreMessage('pluginStore.data.status.legacy');
  if (item.data?.status === 'retained') return pluginStoreMessage('pluginStore.data.status.retained');
  return getPluginStateLabel(item.state, pluginStoreMessage);
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
      pluginStoreMessage('pluginStore.error.toggleFailed', {
        errorMessage: resolveErrorMessage(readErrorMessage(caught)),
      }),
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
    const result = await pluginsStore.installPluginFromRemote(item.meta.id);

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
    notificationStore.show(
      pluginStoreMessage(options.failureMessageKey === 'pluginStore.error.installFailed'
        ? 'pluginStore.error.installFailedWithReason'
        : options.failureMessageKey, {
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

async function handleRemoteInstall(item: PluginStoreListItem): Promise<void> {
  if (!canInstallPluginFromRemote(item, remoteServiceEnabled.value)) {
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

async function checkPluginUpdateFromCard(
  item: PluginStoreListItem,
  options: { readonly silentFailure: boolean } = { silentFailure: false }
): Promise<void> {
  if (!canCheckPluginUpdateFromRemote(item, remoteServiceEnabled.value) || isPluginBusy(item.meta.id)) {
    return;
  }

  setPluginBusy(item.meta.id, true);
  try {
    const checkResult = await pluginsStore.checkPluginRemoteUpdate(item.meta.id);
    if (checkResult.status === 'available') {
      setPluginBusy(item.meta.id, false);
      await runRemotePluginInstall(item, {
        notifyCurrent: false,
        failureMessageKey: 'pluginStore.error.updateFailed',
      });
      return;
    }
    if (checkResult.status === 'incompatible') {
      notificationStore.show(
        pluginStoreMessage('pluginStore.toast.incompatible', { pluginName: item.meta.name }),
        'warning',
        5000,
      );
    } else if (checkResult.status === 'failed') {
      throw normalizePluginRuntimeUserError({
        code: checkResult.errorCode ?? 'unknown',
        pluginId: checkResult.pluginId,
      });
    }
  } catch (caught) {
    // 中文说明：打开详情时的自动更新检查是后台辅助动作；官方 latest.json
    // 尚未发布或开发环境离线时，不应把本地插件管理/打开流程打成红色错误。
    if (!options.silentFailure) {
      notificationStore.show(
        pluginStoreMessage('pluginStore.error.updateCheckFailed', {
          errorMessage: resolveErrorMessage(readErrorMessage(caught)),
        }),
        'error',
        5000,
      );
    }
  } finally {
    setPluginBusy(item.meta.id, false);
  }
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
      const result = await window.electronAPI?.plugins.getDataPath(item.meta.id);
      if (!result?.success || !result.data) throw new Error('data path unavailable');
      const revealed = await window.electronAPI?.showItemInFolder(result.data.path);
      if (!revealed?.success) throw new Error('file manager reveal failed');
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
      pluginStoreMessage('pluginStore.error.uninstallFailed', {
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

async function openPluginDetail(pluginId: PluginId): Promise<void> {
  selectedPluginId.value = pluginId;
  releaseNotesExpanded.value = false;
  isDetailLoading.value = true;
  detailError.value = null;
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
  await openPluginDetail(item.meta.id);
  await checkPluginUpdateFromCard(item, { silentFailure: true });
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
});
onBeforeUnmount(() => unsubscribeDataChanges?.());
</script>
