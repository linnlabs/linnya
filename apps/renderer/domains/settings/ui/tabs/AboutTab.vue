<template>
  <SettingsPage>
    <SettingsSection :title="releasePresentation.title">
      <ul class="about-release-notes">
        <li
          v-for="note in releasePresentation.notes"
          :key="note"
        >
          {{ note }}
        </li>
      </ul>
    </SettingsSection>

    <SettingsSection :title="settingsMessage('settings.about.contact.title')">
      <div class="about-contact">
        <p>{{ settingsMessage('settings.about.contact.intro') }}</p>
        <p>{{ settingsMessage('settings.about.contact.feedbackGuidance') }}</p>
        <dl class="about-contact-list">
          <div>
            <dt>{{ settingsMessage('settings.about.contact.emailLabel') }}</dt>
            <dd>feedback@linnyai.com</dd>
          </div>
          <div>
            <dt>{{ settingsMessage('settings.about.contact.websiteLabel') }}</dt>
            <dd>linnyai.com</dd>
          </div>
          <div>
            <dt>{{ settingsMessage('settings.about.contact.tutorialLabel') }}</dt>
            <dd>linnyai.com/blog</dd>
          </div>
        </dl>
      </div>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup>
import { computed } from 'vue';
import { currentRelease } from '../../definitions/currentRelease.generated';
import { SettingsPage, SettingsSection } from '../kit';
import { useSettingsLocalization } from '../useSettingsLocalization';
import { resolveAboutReleasePresentation } from '../../functions/resolveAboutReleasePresentation';

const { settingsMessage } = useSettingsLocalization();
const releasePresentation = computed(() => (
  resolveAboutReleasePresentation(currentRelease, settingsMessage)
));
</script>
