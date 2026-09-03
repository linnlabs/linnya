<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path
      v-if="direction === 'up'"
      d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"
      fill="currentColor"
    />
    <path
      v-else-if="direction === 'down'"
      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"
      fill="currentColor"
    />
    <path
      v-else-if="direction === 'left'"
      d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
      fill="currentColor"
    />
    <path
      v-else-if="direction === 'right'"
      d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"
      fill="currentColor"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps({
  direction: {
    type: String,
    default: 'down',
    validator: (value: string) => ['up', 'down', 'left', 'right'].includes(value)
  }
});
</script>
