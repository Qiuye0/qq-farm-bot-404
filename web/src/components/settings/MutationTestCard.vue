<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMutationResource } from '@/composables/useMutationResource'
import { useAccountStore } from '@/stores/account'

interface TestState {
  id?: string
  enabled: boolean
  status: string
  phase?: string
  seedId: number | null
  seedName?: string
  target: number
  delayMs: number
  planted: number
  harvested: number
  round: number
  fertilizerRound?: number
  reason: string
}
interface Seed { seedId: number, name: string, count: number, image?: string }
const props = defineProps<{ accountId: string | number | null | undefined, conflict: boolean }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const accountStore = useAccountStore()
const id = () => String(props.accountId || '')
const open = ref(false)
const pending = ref(false)
const commandError = ref('')
const seedId = ref<string | number>('')
const target = ref<string | number>(1)
const delayMs = ref<string | number>(200)
const { data: state, error, loading, refresh, invalidate } = useMutationResource<TestState>(id, '/api/mutation-test')
const seedAccount = () => open.value && !state.value?.enabled && accountStore.currentAccount?.running ? id() : ''
const { data: seeds, error: seedError, loading: seedsLoading, refresh: refreshSeeds } = useMutationResource<Seed[]>(seedAccount, '/api/mutation-test/seeds', undefined, 0)
const options = computed(() => (seeds.value || []).map(seed => ({ value: seed.seedId, label: `${seed.name} × ${seed.count}` })))
const selectedSeed = computed(() => seeds.value?.find(seed => seed.seedId === Number(seedId.value)))
const statuses: Record<string, string> = { idle: '未开启', starting: '检查中', running: '运行中', stopping: '停止中', stopped: '已停止', failed: '已终止', completed: '已完成' }
const phases: Record<string, string> = { checking: '校验土地与背包', planting: '种植', normal: '普通肥', organic: '有机肥', harvesting: '务农与收获' }
const valid = computed(() => Number.isInteger(Number(target.value)) && Number(target.value) >= 1 && Number(target.value) <= 3000
  && Number(target.value) <= (selectedSeed.value?.count || 0)
  && Number.isInteger(Number(delayMs.value)) && Number(delayMs.value) >= 0 && Number(delayMs.value) <= 60000)
const startDisabled = computed(() => pending.value || loading.value || !state.value || !!error.value || !!seedError.value
  || props.conflict || !accountStore.currentAccount?.running || seedsLoading.value || !valid.value)
let generation = 0
let disposed = false
watch(() => props.accountId, () => {
  generation++
  open.value = false
  seedId.value = ''
  target.value = 1
  delayMs.value = 200
  pending.value = false
  commandError.value = ''
  emit('active', false)
})
watch(() => state.value?.enabled, value => emit('active', !!value))
function configure() {
  seedId.value = state.value?.seedId || ''
  target.value = state.value?.target || 1
  delayMs.value = state.value?.delayMs ?? 200
  commandError.value = ''
  open.value = true
}
async function command(action: 'start' | 'stop') {
  if (pending.value || !id() || (action === 'start' && startDisabled.value))
    return
  const accountId = id()
  const version = generation
  pending.value = true
  commandError.value = ''
  invalidate()
  try {
    const response = await api.post(`/api/mutation-test/${action}`, action === 'start'
      ? { seedId: Number(seedId.value), target: Number(target.value), delayMs: Number(delayMs.value) }
      : {}, { headers: { 'x-account-id': accountId }, timeout: 60000 })
    if (!response.data?.ok)
      throw new Error(response.data?.error || '操作失败')
    if (!disposed && version === generation && accountId === id()) {
      invalidate()
      state.value = response.data.data
      await refresh()
    }
  }
  catch (cause: any) {
    if (!disposed && version === generation && accountId === id()) {
      commandError.value = cause.response?.data?.error || cause.message || '操作失败'
      await refresh()
    }
  }
  finally {
    if (version === generation)
      pending.value = false
  }
}
onUnmounted(() => {
  disposed = true
  generation++
})
</script>

