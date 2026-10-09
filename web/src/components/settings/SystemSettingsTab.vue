<script setup lang="ts">
import { onMounted, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useSystemSettings } from '@/composables/settings/useSystemSettings'

const { form, loading, saving, loaded, error, saved, validationError, load, save } = useSystemSettings()
watch(form, () => {
  saved.value = false
}, { deep: true, flush: 'sync' })
onMounted(load)
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        系统设置
      </h3>
      <BaseButton size="sm" :loading="saving" :disabled="loading || !loaded || !!validationError" @click="save">
        <span class="i-carbon-save mr-2" aria-hidden="true" />
        保存系统设置
      </BaseButton>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-6 text-sm text-gray-500">
      <span class="i-svg-spinners-ring-resize" aria-hidden="true" />
      正在读取系统设置
    </div>
    <template v-else>
      <div v-if="error" role="alert" class="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
        <span>{{ error }}</span>
        <BaseButton v-if="!loaded" size="sm" variant="secondary" @click="load">
          <span class="i-carbon-renew mr-2" aria-hidden="true" />
          重试
        </BaseButton>
      </div>
      <div v-if="loaded" class="border-t border-gray-200 pt-4 dark:border-gray-700">
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
            后台有机肥循环间隔
          </h4>
          <span class="text-xs text-gray-500 dark:text-gray-400">全局</span>
        </div>
        <div class="grid grid-cols-1 max-w-xl gap-4 sm:grid-cols-2">
          <BaseInput
            v-model.number="form.organicFertilizerDelayMinMs"
            label="间隔下限（毫秒）"
            aria-label="有机肥循环间隔下限（毫秒）"
            type="number" :min="0" :max="60000" :step="1" :disabled="saving"
          />
          <BaseInput
            v-model.number="form.organicFertilizerDelayMaxMs"
            label="间隔上限（毫秒）"
            aria-label="有机肥循环间隔上限（毫秒）"
            type="number" :min="0" :max="60000" :step="1" :disabled="saving"
          />
        </div>
        <p v-if="validationError" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">
          {{ validationError }}
        </p>
        <p v-else-if="saved" role="status" class="mt-3 text-sm text-green-600 dark:text-green-400">
          系统设置已保存并生效
        </p>
      </div>
    </template>
  </section>
</template>
