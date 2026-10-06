<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmNewPanel from '@/components/FarmNewPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import PersonalAccountOverview from '@/components/PersonalAccountOverview.vue'
import TaskPanel from '@/components/TaskPanel.vue'

const currentTab = ref<'farm' | 'farm-new' | 'bag' | 'task'>('farm')
</script>

<template>
  <div class="personal-page h-full overflow-y-auto p-2 sm:p-4">
    <PersonalAccountOverview />
    <div class="personal-tabs" role="tablist" aria-label="个人板块">
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'farm' }"
        :aria-selected="currentTab === 'farm'"
        @click="currentTab = 'farm'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-sprout text-lg" />
          <span>我的农场</span>
        </div>
      </button>
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'farm-new' }"
        :aria-selected="currentTab === 'farm-new'"
        @click="currentTab = 'farm-new'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-grid text-lg" />
          <span>我的农场New</span>
        </div>
      </button>
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'bag' }"
        :aria-selected="currentTab === 'bag'"
        @click="currentTab = 'bag'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-box text-lg" />
          <span>我的背包</span>
        </div>
      </button>
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'task' }"
        :aria-selected="currentTab === 'task'"
        @click="currentTab = 'task'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-task text-lg" />
          <span>我的任务</span>
        </div>
      </button>
    </div>

    <div class="personal-content">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <component :is="currentTab === 'farm' ? FarmPanel : currentTab === 'farm-new' ? FarmNewPanel : currentTab === 'bag' ? BagPanel : TaskPanel" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.personal-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.personal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px;
  width: fit-content;
  max-width: 100%;
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  background: var(--surface-2);
}
.personal-tab {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--muted-text);
  transition:
    background 150ms,
    color 150ms;
}
.personal-tab:hover {
  color: var(--theme-primary);
  background: var(--surface-1);
}
.personal-tab.is-active {
  color: var(--theme-primary);
  border-color: var(--surface-border);
  background: var(--surface-1);
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.05);
}
.personal-tab:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: 2px;
}
.personal-content {
  min-width: 0;
  padding-bottom: 16px;
}
@media (max-width: 639px) {
  .personal-page {
    gap: 14px;
  }
  .personal-tabs {
    gap: 3px;
    width: 100%;
  }
  .personal-tab {
    flex: 1;
    justify-content: center;
    padding: 8px;
    font-size: 12px;
  }
}
</style>
