<script setup lang="ts">
import type { PermissionTier } from './permissionTier.ts';

/**
 * 档位图标草稿（未进图标库）：按图标库规范画，24 网格、1u 中心线、圆头圆角，由 Fluent 20 Regular 平移 +2。
 * - shield：同一个盾牌外形，里面换符号——锁孔（只读）、对勾（标准）、感叹号（完全访问）。
 * - mixed：三个不同外形——眼睛（只读）、盾牌对勾（标准）、打开的锁（完全访问；整体左移 1u，锁梁收进 16 绘图区）。
 * 选定后再进 linnya-design/icons 出正式母版。
 */
defineProps<{
  readonly tier: PermissionTier;
  readonly set: 'shield' | 'mixed';
}>();

const SHIELD = 'M12 4.6C13.95 5.85 16.15 6.6 18.5 6.95V11.5C18.5 15.15 16.37 17.8 12 19.47C7.63 17.8 5.5 15.15 5.5 11.5V6.95C7.85 6.6 10.05 5.85 12 4.6Z';
</script>

<template>
  <svg
    class="permission-tier-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="set === 'shield' || tier === 'standard'">
      <path :d="SHIELD" />
      <path
        v-if="tier === 'read_only'"
        data-solid
        fill="currentColor"
        stroke="none"
        d="M13.5 11c0 .65-.42 1.2-1 1.41v2.09a.5.5 0 0 1-1 0v-2.09a1.5 1.5 0 1 1 2-1.41Z"
      />
      <path v-else-if="tier === 'standard'" d="M9.5 11.5l2 2 4-4" />
      <template v-else>
        <path d="M12 8.5v5" />
        <circle data-solid cx="12" cy="15.75" r="0.75" fill="currentColor" stroke="none" />
      </template>
    </template>
    <template v-else-if="tier === 'read_only'">
      <path d="M4.77 13.5a7.36 7.36 0 0 1 14.46 0" />
      <circle cx="12" cy="13.5" r="3" />
    </template>
    <template v-else>
      <rect x="5.5" y="9.5" width="11" height="10" rx="2" />
      <path d="M12.5 9.5V7a3.5 3.5 0 0 1 7 0v.5" />
      <circle data-solid cx="11" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>

<style scoped>
.permission-tier-icon {
  display: block;
  flex: none;
}
</style>
