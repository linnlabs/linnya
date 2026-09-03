<template>
  <Teleport :to="to">
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
/**
 * BlockChromeHostSurfaceTeleport.vue
 *
 * 中文说明：
 * - 只封装 Host surface 的 Teleport 外壳；
 * - 不接收业务 props，不决定渲染哪个 feature UI；
 * - 具体 surface 仍由 BlockChromeHost 用显式分支渲染，避免形成新的上帝组件。
 */

defineProps<{
  to: HTMLElement;
}>();
</script>
