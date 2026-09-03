import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';

export const useConversationTitleSettingsStore = defineStore('conversationTitleSettings', {
  state: () => ({
    isAutomaticTitleEnabled: true,
  }),

  actions: {
    setAutomaticTitleEnabled(enabled: boolean) {
      this.isAutomaticTitleEnabled = enabled;
    },
  },

  persist: {
    key: 'conversation-title-settings',
    storage: getRendererPersistStorage(),
    pick: ['isAutomaticTitleEnabled'],
  },
});
