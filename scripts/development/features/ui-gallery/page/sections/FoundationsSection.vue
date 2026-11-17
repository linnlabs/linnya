<script setup lang="ts">
import { computed } from 'vue';
import {
  collectCustomPropertyNames,
  formatOklch,
  readTokenColor,
  readTokenContrast,
} from '../functions/readTokenColor.ts';
import { useStyleRevision } from '../orchestration/useStyleRevision.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';
import GalleryScrollArea from '../ui/GalleryScrollArea.vue';

interface TokenUse {
  readonly token: string;
  readonly use: string;
}

interface TextTokenUse extends TokenUse {
  readonly minimum: number;
}

const SURFACES: readonly TokenUse[] = [
  { token: '--color-bg-default', use: '页面与内容画布' },
  { token: '--color-bg-sidebar', use: '侧栏与导航' },
  { token: '--color-bg-surface', use: '面板与卡片' },
  { token: '--color-bg-elevated', use: '菜单、弹层、对话框' },
  { token: '--color-bg-subtle', use: '凹陷区域、代码块' },
  { token: '--color-bg-hover', use: '悬停' },
  { token: '--color-bg-active', use: '按下' },
  { token: '--color-bg-active-subtle', use: '中性选中' },
  { token: '--color-bg-inverse', use: '高对比按钮' },
];

const TEXTS: readonly TextTokenUse[] = [
  { token: '--color-text-primary', use: '正文、标题', minimum: 7 },
  { token: '--color-text-secondary', use: '次要正文、未选中导航', minimum: 7 },
  { token: '--color-text-tertiary', use: '元信息、时间', minimum: 4.5 },
  { token: '--color-text-muted', use: '弱化标签与图标', minimum: 4.5 },
  { token: '--color-text-placeholder', use: '占位文字', minimum: 3 },
  { token: '--color-text-link', use: '链接', minimum: 4.5 },
];

const BORDERS: readonly TokenUse[] = [
  { token: '--color-border-light', use: '容器描边、分隔线' },
  { token: '--color-border-default', use: '需要看清的控件边界' },
  { token: '--color-border-hover', use: '悬停中的控件' },
  { token: '--color-border-focus', use: '聚焦中的控件' },
  { token: '--color-border-sidebar', use: '侧栏分隔' },
];

const ACCENTS: readonly TokenUse[] = [
  { token: '--color-accent', use: '强调文字、图标、描边' },
  { token: '--color-accent-solid', use: '主按钮实底' },
  { token: '--color-accent-solid-hover', use: '主按钮悬停' },
  { token: '--color-accent-bg', use: '选中浅底' },
  { token: '--color-accent-bg-subtle', use: '推荐浅底' },
  { token: '--color-accent-light', use: '渐变、光效（不作文字）' },
  { token: '--color-focus-ring', use: '焦点环' },
  { token: '--color-text-selection', use: '文本选区' },
];

const STATUSES = [
  { name: 'success', label: '完成' },
  { name: 'warning', label: '需处理' },
  { name: 'error', label: '失败' },
  { name: 'info', label: '中性提示' },
] as const;

const TYPE_ROLES = [
  { role: 'caption', use: '徽标、计数、时间戳' },
  { role: 'footnote', use: '辅助说明、表单提示' },
  { role: 'body', use: '默认界面文字' },
  { role: 'prose', use: '连续阅读：回答、输入框' },
  { role: 'subtitle', use: '卡片标题、对话框分组' },
  { role: 'title', use: '对话框标题、分区标题' },
  { role: 'headline', use: '页面标题' },
  { role: 'display', use: '空态与首屏主视觉' },
] as const;

const SPACES = ['0-5', '1', '1-5', '2', '2-5', '3', '4', '5', '6', '8', '10'] as const;
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;
const SHADOWS = ['xs', 'sm', 'md', 'lg', 'xl', 'floating-panel'] as const;
const CONTROL_HEIGHTS = ['sm', 'md', 'lg'] as const;

const SAMPLE = 'Linnya 把项目里的文档、对话和资料整理成可以提问的知识库';

