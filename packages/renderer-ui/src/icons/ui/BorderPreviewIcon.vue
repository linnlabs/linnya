<!--
 * BorderPreviewIcon.vue
 * 边框类型预览图标组件
 *
 * 用 SVG 绘制 2x2 格子示意图，根据 borderType 决定每条线是实线、虚线还是隐藏。
 * 共6条线：top / bottom / left / right / verticalCenter / horizontalCenter
 -->
<script setup lang="ts">
import { computed } from 'vue';

type LineStyle = 'solid' | 'dash' | 'none';

interface LineConfig {
    top: LineStyle;
    bottom: LineStyle;
    left: LineStyle;
    right: LineStyle;
    vCenter: LineStyle;
    hCenter: LineStyle;
}

/**
 * 边框类型 → 各条线的绘制方式。
 * solid = 深色实线，dash = 浅色虚线，none = 不画。
 * BorderType 是字符串枚举（'all' / 'top' 等）。
 */
const LINE_CONFIG_MAP: Record<string, LineConfig> = {
    all:        { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid', vCenter: 'solid', hCenter: 'solid' },
    outside:    { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid', vCenter: 'dash',  hCenter: 'dash' },
    inside:     { top: 'dash',  bottom: 'dash',  left: 'dash',  right: 'dash',  vCenter: 'solid', hCenter: 'solid' },
    vertical:   { top: 'dash',  bottom: 'dash',  left: 'dash',  right: 'dash',  vCenter: 'solid', hCenter: 'dash' },
    horizontal: { top: 'dash',  bottom: 'dash',  left: 'dash',  right: 'dash',  vCenter: 'dash',  hCenter: 'solid' },
    none:       { top: 'dash',  bottom: 'dash',  left: 'dash',  right: 'dash',  vCenter: 'dash',  hCenter: 'dash' },
    top:        { top: 'solid', bottom: 'dash',  left: 'dash',  right: 'dash',  vCenter: 'dash',  hCenter: 'dash' },
    bottom:     { top: 'dash',  bottom: 'solid', left: 'dash',  right: 'dash',  vCenter: 'dash',  hCenter: 'dash' },
    left:       { top: 'dash',  bottom: 'dash',  left: 'solid', right: 'dash',  vCenter: 'dash',  hCenter: 'dash' },
    right:      { top: 'dash',  bottom: 'dash',  left: 'dash',  right: 'solid', vCenter: 'dash',  hCenter: 'dash' },
};

const DEFAULT_CONFIG: LineConfig = { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid', vCenter: 'solid', hCenter: 'solid' };

const SOLID_COLOR = 'var(--color-text-primary)';
const DASH_COLOR = 'var(--color-border-default)';

const props = defineProps<{
    borderType: string;
}>();

const config = computed<LineConfig>(() => LINE_CONFIG_MAP[props.borderType] ?? DEFAULT_CONFIG);

/** 6条线的定义：名称 → 起止坐标 */
const lines = computed(() => [
    { key: 'top',     x1: 0.5, y1: 0.5,  x2: 15.5, y2: 0.5,   style: config.value.top },
    { key: 'bottom',  x1: 0.5, y1: 15.5, x2: 15.5, y2: 15.5,  style: config.value.bottom },
    { key: 'left',    x1: 0.5, y1: 0.5,  x2: 0.5,  y2: 15.5,  style: config.value.left },
    { key: 'right',   x1: 15.5, y1: 0.5, x2: 15.5, y2: 15.5,  style: config.value.right },
    { key: 'vCenter', x1: 8,   y1: 0.5,  x2: 8,    y2: 15.5,  style: config.value.vCenter },
    { key: 'hCenter', x1: 0.5, y1: 8,    x2: 15.5, y2: 8,     style: config.value.hCenter },
]);

function getStroke(style: LineStyle): string {
    return style === 'solid' ? SOLID_COLOR : DASH_COLOR;
}

function getDashArray(style: LineStyle): string | undefined {
    return style === 'dash' ? '2,2' : undefined;
}

</script>

<template>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
        <template v-for="line in lines" :key="line.key">
            <line
                v-if="line.style !== 'none'"
                :x1="line.x1" :y1="line.y1"
                :x2="line.x2" :y2="line.y2"
                :stroke="getStroke(line.style)"
                stroke-width="1"
                :stroke-dasharray="getDashArray(line.style)"
                shape-rendering="crispEdges"
            />
        </template>
    </svg>
</template>
