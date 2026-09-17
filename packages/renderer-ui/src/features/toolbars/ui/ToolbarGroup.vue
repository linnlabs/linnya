<template>
  <div class="linnya-toolbar-group">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineSlots<{ default(): unknown }>();
</script>
