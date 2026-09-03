<template>
  <SettingsPage class="model-management-settings-page">
    <ModelVisibilitySettingsSection :activate-provider-model="activateConfiguredProviderModel" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { SettingsPage } from '@/domains/settings/public';
import ModelVisibilitySettingsSection from '../features/model-picker/ui/ModelVisibilitySettingsSection.vue';
import { activateConfiguredProviderModel } from '../orchestration/activateConfiguredProviderModel';
</script>
