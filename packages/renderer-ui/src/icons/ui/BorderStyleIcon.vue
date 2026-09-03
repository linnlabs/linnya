<!--
 * BorderStyleIcon.vue
 * 边框线型预览图标组件
 *
 * 用 SVG 绘制一条水平线，根据 styleType 显示不同的线宽和虚实样式。
 * 对应引擎 BorderStyleTypes 枚举的数值。
 -->
<script setup lang="ts">
import { computed } from 'vue';

interface LineVisual {
    strokeWidth: number;
    dashArray?: string;
    /** 双线模式：画两条线 */
    double?: boolean;
}

/**
 * BorderStyleTypes 数值 → SVG 线条参数。
 * 只列出常用的几种，其余回退到 THIN。
 */
const STYLE_MAP: Record<number, LineVisual> = {
    1:  { strokeWidth: 1 },                         // THIN
    8:  { strokeWidth: 2 },                         // MEDIUM
    13: { strokeWidth: 3 },                         // THICK
    4:  { strokeWidth: 1, dashArray: '6,3' },       // DASHED
    3:  { strokeWidth: 1, dashArray: '2,2' },       // DOTTED
    5:  { strokeWidth: 1, dashArray: '6,3,2,3' },   // DASH_DOT
    7:  { strokeWidth: 1, double: true },            // DOUBLE
};

const DEFAULT_VISUAL: LineVisual = { strokeWidth: 1 };

const props = defineProps<{
    styleType: number;
}>();

const visual = computed<LineVisual>(() => STYLE_MAP[props.styleType] ?? DEFAULT_VISUAL);
</script>

<template>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 16" width="40" height="16">
        <template v-if="visual.double">
            <!-- 双线：上下各一条细线 -->
            <line x1="2" y1="6" x2="38" y2="6"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" />
            <line x1="2" y1="10" x2="38" y2="10"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" />
        </template>
        <template v-else>
            <line x1="2" y1="8" x2="38" y2="8"
                stroke="currentColor"
                :stroke-width="visual.strokeWidth"
                :stroke-dasharray="visual.dashArray"
                stroke-linecap="round" />
        </template>
    </svg>
</template>
