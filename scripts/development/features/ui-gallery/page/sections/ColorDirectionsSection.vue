<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  BaseButton,
  CustomCheckbox,
  CustomSlider,
  SegmentedTabs,
  Switch,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { AddIcon, ChatIcon, FolderIcon, LibraryIcon } from '@linnya/renderer-ui/icons';
import {
  accentTokens,
  GREEN_CANDIDATES,
  greenRamp,
  buttonContrast,
  buttonStyle,
  buttonTokens,
  type ButtonMode,
  NEUTRAL_MAX_CHROMA,
  neutralTokens,
  type GreenCandidate,
  type PreviewTheme,
} from '../prototypes/colorDirections.ts';
import { TUNED_STATUS_TOKENS } from '../prototypes/colorDirectionValues.ts';
import { css } from '../prototypes/colorMath.ts';
import RunStatusIndicator from '../prototypes/RunStatusIndicator.vue';
import StatusBadge from '../prototypes/StatusBadge.vue';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/**
 * 颜色方向对比（计划阶段）：中性色、强调色、状态色分开调，左边现状、右边组合，用真组件并排看。
 * 只覆盖浅色与深色；月白蓝有自己的蓝色强调色，不在本轮。
 */
const NEUTRAL_HUE_TABS: SegmentedTabItem[] = [
  { id: 'brand', label: '跟随强调色' },
  { id: 'cool', label: '冷（蓝灰）' },
  { id: 'warm', label: '暖（米灰）' },
];
const BUTTON_MODES: readonly { id: ButtonMode; label: string; note: string }[] = [
  { id: 'deep', label: '加深实底 + 白字', note: '现状做法：为白字 4.5:1 把实底压深，按钮比所选颜色深。' },
  { id: 'brand-dark', label: '品牌色实底 + 深字', note: 'Radix 对薄荷、天蓝、黄等亮色的做法：实底就是品牌色本身，勾选、开关、页签指示同色。' },
  { id: 'brand-white', label: '品牌色实底 + 白字', note: 'Apple 系统绿的做法：颜色最准，但白字对比度不足。' },
  { id: 'ink', label: '墨色实底', note: 'Notion、ChatGPT 一类：主按钮用墨色，绿色只做选中、勾选、状态。' },
  { id: 'tonal', label: '浅色调', note: 'Material 3 的浅色调按钮：品牌色浅底加深色字，最轻。' },
];
const BUTTON_MODE_TABS: SegmentedTabItem[] = BUTTON_MODES.map(mode => ({ id: mode.id, label: mode.label }));
const STATUS_TABS: SegmentedTabItem[] = [
  { id: 'current', label: '现状' },
  { id: 'tuned', label: '协调' },
];

const neutralHueMode = ref('brand');
/** 色偏强度 0–100；0 即现状纯灰。 */
const neutralAmount = ref(20);
const buttonMode = ref<ButtonMode>('deep');
/** 用户 2026-11-17 选定：薄荷、协调状态色、中性色跟随强调色轻微色偏。 */
const greenId = ref('g2');
const customL = ref(72);
const customC = ref(100);
const customH = ref(158);
const status = ref('tuned');

const agree = ref(true);
const notify = ref(true);
const tab = ref('docs');
const PANE_TABS: SegmentedTabItem[] = [
  { id: 'docs', label: '文档' },
  { id: 'chats', label: '对话' },
  { id: 'kb', label: '知识库' },
];

const theme = ref<PreviewTheme>('light');
const isMoonBlue = ref(false);
let observer: MutationObserver | null = null;
onMounted(() => {
  const sync = () => {
    const value = document.documentElement.getAttribute('data-linnya-ui-theme');
    theme.value = value === 'dark' ? 'dark' : 'light';
    isMoonBlue.value = value === 'moon-blue';
  };
  sync();
  observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-linnya-ui-theme'] });
});
onBeforeUnmount(() => observer?.disconnect());

const customGreen = computed<GreenCandidate>(() => ({
  id: 'custom',
  label: '自定义',
  l: customL.value / 100,
  c: customC.value / 1000,
  h: customH.value,
}));

const selectedGreen = computed<GreenCandidate>(() =>
  greenId.value === 'custom' ? customGreen.value : GREEN_CANDIDATES.find(item => item.id === greenId.value) ?? GREEN_CANDIDATES[0]
);

function chooseGreen(candidate: GreenCandidate) {
  greenId.value = candidate.id;
  customL.value = Math.round(candidate.l * 100);
  customC.value = Math.round(candidate.c * 1000);
  customH.value = Math.round(candidate.h);
}

function editCustom() {
  greenId.value = 'custom';
}

