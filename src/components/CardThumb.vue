<script setup>
// Small card-shaped thumbnail (64×40) for list rows: the stored JPEG data URL, or a sketched placeholder.
import { ref, watch } from 'vue'
const props = defineProps({ src: { type: String, default: '' }, pending: { type: Boolean, default: false } })
const broken = ref(false)
watch(() => props.src, () => { broken.value = false })
</script>

<template>
  <span class="thumb" :class="{ pending }" aria-hidden="true">
    <img v-if="src && !broken" :src="src" alt="" loading="lazy" decoding="async" @error="broken = true">
    <template v-else>
      <span class="l1" /><span class="l2" /><span class="l3" /><span class="l4" />
    </template>
  </span>
</template>

<style scoped>
.thumb {
  width: 64px; height: 40px; flex: none; border-radius: 4px; overflow: hidden; background: #FFFFFF;
  border: 1px solid #DADDE3; box-shadow: 0 1px 2px rgba(20, 24, 32, 0.08);
  padding: 6px 7px; display: flex; flex-direction: column; gap: 4px;
}
.thumb:has(img) { padding: 0; }
img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb span { display: block; border-radius: 2px; }
.l1 { width: 22px; height: 3px; background: var(--accent); }
.l2 { width: 34px; height: 4px; background: var(--ink-2); }
.l3 { width: 44px; height: 2px; background: #C5C9D1; }
.l4 { width: 30px; height: 2px; background: #C5C9D1; }
.pending .l1 { background: #C5C9D1; }
.pending img { opacity: 0.75; }
</style>