<template>
  <article class="min-w-0 flex flex-col border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
    <div class="flex items-center gap-3">
      <img src="/game-config/resource-icons/illustrated-mutant.png" alt="" class="h-10 w-10 shrink-0 object-contain">
      <h4 class="font-semibold">
        测变异
      </h4>
      <span class="ml-auto text-xs" :class="state?.enabled ? 'text-green-600' : 'text-gray-500'">{{ state ? statuses[state.status] : loading ? '加载中' : '读取失败' }}</span>
    </div>
    <div class="grid grid-cols-2 my-4 gap-3 text-sm tabular-nums">
      <div><span class="block text-xs text-gray-500">已种植</span><strong>{{ state?.planted ?? '—' }} / {{ state?.target ?? '—' }}</strong></div>
      <div><span class="block text-xs text-gray-500">已收获</span><strong>{{ state?.harvested ?? '—' }}</strong></div>
    </div>
    <p v-if="state?.enabled" class="mb-3 text-xs text-green-700">
      第 {{ state.round }} 轮 · {{ phases[state.phase || ''] }}<span v-if="state.phase === 'organic'"> · 第 {{ state.fertilizerRound }} 遍</span>
    </p>
    <p v-if="error || commandError || state?.reason" role="status" class="mb-3 break-words text-xs text-amber-700 dark:text-amber-400">
      {{ error || commandError || state?.reason }}
    </p>
    <div class="mt-auto flex justify-end gap-2">
      <BaseButton v-if="state?.enabled" variant="danger" size="sm" :loading="pending" :disabled="state.status === 'stopping'" @click="command('stop')">
        <span class="i-carbon-stop-filled mr-1" />停止
      </BaseButton>
      <BaseButton variant="secondary" size="sm" :disabled="!id()" @click="configure">
        配置
      </BaseButton>
    </div>
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" @click.self="open = false">
        <section role="dialog" aria-modal="true" aria-labelledby="mutation-test-title" class="max-h-[90vh] max-w-lg w-full overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
          <header class="mb-5 flex items-center justify-between gap-3">
            <h3 id="mutation-test-title" class="text-lg font-semibold">
              测变异
            </h3>
            <button class="grid h-8 w-8 place-items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="关闭" aria-label="关闭" @click="open = false">
              <span class="i-carbon-close" />
            </button>
          </header>
          <div v-if="state?.enabled" class="space-y-4">
            <p class="break-words font-medium">
              {{ state.seedName }}
            </p>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>已种植 {{ state.planted }} / {{ state.target }}</div>
              <div>已收获 {{ state.harvested }}</div>
            </div>
            <progress :value="state.planted" :max="state.target" class="h-2 w-full accent-green-600" />
            <p class="text-sm text-gray-500">
              第 {{ state.round }} 轮 · {{ phases[state.phase || ''] }} · {{ statuses[state.status] }}
            </p>
            <BaseButton variant="danger" :loading="pending" :disabled="state.status === 'stopping'" @click="command('stop')">
              <span class="i-carbon-stop-filled mr-2" />停止测试
            </BaseButton>
          </div>
          <form v-else class="space-y-4" @submit.prevent="command('start')">
            <div class="flex items-end gap-2">
              <BaseSelect v-model="seedId" class="min-w-0 flex-1" label="背包种子" :options="options" :disabled="pending || seedsLoading" />
              <BaseButton variant="outline" :disabled="pending || seedsLoading || !seedAccount()" title="刷新背包" aria-label="刷新背包" @click="refreshSeeds">
                <span class="i-carbon-renew" />
              </BaseButton>
            </div>
            <div v-if="selectedSeed" class="flex items-center gap-2 text-sm text-gray-500">
              <img v-if="selectedSeed.image" :src="selectedSeed.image" alt="" class="h-8 w-8 object-contain">
              <span>库存 {{ selectedSeed.count }} 颗</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <BaseInput v-model="target" type="number" label="目标测试次数" :min="1" :max="3000" :step="1" :disabled="pending" />
              <BaseInput v-model="delayMs" type="number" label="土地间隔 (ms)" :min="0" :max="60000" :step="1" :disabled="pending" />
            </div>
            <p v-if="Number(target) > (selectedSeed?.count ?? 3000)" class="text-sm text-red-600">
              目标次数超过背包库存
            </p>
            <p v-if="props.conflict" class="text-sm text-amber-700">
              种植收获或土地施肥尚未关闭
            </p>
            <p v-if="!accountStore.currentAccount?.running" class="text-sm text-amber-700">
              账号未启动
            </p>
            <p v-if="!seedsLoading && seeds && !seeds.length" class="text-sm text-gray-500">
              背包没有可测试的单格单季种子
            </p>
            <BaseButton type="submit" :loading="pending" :disabled="startDisabled">
              <span class="i-carbon-play-filled mr-2" />保存并开启
            </BaseButton>
          </form>
          <p v-if="error || seedError || commandError || state?.reason" role="alert" class="mt-4 break-words text-sm text-amber-700 dark:text-amber-400">
            {{ commandError || error || seedError || state?.reason }}
          </p>
        </section>
      </div>
    </Teleport>
  </article>
</template>