const neutralHue = computed(() => {
  if (neutralHueMode.value === 'cool') return 250;
  if (neutralHueMode.value === 'warm') return 75;
  return selectedGreen.value.h;
});

const neutralChromaLabel = computed(() => (NEUTRAL_MAX_CHROMA * (neutralAmount.value / 100)).toFixed(4));

/** 色板卡片：品牌色、浅色主按钮、浅底文字、深色强调。 */
const swatches = computed(() =>
  GREEN_CANDIDATES.map(candidate => {
    const ramp = greenRamp(candidate);
    return {
      candidate,
      brand: css(ramp.brand),
      solid: css(ramp.solid),
      text: css(ramp.text),
      tint: css(ramp.tint),
      darkAccent: css(ramp.darkAccent),
      darkTint: css(ramp.darkTint),
      darkText: css(ramp.darkText),
      meta: `L${candidate.l.toFixed(2)} C${candidate.c.toFixed(3)} H${Math.round(candidate.h)}`,
    };
  })
);

const customRamp = computed(() => greenRamp(customGreen.value));

/** 组合后的覆盖变量；派生量（悬停、焦点环、成功色）在根上已解析，这里必须显式给出。 */
const candidateStyle = computed(() => {
  const tokens: Record<string, string> = {
    ...neutralTokens(theme.value, neutralHue.value, neutralAmount.value / 100),
    ...accentTokens(theme.value, selectedGreen.value),
    ...buttonTokens(theme.value, selectedGreen.value, buttonMode.value),
    ...(status.value === 'tuned' ? TUNED_STATUS_TOKENS[theme.value] : {}),
  };
  if (tokens['text-primary']) {
    const alpha = theme.value === 'dark' ? [10, 16] : [7, 12];
    tokens['bg-hover'] = `color-mix(in srgb, ${tokens['text-primary']} ${alpha[0]}%, transparent)`;
    tokens['bg-hover-strong'] = `color-mix(in srgb, ${tokens['text-primary']} ${alpha[1]}%, transparent)`;
  }
  return Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name.startsWith('preview-') ? `--${name}` : `--color-${name}`, value]));
});

const buttonSamples = computed(() =>
  BUTTON_MODES.map(mode => {
    const style = buttonStyle(theme.value, selectedGreen.value, mode.id);
    return {
      ...mode,
      style: { '--preview-btn-bg': css(style.bg), '--preview-btn-fg': css(style.fg), '--preview-btn-hover': css(style.hover) },
      contrast: buttonContrast(theme.value, selectedGreen.value, mode.id),
    };
  })
);
const buttonNote = computed(() => BUTTON_MODES.find(mode => mode.id === buttonMode.value)?.note ?? '');

