<template>
  <Modal 
    :isVisible="showDialog" 
    :title="modalTitle"
    :closeOnOverlayClick="!isBusy"
    @close="handleClose"
    width="400px"
    scroll-mode="internal"
  >
    <div class="update-dialog-content">
      <div class="update-dialog-body">
        <!-- 更新日志 -->
        <div v-if="shouldShowReleaseNotes" class="update-dialog-section release-notes-section">
          <div class="update-dialog-section-title">{{ updateMessage('update.dialog.releaseNotes') }}</div>
          <div class="update-dialog-section-content release-notes" v-html="formattedReleaseNotes"></div>
        </div>

        <!-- 下载进度 -->
        <div v-if="isDownloading" class="update-dialog-section">
          <div class="update-dialog-section-title">{{ updateMessage('update.dialog.downloadProgress') }}</div>
          <div class="update-dialog-section-content">
            <div class="progress-bar">
              <div class="progress-bar-inner" :style="{ width: downloadPercentage + '%' }"></div>
            </div>
            <div class="progress-details">
              <span>{{ downloadPercentage }}%</span>
              <span>{{ downloadedSize }} / {{ totalSize }}</span>
              <span>{{ downloadSpeed }}</span>
            </div>
          </div>
        </div>

        <!-- 安装重启 -->
        <div v-if="isInstalling" class="update-dialog-section">
          <div class="update-dialog-section-content download-complete">
            <h4>{{ updateMessage('update.dialog.installing.title') }}</h4>
            <p>{{ updateMessage('update.dialog.installing.description') }}</p>
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="hasError" class="update-dialog-section">
          <div class="update-dialog-section-content error-container">
            <h4>{{ updateMessage('update.dialog.error.title') }}</h4>
            <p class="error-message">{{ displayErrorInfo }}</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="update-dialog-footer">
        <ActionButtons
          v-if="updateAvailable"
          :secondary-action-text="updateMessage('update.dialog.actions.remindLater')"
          :primary-action-text="updateMessage('update.dialog.actions.updateNow')"
          @secondary-click="remindLater"
          @primary-click="startDownload"
        />
        <ActionButtons
          v-else-if="isDownloading || isInstalling"
          :secondary-action-text="busyActionText"
          :is-secondary-action-disabled="true"
          :show-primary-action="false"
          @secondary-click="() => {}"
        />
        <ActionButtons
          v-else-if="hasError"
          :secondary-action-text="updateMessage('update.dialog.actions.close')"
          :primary-action-text="updateMessage('update.dialog.actions.retry')"
          @secondary-click="closeDialog"
          @primary-click="retry"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useUpdateStore } from '../store/updateStore';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ActionButtons, Modal } from '@linnya/renderer-ui';
import { useUpdateLocalization } from './useUpdateLocalization';

const store = useUpdateStore();
const { status, versionInfo, progressInfo, errorInfo } = storeToRefs(store);
const { updateMessage } = useUpdateLocalization();

// 中文：用 status 做严格判断，避免把 Pinia 的 ref/computed 当成 truthy 对象导致误显示
const updateAvailable = computed(() => status.value === 'available');
const isDownloading = computed(() => status.value === 'downloading');
const updateDownloaded = computed(() => status.value === 'downloaded');
const isInstalling = computed(() => status.value === 'installing');
const hasError = computed(() => status.value === 'error');
const isChecking = computed(() => status.value === 'checking');
const isNotAvailable = computed(() => status.value === 'not-available');
const isBusy = computed(() => isDownloading.value || isInstalling.value);

const isDev = computed(() => !!import.meta.env.DEV);

/**
 * 弹窗策略（中文）
 * - 生产环境：只有发现新版本/下载过程/下载完成/出错 才弹
 * - 开发环境：随时弹（checking / not-available / available / downloading / downloaded / error），并展示日志
 */
const showDialog = computed(() => {
  if (isDev.value) {
    return (
      isChecking.value ||
      isNotAvailable.value ||
      updateAvailable.value ||
      isDownloading.value ||
      updateDownloaded.value ||
      isInstalling.value ||
      hasError.value
    );
  }

  return updateAvailable.value || isDownloading.value || updateDownloaded.value || isInstalling.value || hasError.value;
});

// 中文：仅在开发环境输出调试日志，避免生产环境污染控制台
if (import.meta.env.DEV) {
  watch(showDialog, (newValue, oldValue) => {
    console.log(`[UpdateDialog] 'showDialog' computed property changed. Old: ${oldValue}, New: ${newValue}`);
  });
}

// 计算模态框标题
const modalTitle = computed(() => {
  if (isInstalling.value) return updateMessage('update.dialog.title.installing');
  if (versionInfo.value?.version) {
    return updateMessage('update.dialog.title.availableWithVersion', { version: versionInfo.value.version });
  }
  return updateMessage('update.dialog.title.available');
});

const formattedReleaseNotes = computed(() => {
  if (!versionInfo.value) return '';
  if (versionInfo.value.releaseNotes) {
    const rawHtml = marked.parse(versionInfo.value.releaseNotes, { gfm: true, breaks: true, async: false });
    if (typeof rawHtml !== 'string') return '';
    return DOMPurify.sanitize(rawHtml);
  }
  return '';
});

const displayErrorInfo = computed(() => {
  const error = errorInfo.value;
  if (!error) return updateMessage('update.dialog.error.default');
  if (error.kind === 'ipc-unavailable') {
    return updateMessage('update.dialog.error.ipcUnavailable', { channel: error.channel });
  }
  return updateMessage('update.dialog.error.dynamic');
});

/**
 * 更新日志展示策略（中文）
 * - 开发环境：只要拿到了 releaseNotes，就展示（无论是否有更新）
 * - 生产环境：仅在确认有更新时展示
 */
const shouldShowReleaseNotes = computed(() => {
  if (!versionInfo.value?.releaseNotes) return false;
  return isDev.value ? true : updateAvailable.value || isDownloading.value || isInstalling.value;
});

const downloadPercentage = computed(() => {
  return progressInfo.value ? Math.round(progressInfo.value.percent || 0) : 0;
});

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const downloadedSize = computed(() => formatBytes(progressInfo.value?.transferred || 0));
const totalSize = computed(() => formatBytes(progressInfo.value?.total || 0));
const downloadSpeed = computed(() => {
  // 优先使用计算出的瞬时速度，如果不存在则使用平均速度
  const speed = progressInfo.value?.instantSpeed ?? progressInfo.value?.bytesPerSecond ?? 0;
  return formatBytes(speed) + '/s';
});

const busyActionText = computed(() => {
  if (isInstalling.value) return updateMessage('update.dialog.busy.installingRestart');
  return updateMessage('update.dialog.busy.downloading');
});

function startDownload(): void {
  store.startDownload();
}

function remindLater(): void {
  store.reset();
}

function closeDialog(): void {
  store.reset();
}

function retry(): void {
  store.checkForUpdates();
}

// 处理 Modal 的 close 事件
function handleClose(): void {
  // 下载或安装期间不允许关闭，避免用户误以为更新流程已经取消。
  if (!isBusy.value) {
    closeDialog();
  }
}
</script>