const revision = useStyleRevision();

function measured<T>(read: () => T): () => T {
  return () => {
    void revision.value;
    return read();
  };
}

const root = (): Element => document.body;

const describe = (token: string, over: string | null = null) => {
  const reading = readTokenColor(token, over, root());
  return `${reading.hex} · ${formatOklch(reading.oklch)}`;
};

// 半透明的表面（悬停、按下）按叠在页面底色上的实际颜色读取，与色块的显示一致。
const surfaceReadings = computed(
  measured(() => SURFACES.map(item => ({ ...item, value: describe(item.token, '--color-bg-default') })))
);

const textReadings = computed(
  measured(() =>
    TEXTS.map(item => {
      const onDefault = readTokenContrast(item.token, '--color-bg-default', root());
      const onSidebar = readTokenContrast(item.token, '--color-bg-sidebar', root());
      return {
        ...item,
        value: describe(item.token, '--color-bg-default'),
        onDefault,
        onSidebar,
        passes: Math.min(onDefault, onSidebar) >= item.minimum,
      };
    })
  )
);

const borderReadings = computed(
  measured(() => BORDERS.map(item => ({ ...item, value: describe(item.token, '--color-bg-default') })))
);

const accentReadings = computed(
  measured(() => ACCENTS.map(item => ({ ...item, value: describe(item.token, '--color-bg-default') })))
);

const statusReadings = computed(
  measured(() =>
    STATUSES.map(status => ({
      ...status,
      base: describe(`--color-${status.name}`, '--color-bg-default'),
      textOnBg: readTokenContrast(`--color-${status.name}-text`, `--color-${status.name}-bg`, root()),
      textOnDefault: readTokenContrast(`--color-${status.name}-text`, '--color-bg-default', root()),
    }))
  )
);

const paletteReadings = computed(
  measured(() =>
    ['--color-gray-', '--color-brand-'].map(prefix => ({
      prefix,
      steps: collectCustomPropertyNames(prefix).map(token => {
        const reading = readTokenColor(token, null, root());
        return { token, step: token.slice(prefix.length), hex: reading.hex, oklch: reading.oklch };
      }),
    }))
  )
);

function ratio(value: number): string {
  return `${value.toFixed(2)}:1`;
}
</script>