const PANES = [
  { id: 'current', label: '现状' },
  { id: 'candidate', label: '所选组合' },
] as const;
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock
      title="颜色方向（计划中）"
      note="强调色、中性色、状态色分开调，右侧即时组合。色板卡片依次是：品牌色、浅色主按钮（白字 ≥4.5:1）、浅底文字、深色模式。研究用候选值，不是产品 token；只覆盖浅色与深色。"
    >
      <GalleryRow label="绿色色板" align="start">
        <div class="color-dir__swatches">
          <button
            v-for="item in swatches"
            :key="item.candidate.id"
            type="button"
            class="color-dir__swatch"
            :class="{ 'is-selected': item.candidate.id === greenId }"
            @click="chooseGreen(item.candidate)"
          >
            <span class="color-dir__chip color-dir__chip--brand" :style="{ backgroundColor: item.brand }" />
            <span class="color-dir__chip-row">
              <span class="color-dir__chip color-dir__chip--solid" :style="{ backgroundColor: item.solid }">新建</span>
              <span class="color-dir__chip color-dir__chip--tint" :style="{ backgroundColor: item.tint, color: item.text }">默认</span>
              <span class="color-dir__chip color-dir__chip--dark" :style="{ backgroundColor: item.darkTint, color: item.darkText }"><i :style="{ backgroundColor: item.darkAccent }" /></span>
            </span>
            <span class="color-dir__swatch-label">{{ item.candidate.label }}</span>
            <span class="color-dir__swatch-meta">{{ item.meta }}</span>
          </button>
        </div>
      </GalleryRow>
      <GalleryRow label="自定义（拖动即选用）" align="start">
        <div class="color-dir__sliders">
          <label class="color-dir__slider">明度 L {{ (customL / 100).toFixed(2) }}<CustomSlider v-model="customL" :min="55" :max="80" aria-label="明度" @update:model-value="editCustom" /></label>
          <label class="color-dir__slider">彩度 C {{ (customC / 1000).toFixed(3) }}<CustomSlider v-model="customC" :min="30" :max="150" aria-label="彩度" @update:model-value="editCustom" /></label>
          <label class="color-dir__slider">色相 H {{ customH }}<CustomSlider v-model="customH" :min="130" :max="200" aria-label="色相" @update:model-value="editCustom" /></label>
          <span class="color-dir__custom-chip" :style="{ backgroundColor: css(customRamp.brand) }" />
          <span class="color-dir__swatch-meta">主按钮白字 {{ customRamp.solidContrast.toFixed(1) }}:1</span>
        </div>
      </GalleryRow>
      <GalleryRow label="主按钮做法" align="start">
        <div class="color-dir__buttons">
          <div v-for="sample in buttonSamples" :key="sample.id" class="color-dir__button-sample" :style="sample.style">
            <BaseButton variant="primary" size="md"><template #icon><AddIcon /></template>新建文档</BaseButton>
            <span class="color-dir__swatch-label">{{ sample.label }}</span>
            <span class="color-dir__swatch-meta">文字对比度 {{ sample.contrast.toFixed(1) }}:1{{ sample.contrast < 4.5 ? '（不足 4.5）' : '' }}</span>
          </div>
        </div>
      </GalleryRow>
      <GalleryRow label="下方组合用" align="start">
        <div class="color-dir__sliders">
          <SegmentedTabs v-model="buttonMode" :tabs="BUTTON_MODE_TABS" />
          <span class="color-dir__swatch-meta">{{ buttonNote }}</span>
        </div>
      </GalleryRow>
      <GalleryRow label="中性色色偏" align="start">
        <div class="color-dir__sliders">
          <SegmentedTabs v-model="neutralHueMode" :tabs="NEUTRAL_HUE_TABS" />
          <label class="color-dir__slider">强度 {{ neutralAmount }}%（最深处 C {{ neutralChromaLabel }}，近白处更少）<CustomSlider v-model="neutralAmount" :min="0" :max="100" aria-label="中性色色偏强度" /></label>
        </div>
      </GalleryRow>
      <GalleryRow label="状态色"><SegmentedTabs v-model="status" :tabs="STATUS_TABS" /></GalleryRow>
      <p v-if="isMoonBlue" class="color-dir__moon">当前是月白蓝主题：本轮只比较浅色与深色，请切到这两个主题再看。</p>

      <div class="color-dir__panes">
        <div v-for="pane in PANES" :key="pane.id" class="color-dir__pane-wrap">
          <p class="color-dir__pane-label">{{ pane.label }}</p>
          <div class="color-dir__pane" :class="`color-dir__pane--${pane.id}`" :style="pane.id === 'candidate' ? candidateStyle : undefined">
            <aside class="color-dir__sidebar">
              <div class="color-dir__nav is-selected"><FolderIcon class="color-dir__icon" />项目文档</div>
              <div class="color-dir__nav"><LibraryIcon class="color-dir__icon" />知识库</div>
              <p class="color-dir__group">最近对话</p>
              <div class="color-dir__nav"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">季度复盘演示稿</span><RunStatusIndicator status="running" /></div>
              <div class="color-dir__nav is-attention"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">竞品对比表</span><RunStatusIndicator status="awaiting-approval" /></div>
              <div class="color-dir__nav"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">总结项目现状</span><span class="color-dir__time">昨天</span></div>
            </aside>
            <main class="color-dir__main">
              <SegmentedTabs v-model="tab" :tabs="PANE_TABS" />
              <h3 class="color-dir__heading">季度复盘</h3>
              <p class="color-dir__body">
                第三季度新增 12 位付费用户，留存比上季提高 4 个百分点。详细数据见
                <a class="color-dir__link" href="#" @click.prevent>投资人汇报数据表</a>，访谈要点放在知识库。
              </p>
              <p class="color-dir__meta">修改于 11:20 · 3 处引用</p>
              <div class="color-dir__row">
                <BaseButton variant="primary" size="md"><template #icon><AddIcon /></template>新建文档</BaseButton>
                <BaseButton variant="outline" size="md">导出</BaseButton>
                <BaseButton variant="tint" tone="accent" size="md">引用</BaseButton>
              </div>
              <div class="color-dir__row">
                <CustomCheckbox v-model="agree">回答时引用知识库</CustomCheckbox>
                <Switch v-model="notify" ariaLabel="完成时通知" />
                <span class="color-dir__focus">焦点环</span>
              </div>
              <div class="color-dir__row">
                <StatusBadge tone="accent">默认</StatusBadge>
                <StatusBadge tone="success" dot>已解析</StatusBadge>
                <StatusBadge tone="warning" dot>2 个来源失效</StatusBadge>
                <StatusBadge tone="error" dot>解析失败</StatusBadge>
                <StatusBadge tone="info" dot>新</StatusBadge>
              </div>
              <div class="color-dir__card">
                <p class="color-dir__card-title">访谈纪要 / 用户 A</p>
                <p class="color-dir__meta">知识库 · 18 段</p>
              </div>
            </main>
          </div>
        </div>
      </div>
    </GalleryBlock>
  </div>
