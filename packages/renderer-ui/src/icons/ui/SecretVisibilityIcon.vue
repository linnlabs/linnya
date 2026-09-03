<template>
  <svg
    v-if="visible"
    class="shared-icon"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M17 11V7a5 5 0 0 0-10 0" />
    <rect
      x="3"
      y="11"
      width="18"
      height="11"
      rx="2"
      ry="2"
    />
  </svg>
  <svg
    v-else
    class="shared-icon"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect
      x="3"
      y="11"
      width="18"
      height="11"
      rx="2"
      ry="2"
    />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <line
      x1="3"
      y1="3"
      x2="21"
      y2="21"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  readonly visible: boolean;
}>();
</script>