<template>
  <div class="gallery-section foundations">
    <GalleryBlock title="表面" note="同一层内容只用一种表面；浅色主题下多数表面接近白色，层级靠边框与投影。">
      <div class="foundations__swatches">
        <div v-for="item in surfaceReadings" :key="item.token" class="foundations__swatch">
          <div class="foundations__chip" :style="{ backgroundColor: `var(${item.token})` }" />
          <div class="foundations__meta">
            <code>{{ item.token }}</code>
            <span>{{ item.use }}</span>
            <span class="gallery-caption">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock title="文字" note="对比度按页面底色和侧栏底色分别计算，取较低的一个与规范要求比较。">
      <div class="foundations__table">
        <div v-for="item in textReadings" :key="item.token" class="foundations__text-row">
          <span class="foundations__text-sample" :style="{ color: `var(${item.token})` }">{{ SAMPLE }}</span>
          <span class="foundations__text-meta">
            <code>{{ item.token }}</code>
            <span class="gallery-caption">{{ item.use }}</span>
            <span class="gallery-caption">{{ item.value }}</span>
            <span class="gallery-caption" :class="{ 'foundations__fail': !item.passes }">
              页面 {{ ratio(item.onDefault) }} · 侧栏 {{ ratio(item.onSidebar) }} · 要求 {{ item.minimum }}:1
            </span>
          </span>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock title="边框">
      <div class="foundations__swatches">
        <div v-for="item in borderReadings" :key="item.token" class="foundations__swatch">
          <div class="foundations__border-box" :style="{ borderColor: `var(${item.token})` }" />
          <div class="foundations__meta">
            <code>{{ item.token }}</code>
            <span>{{ item.use }}</span>
            <span class="gallery-caption">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock title="强调色" note="品牌绿只用于主操作、选中、焦点和可交互强调。">
      <div class="foundations__swatches">
        <div v-for="item in accentReadings" :key="item.token" class="foundations__swatch">
          <div class="foundations__chip" :style="{ backgroundColor: `var(${item.token})` }" />
          <div class="foundations__meta">
            <code>{{ item.token }}</code>
            <span>{{ item.use }}</span>
            <span class="gallery-caption">{{ item.value }}</span>
          </div>
        </div>
      </div>
      <GalleryRow label="组合">
        <span class="foundations__pair foundations__pair--solid">主操作</span>
        <span class="foundations__pair foundations__pair--selected">已选中</span>
        <span class="foundations__pair foundations__pair--inverse">发送</span>
        <a class="foundations__link" href="#" @click.prevent>查看引用来源</a>
        <span class="foundations__selection">选中的文字</span>
        <span class="foundations__focus">焦点环</span>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="状态色" note="每种状态有基础色、文字色、背景色三类，用途不能互换。">
      <div v-for="status in statusReadings" :key="status.name" class="gallery-row">
        <div class="gallery-row__label">{{ status.name }} · {{ status.label }}</div>
        <div class="gallery-row__content">
          <span class="foundations__dot" :style="{ backgroundColor: `var(--color-${status.name})` }" />
          <span
            class="foundations__status-chip"
            :style="{ backgroundColor: `var(--color-${status.name}-bg)`, color: `var(--color-${status.name}-text)` }"
          >
            {{ status.label }}
          </span>
          <span :style="{ color: `var(--color-${status.name}-text)` }">状态文字</span>
          <span class="gallery-caption">
            基础色 {{ status.base }} · 文字在浅底 {{ ratio(status.textOnBg) }} · 在页面 {{ ratio(status.textOnDefault) }}
          </span>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock title="基础色阶" note="只在 token 层使用。C 是 OKLCH 彩度：灰阶 C 为 0 表示纯灰、没有冷暖倾向。">
      <div v-for="palette in paletteReadings" :key="palette.prefix" class="foundations__palette">
        <code class="gallery-caption">{{ palette.prefix }}*</code>
        <div class="foundations__ramp">
          <div v-for="step in palette.steps" :key="step.token" class="foundations__ramp-step">
            <div class="foundations__ramp-chip" :style="{ backgroundColor: `var(${step.token})` }" />
            <span class="gallery-caption">{{ step.step }}</span>
            <span class="gallery-caption">{{ step.hex }}</span>
            <span class="gallery-caption">C {{ step.oklch.c.toFixed(3) }}</span>
            <span class="gallery-caption">{{ step.oklch.c < 0.002 ? '—' : `H ${Math.round(step.oklch.h)}` }}</span>
          </div>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock title="字阶" note="字号与行高成对使用；字重只有 400 / 500 / 600 三档。">
      <GalleryRow v-for="item in TYPE_ROLES" :key="item.role" :label="`${item.role} · ${item.use}`">
        <span
          class="foundations__type-sample"
          :style="{ fontSize: `var(--font-size-${item.role})`, lineHeight: `var(--line-height-${item.role})` }"
        >
          {{ SAMPLE }}
        </span>
      </GalleryRow>
      <GalleryRow label="字重">
        <span :style="{ fontWeight: 'var(--font-weight-regular)' }">常规 400</span>
        <span :style="{ fontWeight: 'var(--font-weight-medium)' }">中等 500</span>
        <span :style="{ fontWeight: 'var(--font-weight-semibold)' }">半粗 600</span>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="间距、圆角、控件高度与投影">
      <GalleryRow label="间距" align="start">
        <div class="gallery-stack">
          <div v-for="space in SPACES" :key="space" class="foundations__space">
            <span class="foundations__space-bar" :style="{ width: `var(--space-${space})` }" />
            <code class="gallery-caption">--space-{{ space }}</code>
          </div>
        </div>
      </GalleryRow>
      <GalleryRow label="圆角">
        <div v-for="radius in RADII" :key="radius" class="foundations__radius-item">
          <div class="foundations__radius" :style="{ borderRadius: `var(--radius-${radius})` }" />
          <code class="gallery-caption">{{ radius }}</code>
        </div>
      </GalleryRow>
      <GalleryRow label="控件高度">
        <div v-for="height in CONTROL_HEIGHTS" :key="height" class="foundations__radius-item">
          <div class="foundations__control" :style="{ height: `var(--control-height-${height})` }">{{ height }}</div>
        </div>
      </GalleryRow>
      <GalleryRow label="投影">
        <div v-for="shadow in SHADOWS" :key="shadow" class="foundations__shadow" :style="{ boxShadow: `var(--shadow-${shadow})` }">
          <code class="gallery-caption">{{ shadow }}</code>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="滚动条" note="产品里的长列表、表格用 OverlayScrollbars 浮层滚动条（useOverlayScrollViewport），悬停或滚动时出现。">
      <GalleryRow label="浮层滚动条" align="start">
        <GalleryScrollArea>
          <p v-for="index in 24" :key="index" class="foundations__scroll-line">第 {{ index }} 行：滚动或悬停查看滚动条</p>
        </GalleryScrollArea>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style>
