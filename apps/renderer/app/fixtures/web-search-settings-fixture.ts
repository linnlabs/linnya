import { createApp, defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import '../styles/index.css';
import '../../domains/settings/styles/index.css';
import SettingsModal from '../../domains/settings/ui/SettingsModal.vue';
import { ensureCoreSettingsContributionsRegistered } from '../../domains/settings/registry/registerCoreSettingsContributions';
import { initializeLocalization } from '../localization';
import {
  ensureSharedComponentLocalizationRegistered,
  provideSharedComponentLocalization,
} from '../localization/orchestration/provideSharedComponentLocalization';
import { useUIStore } from '../../shared/stores/ui';
import type {
  WebSearchConfigView,
  WebSearchKeySource,
} from '../../../../src/tools/web/websearch/definitions/webSearchConfig';
import type {
  WebReadConfigView,
  WebReadManagedReaderId,
} from '../../../../src/tools/web/webread/definitions/webReadConfig';
import { WEB_SEARCH_ENGINE_PRESENTATIONS } from '../../domains/settings/definitions/webSearchSettings';

let currentConfig: WebSearchConfigView = {
  engine: 'parallel_free',
  engines: {
    parallel_free: { keySource: 'none', hasByokKey: false },
  },
};

let currentReadConfig: WebReadConfigView = {
  renderEnabled: true,
  managedReader: 'none',
  readers: {
    metaso_reader: { hasStoredByokKey: true, credentialAvailable: true },
    jina_reader: { hasStoredByokKey: false, credentialAvailable: false },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManagedReader(value: unknown): value is WebReadManagedReaderId {
  return value === 'metaso_reader' || value === 'jina_reader' || value === 'none';
}

Object.defineProperty(window, 'electronAPI', {
  configurable: true,
  value: {
    openExternalUrl: async () => ({ success: true }),
    invoke: async (channel: string, input: unknown) => {
      if (channel === 'web-search-config:get') return { success: true, data: currentConfig };
      if (channel === 'web-search-config:set' && isRecord(input)) {
        const next = input;
        const engine = WEB_SEARCH_ENGINE_PRESENTATIONS.find((candidate) => candidate.id === next.engine)?.id
          ?? 'parallel_free';
        const keySource: WebSearchKeySource = next.keySource === 'byok' ? 'byok' : 'none';
        currentConfig = {
          engine,
          engines: {
            ...currentConfig.engines,
            [engine]: {
              keySource,
              hasByokKey: next.keySource === 'byok',
            },
          },
        };
        return { success: true, data: currentConfig };
      }
      if (channel === 'web-search-config:test-connection') {
        return {
          success: true,
          data: { provider: currentConfig.engine, resultCount: 1, tookMs: 186 },
        };
      }
      if (channel === 'web-read-config:get') return { success: true, data: currentReadConfig };
      if (channel === 'web-read-config:set' && isRecord(input)) {
        const reader = isManagedReader(input.managedReader) ? input.managedReader : 'none';
        const readers = { ...currentReadConfig.readers };
        if (reader !== 'none' && typeof input.byokKey === 'string' && input.byokKey.trim()) {
          readers[reader] = { hasStoredByokKey: true, credentialAvailable: true };
        }
        currentReadConfig = {
          renderEnabled: typeof input.renderEnabled === 'boolean'
            ? input.renderEnabled
            : currentReadConfig.renderEnabled,
          managedReader: reader,
          readers,
        };
        return { success: true, data: currentReadConfig };
      }
      if (channel === 'web-read-config:test-connection') {
        return {
          success: true,
          data: { provider: currentReadConfig.managedReader, charCount: 512, tookMs: 186 },
        };
      }
      return { success: false, error: `Fixture 不支持通道：${channel}` };
    },
  },
});

ensureCoreSettingsContributionsRegistered();
ensureSharedComponentLocalizationRegistered();

const app = createApp(defineComponent({
  setup: () => () => h(SettingsModal),
}));
const pinia = createPinia();
app.use(pinia);
provideSharedComponentLocalization(app);
initializeLocalization({ document });
useUIStore(pinia).openSettingsModal('web-search');
app.mount('#app');
