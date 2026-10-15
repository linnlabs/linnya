<template>
  <section
    class="deck-navigator"
    :aria-label="deckNavigatorMessage('slides.navigator.toolbar.label')"
  >
    <div class="deck-navigator__toolbar">
      <button
        type="button"
        class="deck-navigator__button deck-navigator__insert"
        :class="{ 'deck-navigator__insert--pending': pending }"
        :disabled="!availability.available || pending"
        :aria-busy="pending"
        :aria-label="deckNavigatorMessage('slides.navigator.insertBlankSlide')"
        :title="insertTitle"
        @click="insertAfterCurrentSlide"
      >
        <AddIcon class="deck-navigator__icon" />
      </button>

      <div class="deck-navigator__trailing">
        <div
          class="deck-navigator__views"
          role="group"
          :aria-label="deckNavigatorMessage('slides.navigator.view.label')"
        >
          <button
            type="button"
            class="deck-navigator__view"
            :class="{ 'deck-navigator__view--active': deckViewMode === 'slide' }"
            :aria-pressed="deckViewMode === 'slide'"
            :aria-label="deckNavigatorMessage('slides.navigator.view.slide')"
            :title="deckNavigatorMessage('slides.navigator.view.slide')"
            @click="uiStore.setDeckViewMode('slide')"
          >
            <SingleSlideViewIcon class="deck-navigator__icon" />
          </button>
          <button
            type="button"
            class="deck-navigator__view"
            :class="{ 'deck-navigator__view--active': deckViewMode === 'grid' }"
            :aria-pressed="deckViewMode === 'grid'"
            :aria-label="deckNavigatorMessage('slides.navigator.view.grid')"
            :title="deckNavigatorMessage('slides.navigator.view.grid')"
            @click="uiStore.setDeckViewMode('grid')"
          >
            <SlideGridViewIcon class="deck-navigator__icon" />
          </button>
        </div>

        <button
          v-if="deckViewMode === 'slide'"
          type="button"
          class="deck-navigator__button deck-navigator__collapse"
          :aria-expanded="!filmstripCollapsed"
          :aria-label="collapseLabel"
          :title="collapseLabel"
          @click="uiStore.toggleFilmstrip()"
        >
          <ChevronIcon
            class="deck-navigator__icon"
            :direction="filmstripCollapsed ? 'up' : 'down'"
          />
        </button>
      </div>
    </div>

    <DeckFilmstrip v-if="deckViewMode === 'slide' && !filmstripCollapsed" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { AddIcon, ChevronIcon } from '@linnya/renderer-ui/icons';
import { useSlidesUiStore } from '../../../store/slidesUiStore';
import { useManualEditSubmission } from '../../manualEditing';
import { useBlankSlideInsertion } from '../orchestration/useBlankSlideInsertion';
import { useDeckNavigatorLocalization } from './useDeckNavigatorLocalization';
import DeckFilmstrip from './DeckFilmstrip.vue';
import SingleSlideViewIcon from './icons/SingleSlideViewIcon.vue';
import SlideGridViewIcon from './icons/SlideGridViewIcon.vue';

const uiStore = useSlidesUiStore();
const { deckViewMode, filmstripCollapsed } = storeToRefs(uiStore);
const { deckNavigatorMessage } = useDeckNavigatorLocalization();
const { availability, pending, insertAfterCurrentSlide } = useBlankSlideInsertion(useManualEditSubmission());

const insertTitle = computed(() => {
  if (pending.value) return deckNavigatorMessage('slides.navigator.insertBlankSlide.inserting');
  return availability.value.available
    ? deckNavigatorMessage('slides.navigator.insertBlankSlide')
    : deckNavigatorMessage('slides.navigator.insertBlankSlide.unavailable');
});

const collapseLabel = computed(() => deckNavigatorMessage(
  filmstripCollapsed.value ? 'slides.navigator.filmstrip.expand' : 'slides.navigator.filmstrip.collapse',
));
</script>