</template>

<style>
.color-dir__swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); /* scale-exempt: 色板卡片宽度 */
  gap: var(--space-2);
  width: 100%;
}

.color-dir__swatch {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: none;
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
  text-align: left;
  cursor: pointer;
}

.color-dir__swatch:hover {
  background-color: var(--color-bg-hover);
}

.color-dir__swatch.is-selected {
  box-shadow: inset 0 0 0 1.5px var(--color-text-primary) /* scale-exempt: 选中描边 */;
}

.color-dir__chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
}

.color-dir__chip--brand {
  height: 36px; /* scale-exempt: 色块尺寸 */
}

.color-dir__chip-row {
  display: grid;
  grid-template-columns: 1fr 1fr 24px; /* scale-exempt: 色块尺寸 */
  gap: var(--space-1);
}

.color-dir__chip--solid,
.color-dir__chip--tint,
.color-dir__chip--dark {
  height: 22px; /* scale-exempt: 色块尺寸 */
}

.color-dir__chip--solid {
  color: var(--color-white);
}

.color-dir__chip--dark i {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.color-dir__swatch-label {
  color: var(--color-text-primary);
  font-size: var(--font-size-footnote);
}

.color-dir__swatch-meta {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}

.color-dir__sliders {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
}

.color-dir__slider {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 180px; /* scale-exempt: 滑杆宽度 */
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}

.color-dir__custom-chip {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
}

.color-dir__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.color-dir__button-sample {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}

/* 预览专用：主按钮与勾选、开关、页签指示读预览变量，未设置时回到组件自身的 token。 */
.color-dir__button-sample .linnya-ui-button--primary,
.color-dir__pane .linnya-ui-button--primary {
  background-color: var(--preview-btn-bg, var(--color-accent-solid));
  color: var(--preview-btn-fg, var(--color-text-on-accent));
}

.color-dir__button-sample .linnya-ui-button--primary:hover:not(:disabled),
.color-dir__pane .linnya-ui-button--primary:hover:not(:disabled) {
  background-color: var(--preview-btn-hover, var(--color-accent-solid-hover));
}

.color-dir__pane .checkbox-item input[type="checkbox"]:checked ~ .checkbox-custom {
  border-color: var(--preview-mark, var(--color-accent));
  background-color: var(--preview-mark, var(--color-accent));
}

.color-dir__pane .checkbox-item .check-icon {
  color: var(--preview-mark-fg, var(--color-text-on-accent));
}

.color-dir__pane .switch-control-input:checked + .switch-control-track {
  background-color: var(--preview-mark, var(--color-accent));
}

.color-dir__pane .segmented-tabs__indicator {
  background: var(--preview-mark, var(--color-accent));
}

.color-dir__pane--candidate .segmented-tabs__button.is-active {
  color: var(--color-accent-text);
}

.color-dir__moon {
  margin: 0;
  color: var(--color-warning-text);
  font-size: var(--font-size-footnote);
}

.color-dir__panes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.color-dir__pane-label {
  margin: 0 0 var(--space-1-5);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
}

.color-dir__pane {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr); /* scale-exempt: 版面尺寸 */
  overflow: hidden;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-default);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
  color: var(--color-text-primary);
}

.color-dir__sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  padding: var(--space-2);
  background-color: var(--color-bg-sidebar);
  box-shadow: inset calc(-1 * var(--border-width-hairline)) 0 0 var(--color-border-light);
}

.color-dir__nav {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
}

.color-dir__nav:hover {
  background-color: var(--color-bg-hover);
}

.color-dir__nav.is-selected {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.color-dir__nav.is-attention {
  color: var(--color-text-primary);
}

.color-dir__icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.color-dir__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-dir__time {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__group {
  margin: var(--space-3) 0 var(--space-1);
  padding: 0 var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  background-color: var(--color-bg-surface);
}

.color-dir__heading {
  margin: 0;
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
}

.color-dir__body {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: var(--line-height-body);
}

.color-dir__link {
  color: var(--color-text-link);
}

.color-dir__meta {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.color-dir__focus {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--radius-sm);
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: 2px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__card {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background-color: var(--color-bg-subtle);
}

.color-dir__card-title {
  margin: 0 0 var(--space-0-5);
  font-weight: var(--font-weight-medium);
}
</style>