.foundations code {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
  color: var(--color-text-secondary);
}

.foundations__swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); /* scale-exempt: 版面尺寸 */
  gap: var(--space-4);
}

.foundations__swatch {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.foundations__chip,
.foundations__border-box {
  flex: none;
  width: 72px; /* scale-exempt: 版面尺寸 */
  height: 48px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
}

.foundations__border-box {
  border: 1px solid;
  box-shadow: none;
  background-color: var(--color-bg-default);
}

.foundations__meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.foundations__table {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.foundations__text-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.foundations__text-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.foundations__text-sample {
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.foundations__fail {
  color: var(--color-error-text);
}

.foundations__pair {
  display: inline-flex;
  align-items: center;
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  font-weight: var(--font-weight-medium);
}

.foundations__pair--solid {
  background-color: var(--color-accent-solid);
  color: var(--color-text-on-accent);
}

.foundations__pair--selected {
  background-color: var(--color-accent-bg);
  color: var(--color-accent-text);
}

.foundations__pair--inverse {
  background-color: var(--color-bg-inverse);
  color: var(--color-text-inverse);
}

.foundations__link {
  color: var(--color-text-link);
  text-decoration: underline;
}

.foundations__selection {
  background-color: var(--color-text-selection);
}

.foundations__focus {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: var(--focus-ring-offset);
}

.foundations__dot {
  width: 10px; /* scale-exempt: 状态点尺寸 */
  height: 10px; /* scale-exempt: 状态点尺寸 */
  border-radius: var(--radius-full);
}

.foundations__status-chip {
  display: inline-flex;
  align-items: center;
  height: 20px; /* scale-exempt: 徽标高度 */
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.foundations__palette {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.foundations__ramp {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); /* scale-exempt: 版面尺寸 */
  gap: var(--space-2);
}

.foundations__ramp-step {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.foundations__ramp-chip {
  height: 40px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
}

.foundations__type-sample {
  color: var(--color-text-primary);
}

.foundations__space {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.foundations__space-bar {
  height: var(--space-3);
  background-color: var(--color-accent-bg);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-accent);
}

.foundations__radius-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.foundations__radius {
  width: 48px; /* scale-exempt: 版面尺寸 */
  height: 48px; /* scale-exempt: 版面尺寸 */
  background-color: var(--color-bg-subtle);
  border: var(--border-width-hairline) solid var(--color-border-default);
}

.foundations__control {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  border: var(--border-width-hairline) solid var(--color-border-default);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.foundations__shadow {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 96px; /* scale-exempt: 版面尺寸 */
  height: 64px; /* scale-exempt: 版面尺寸 */
  padding-bottom: var(--space-1);
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-elevated);
}

.foundations__scroll-line {
  margin: 0;
  padding: var(--space-1) var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}
</style>
