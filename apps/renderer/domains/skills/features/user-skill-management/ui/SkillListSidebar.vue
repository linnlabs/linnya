<template>
  <nav
    ref="hostRef"
    class="skills-sidebar"
    :aria-label="message('installed')"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
  >
    <div
      ref="viewportMountRef"
      class="skills-sidebar-viewport"
      data-overlayscrollbars-initialize
    >
      <div class="skills-sidebar-content">
        <section
          v-for="group in groups"
          :key="group.source"
          class="skills-group"
        >
          <h4 class="skills-group-title">
            <span>{{ message(groupTitleKeys[group.source]) }}</span>
            <span>{{ group.skills.length }}</span>
          </h4>
          <p
            v-if="!group.skills.length"
            class="skills-sidebar-empty"
          >
            {{ message('emptyUser') }}
          </p>
          <ul
            v-else
            class="skills-list"
          >
            <li
              v-for="skill in group.skills"
              :key="`${skill.source}:${skill.name}`"
            >
              <button
                type="button"
                class="skills-row"
                :class="{ 'is-active': selected?.name === skill.name && selected.source === skill.source }"
                :aria-current="selected?.name === skill.name && selected.source === skill.source ? 'true' : undefined"
                :disabled="disabled"
                :title="skill.error || skill.description"
                @click="emit('select', skill)"
              >
                <span class="skills-row-copy">
                  <span class="skills-row-name">{{ skill.name }}</span>
                  <span class="skills-row-description">{{ skill.error || skill.description }}</span>
                </span>
                <span
                  v-if="!skill.available"
                  class="skills-row-badge"
                >{{ message('unavailable') }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ManagedSkill } from '@app/schemas';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import type { SkillGroup } from '../functions/groupSkills';
import { useSkillMessages, type SkillMessageKey } from '../definitions/messages';

defineProps<{ groups: readonly SkillGroup[]; selected: ManagedSkill | null; disabled: boolean }>();
const emit = defineEmits<{ select: [skill: ManagedSkill] }>();
const message = useSkillMessages();
const groupTitleKeys: Record<ManagedSkill['source'], SkillMessageKey> = {
  user: 'groupUser', builtin: 'groupBuiltin', plugin: 'groupPlugin',
};
const hostRef = ref<HTMLElement | null>(null);
const viewportMountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const scroll = useOverlayScrollViewport({ bindings: { hostRef, viewportMountRef, viewportRef } });

// 列表挂载时交给共享 Scroll；后续条目变化由其内容观察机制更新，卸载也由共享能力统一清理。
onMounted(() => scroll.init());
</script>
