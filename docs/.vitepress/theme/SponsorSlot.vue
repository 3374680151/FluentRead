<script setup lang="ts">
defineProps<{ en?: boolean }>()
</script>

<template>
  <a
    class="fr-sponsor-slot"
    href="mailto:a1914493943@gmail.com?subject=FluentRead%20sponsorship"
  >
    <span class="fr-sponsor-plus" aria-hidden="true">+</span>
    <span class="fr-sponsor-copy">
      <strong>{{ en ? 'Your brand here' : '虚位以待' }}</strong>
      <span>{{ en ? 'Become our first sponsor' : '成为首位赞助伙伴' }}</span>
    </span>
    <span class="fr-sponsor-arrow" aria-hidden="true">↗</span>
  </a>
</template>

<style scoped>
.fr-sponsor-slot {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
  min-width: 0;
  min-height: 144px;
  padding: 28px;
  border: 1px dashed #c9b7bf;
  border-radius: 18px;
  background: #fcf9fa;
  color: var(--vp-c-text-1);
  text-decoration: none !important;
  transition: border-color 160ms, background-color 160ms;
}
.fr-sponsor-slot:hover {
  border-color: var(--vp-c-brand-1);
  background: #fbf3f6;
}
.fr-sponsor-slot:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}
.fr-sponsor-plus {
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  height: 48px;
  border: 1px solid #e4d8de;
  border-radius: 12px;
  color: var(--vp-c-brand-1);
  background: white;
  font-size: 28px;
  font-weight: 400;
  line-height: 1;
}
.fr-sponsor-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 5px;
  line-height: 1.6;
}
.fr-sponsor-copy strong {
  font-size: 20px;
  font-weight: 650;
  color: var(--vp-c-text-1);
}
.fr-sponsor-copy > span {
  font-size: 14px;
  color: var(--vp-c-brand-1);
}
.fr-sponsor-arrow {
  align-self: flex-start;
  margin-left: auto;
  color: var(--vp-c-brand-1);
  font-size: 20px;
}
@media (max-width: 480px) {
  .fr-sponsor-slot {
    gap: 14px;
    padding: 22px 18px;
  }
  .fr-sponsor-plus {
    flex-basis: 36px;
    height: 36px;
    font-size: 24px;
  }
  .fr-sponsor-copy strong {
    font-size: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fr-sponsor-slot {
    transition: none;
  }
}
</style>
