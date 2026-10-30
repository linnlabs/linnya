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
        <!-- 宿主放入的视图控件（如舞台缩放）排在视图切换左侧，用细线分组。 -->
        <template v-if="$slots['view-controls']">
          <slot name="view-controls" />
          <span
            class="deck-navigator__divider"
            aria-hidden="true"
          />
        </template>
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

    <DeckFilmstrip
      v-if="deckViewMode === 'slide' && !filmstripCollapsed"
      :reorder-enabled="availability.available && !pending"
      @move-slide="moveSlide"
      @slide-context-menu="openSlideMenu"
    />
    <SlideContextMenu
      v-if="contextMenu"
      :anchor="contextMenu.anchor"
      :disabled="!availability.available || pending"
      :can-delete="canDelete"
      :can-move-earlier="contextMenu.index > 0"
      :can-move-later="contextMenu.index < (slidesStore.deckPreview?.slides.length ?? 0) - 1"
      @move-earlier="runSlideAction('earlier')"
      @move-later="runSlideAction('later')"
      @duplicate="runSlideAction('duplicate')"
      @delete="runSlideAction('delete')"
      @close="contextMenu = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { AddIcon, ChevronIcon } from '@linnya/renderer-ui/icons';
import { useSlidesUiStore } from '../../../store/slidesUiStore';
import { useManualEditSubmission } from '../../manualEditing/submission';
import { useSlideStructureActions } from '../orchestration/useSlideStructureActions';
import { useDeckNavigatorLocalization } from './useDeckNavigatorLocalization';
import { useSlidesStore } from '../../documentRuntime';
import type { SlideContextMenuAnchor } from '../definitions/deckNavigatorTypes';
import SlideContextMenu from './SlideContextMenu.vue';
import DeckFilmstrip from './DeckFilmstrip.vue';
import SingleSlideViewIcon from './icons/SingleSlideViewIcon.vue';
import SlideGridViewIcon from './icons/SlideGridViewIcon.vue';

const uiStore = useSlidesUiStore();
const { deckViewMode, filmstripCollapsed } = storeToRefs(uiStore);
const { deckNavigatorMessage } = useDeckNavigatorLocalization();
const { availability, pending, canDelete, moveSlide, duplicateSlide, deleteSlide, insertAfterCurrentSlide } = useSlideStructureActions(useManualEditSubmission());

const slidesStore = useSlidesStore();
const contextMenu = ref<{ anchor: SlideContextMenuAnchor; index: number } | null>(null);
function openSlideMenu(event: MouseEvent, index: number): void {
  slidesStore.setCurrentSlide(index);
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement)) return;
  const rect = trigger.getBoundingClientRect();
  contextMenu.value = { index, anchor: {
    x: event.clientX || rect.left,
    y: event.clientY || rect.bottom,
    trigger,
  } };
}
function runSlideAction(action: 'duplicate' | 'delete' | 'earlier' | 'later'): void {
  const index = contextMenu.value?.index;
  contextMenu.value = null;
  if (index === undefined) return;
  if (action === 'earlier' || action === 'later') void moveSlide(index, index + (action === 'earlier' ? -1 : 1));
  else void (action === 'duplicate' ? duplicateSlide(index) : deleteSlide(index));
}
// 菜单索引只属于打开时的修订；刷新或切换视图后不再使用旧位置。
watch(() => [slidesStore.currentDeckId, slidesStore.documentBuildState, deckViewMode.value], () => { contextMenu.value = null; });

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
