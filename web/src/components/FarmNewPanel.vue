<script setup lang="ts">
import type { FertilizerType, Land } from '@/stores/farm'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import FarmNewLandCard from '@/components/FarmNewLandCard.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { canRemoveLand } from '@/utils/farm-land-actions'
import { createFarmRefreshController, normalizeRefreshSeconds } from '@/utils/farm-new-refresh'
import { canNormalFertilize, canRipenLand, ripenLand } from '@/utils/ripen-land'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { lands, summary, loading, loaded, error, fertilizePending, fertilizeError } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const visibility = useDocumentVisibility()
const landView = ref<'default' | 'compact'>('compact')
const autoRefreshEnabled = ref(false)
const autoRefreshSeconds = ref(3)
const fertilizingLandId = ref<number | null>(null)
const ripeningLandId = ref<number | null>(null)
const operating = ref(false)
const clock = ref(Date.now())
const operations = [
  { type: 'harvest', label: '收获', icon: 'i-carbon-wheat', color: 'bg-blue-600 hover:bg-blue-700', message: '确定要收获所有成熟作物吗？' },
  { type: 'clear', label: '一键务农', icon: 'i-carbon-clean', color: 'bg-teal-600 hover:bg-teal-700', message: '确定要执行一键务农吗？将自动浇水、除草、除虫。' },
  { type: 'plant', label: '种植', icon: 'i-carbon-sprout', color: 'bg-green-600 hover:bg-green-700', message: '确定要一键种植吗？将根据当前策略配置执行。' },
  { type: 'upgrade', label: '升级土地', icon: 'i-carbon-upgrade', color: 'bg-purple-600 hover:bg-purple-700', message: '确定要升级所有可升级的土地吗？此操作会消耗金币。' },
  { type: 'all', label: '一键全收', icon: 'i-carbon-flash', color: 'bg-orange-600 hover:bg-orange-700', message: '确定要执行一键全收吗？将务农、收获、种植，并根据配置升级土地。' },
  { type: 'removeAll', label: '一键铲除', icon: 'i-carbon-trash-can', color: 'bg-red-600 hover:bg-red-700', message: '确定要铲除全部已种植作物吗？此操作不可恢复。' },
] as const
type FarmOperation = typeof operations[number] | { type: 'remove', label: '铲除', message: string, land: Land }
const pendingOperation = ref<{ operation: FarmOperation, accountId: string, sequence: number } | null>(null)
const confirmVisible = computed(() => pendingOperation.value !== null)
let disposed = false
let actionSequence = 0
let preferencesLoaded = false

const accountRunning = computed(() => !!currentAccount.value?.running
  || (statusStore.currentStatusReady && !!statusStore.status?.connection?.connected))
const busy = computed(() => fertilizePending.value || ripeningLandId.value !== null || operating.value || confirmVisible.value)
const displayLands = computed(() => lands.value.map(land => ({
  ...land,
  matureInSec: Math.max(0, Number(land.matureInSec || 0)
  - Math.floor(Math.max(0, clock.value - Number(land.snapshotAt || clock.value)) / 1000)),
})))

const refreshController = createFarmRefreshController({
  getAccountId: () => currentAccountId.value,
  canRefresh: () => !disposed && visibility.value === 'visible' && accountRunning.value && !busy.value,
  refresh: async (accountId) => {
    if (!statusStore.realtimeConnected)
      await statusStore.fetchStatus(accountId)
    if (!disposed && accountId === currentAccountId.value && accountRunning.value)
      await farmStore.fetchLands(accountId)
  },
  onError: () => {}, // Store/API already expose failed reads.
})

function preferenceKey(accountId: string) {
  return `qq-farm-bot-404:farm-new:${accountId}`
}
function loadPreferences(accountId: string) {
  preferencesLoaded = false
  autoRefreshEnabled.value = false
  autoRefreshSeconds.value = 3
  landView.value = 'compact'
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey(accountId)) || '{}')
    autoRefreshEnabled.value = saved.enabled === true
    autoRefreshSeconds.value = normalizeRefreshSeconds(saved.seconds ?? 3)
    landView.value = saved.view === 'default' ? 'default' : 'compact'
  }
  catch {
    // Keep defaults when local storage is unavailable or malformed.
  }
  preferencesLoaded = true
}
function savePreferences() {
  if (!preferencesLoaded || !currentAccountId.value)
    return
  try {
    localStorage.setItem(preferenceKey(currentAccountId.value), JSON.stringify({
      enabled: autoRefreshEnabled.value,
      seconds: autoRefreshSeconds.value,
      view: landView.value,
    }))
  }
  catch {
    // Preferences must never prevent viewing the farm.
  }
}
function restartRefresh() {
  refreshController.stop()
  if (!disposed && visibility.value === 'visible' && accountRunning.value && !busy.value)
    refreshController.start(autoRefreshEnabled.value ? autoRefreshSeconds.value : 60)
}
function changeRefreshSeconds(event: Event) {
  const input = event.target as HTMLInputElement
  autoRefreshSeconds.value = normalizeRefreshSeconds(input.value)
  input.value = String(autoRefreshSeconds.value)
}
function actionCancelled(accountId: string, sequence: number) {
  return disposed || sequence !== actionSequence || accountId !== currentAccountId.value
    || !accountRunning.value || visibility.value !== 'visible'
}
function requestOperation(operation: typeof operations[number]) {
  if (!currentAccountId.value || !accountRunning.value || busy.value || loading.value)
    return
  pendingOperation.value = { operation, accountId: currentAccountId.value, sequence: actionSequence }
}

function requestRemoveLand(land: Land) {
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!currentAccountId.value || !accountRunning.value || busy.value || loading.value || !canRemoveLand(snapshot))
    return
  pendingOperation.value = {
    accountId: currentAccountId.value,
    sequence: actionSequence,
    operation: {
      type: 'remove',
      label: '铲除',
      land: { ...snapshot! },
      message: `确定要铲除 #${land.id} ${snapshot?.plantName || '该作物'} 吗？此操作不可恢复。`,
    },
  }
}

async function executeOperation() {
  const pending = pendingOperation.value
  if (!pending || operating.value || fertilizePending.value || ripeningLandId.value !== null)
    return
  pendingOperation.value = null
  const { operation, accountId, sequence } = pending
  if (actionCancelled(accountId, sequence))
    return
  operating.value = true
  try {
    if (operation.type === 'remove') {
      const latest = lands.value.find(land => land.id === operation.land.id)
      if (!canRemoveLand(latest) || latest?.plantId !== operation.land.plantId
        || latest?.currentSeason !== operation.land.currentSeason) {
        toast.warning('作物状态已变化，请刷新后重试')
        return
      }
      await farmStore.removePlant(accountId, operation.land.id)
      if (!actionCancelled(accountId, sequence))
        toast.success(`第 ${operation.land.id} 块土地的作物已铲除`)
    }
    else if (operation.type === 'removeAll') {
      const result = await farmStore.removeAllPlants(accountId)
      if (!actionCancelled(accountId, sequence))
        toast.success(result?.data?.message || `已铲除 ${Number(result?.data?.removed || 0)} 块土地的作物`)
    }
    else {
      await farmStore.operate(accountId, operation.type)
      if (!actionCancelled(accountId, sequence))
        toast.success(`${operation.label}已执行`)
    }
  }
  catch (cause: any) {
    if (!actionCancelled(accountId, sequence))
      toast.error(String(cause?.response?.data?.error || cause?.message || `${operation.label}失败`))
  }
  finally {
    operating.value = false
  }
}

async function handleFertilize(land: Land, fertilizerType: FertilizerType) {
  const accountId = currentAccountId.value
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!accountId || busy.value || loading.value || !accountRunning.value || !canRipenLand(snapshot))
    return
  if (fertilizerType === 'normal' && !canNormalFertilize(snapshot))
    return
  const sequence = actionSequence
  fertilizingLandId.value = land.id
  try {
    const result = await farmStore.applyFertilizer(accountId, land.id, fertilizerType)
    if (actionCancelled(accountId, sequence))
      return
    if (result)
      toast.success(`第 ${land.id} 块土地已施${fertilizerType === 'normal' ? '普通' : '有机'}化肥`)
    else
      toast.warning(fertilizeError.value || '当前无法继续施肥')
  }
  finally {
    if (sequence === actionSequence)
      fertilizingLandId.value = null
  }
}
async function handleRipen(land: Land) {
  const accountId = currentAccountId.value
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!accountId || busy.value || loading.value || !accountRunning.value || !canRipenLand(snapshot))
    return
  const sequence = ++actionSequence
  ripeningLandId.value = land.id
  const cancelled = () => actionCancelled(accountId, sequence)
  let ownsOperation = false
  try {
    const result = await ripenLand({
      getLand: () => lands.value.find(item => item.id === land.id),
      cancelled,
      fertilize: type => farmStore.applyFertilizer(accountId, land.id, type),
    })
    if (result.cancelled)
      return
    const count = `普通 ${result.normalCount} 次，有机 ${result.organicCount} 次`
    if (!result.matured) {
      const reasons: Record<string, string> = {
        'unavailable': fertilizeError.value || '当前无法继续施肥',
        'no-progress': '作物状态未继续推进，请刷新后重试',
        'empty': '有机化肥已用尽',
        'unconfirmed': '未返回最新土地状态，请刷新后重试',
        'changed': '作物状态已变化，请刷新后重试',
        'limit': '已达到本次施肥次数上限，请刷新后确认',
      }
      toast.warning(`已停止催熟（${count}）：${reasons[result.stopped] || '当前无法继续施肥'}`)
      return
    }
    toast.success(`第 ${land.id} 块土地催熟完成（${count}）`)
    // Follow the normal edition's full farm operation only after confirmed maturity.
    ownsOperation = true
    operating.value = true
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (cancelled())
      return
    await farmStore.operate(accountId, 'all')
    if (!cancelled())
      toast.success('催熟后已执行一键全收')
  }
  catch (cause: any) {
    if (!cancelled())
      toast.error(String(cause?.response?.data?.error || cause?.message || '催熟操作失败'))
  }
  finally {
    if (sequence === actionSequence) {
      ripeningLandId.value = null
    }
    if (ownsOperation)
      operating.value = false
  }
}

watch(currentAccountId, (accountId, previousId) => {
  actionSequence++
  pendingOperation.value = null
  ripeningLandId.value = null
  fertilizingLandId.value = null
  if (previousId !== undefined && accountId !== previousId)
    farmStore.clearFarmData()
  loadPreferences(accountId)
  restartRefresh()
  void refreshController.run()
}, { immediate: true })
watch([autoRefreshEnabled, autoRefreshSeconds, landView], () => {
  savePreferences()
  restartRefresh()
})
watch([accountRunning, visibility, busy], ([running, visible]) => {
  restartRefresh()
  if (visible !== 'visible' || !running) {
    actionSequence++
    pendingOperation.value = null
    ripeningLandId.value = null
    fertilizingLandId.value = null
  }
  else {
    void refreshController.run()
  }
})
const { pause } = useIntervalFn(() => {
  clock.value = Date.now()
}, 1000)
onUnmounted(() => {
  disposed = true
  actionSequence++
  pause()
  refreshController.stop()
})
</script>

<template>
  <section class="farm-new-panel" aria-label="我的农场New">
    <div class="farm-new-toolbar">
      <div class="farm-new-heading">
        <span class="farm-new-heading-icon i-carbon-sprout" />
        <div>
          <h3>土地详情</h3>
          <span class="farm-new-caption">{{ loaded && !error ? `${lands.length} 块土地` : '我的农场' }}</span>
        </div>
      </div>
      <div class="farm-new-tools">
        <button type="button" class="farm-new-refresh" title="刷新土地" aria-label="刷新土地" :disabled="loading || busy || !accountRunning" @click="refreshController.run()">
          <span :class="loading ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-renew'" />
          <span>刷新</span>
        </button>
        <div class="farm-new-auto-refresh">
          <BaseSwitch v-model="autoRefreshEnabled" label="定时刷新" />
          <label class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input class="farm-new-interval" type="number" :value="autoRefreshSeconds" min="1" max="3600" step="1" :disabled="!autoRefreshEnabled" aria-label="土地详情刷新间隔（秒）" @change="changeRefreshSeconds">
            秒
          </label>
        </div>
        <div class="land-view-switch" role="group" aria-label="土地布局">
          <button type="button" title="默认视图" aria-label="默认视图" :aria-pressed="landView === 'default'" @click="landView = 'default'">
            <span class="i-carbon-grid" /><span>标准</span>
          </button>
          <button type="button" title="缩放视图" aria-label="缩放视图" :aria-pressed="landView === 'compact'" @click="landView = 'compact'">
            <span class="i-carbon-zoom-out" /><span>紧凑</span>
          </button>
        </div>
      </div>
    </div>
    <div class="farm-new-command-bar">
      <div class="farm-new-summary" aria-label="土地状态统计">
        <span class="farm-stat" data-status="harvestable"><i /><span>可收</span><strong>{{ loaded && !error ? (summary.harvestable || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="growing"><i /><span>生长</span><strong>{{ loaded && !error ? (summary.growing || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="empty"><i /><span>空闲</span><strong>{{ loaded && !error ? (summary.empty || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="dead"><i /><span>枯萎</span><strong>{{ loaded && !error ? (summary.dead || 0) : '--' }}</strong></span>
      </div>
      <div class="farm-new-actions" role="group" aria-label="农场批量操作">
        <button
          v-for="operation in operations" :key="operation.type" type="button"
          class="farm-operation" :data-operation="operation.type"
          :disabled="busy || loading || !accountRunning" @click="requestOperation(operation)"
        >
          <span :class="operation.icon" />
          {{ operation.label }}
        </button>
      </div>
    </div>
    <div class="p-3 sm:p-5">
      <div v-if="!currentAccountId" class="farm-new-empty">
        <span class="i-carbon-user-offline text-4xl" /><strong>未登录账号</strong><span>请先添加农场账号</span>
      </div>
      <div v-else-if="!accountRunning" class="farm-new-empty">
        <span class="i-carbon-connection-signal-off text-4xl" /><strong>账号未运行</strong><span>请先启动账号，启动后会立即读取土地</span>
      </div>
      <div v-else-if="loading && !loaded" class="farm-new-empty">
        <span class="i-svg-spinners-90-ring-with-bg text-4xl text-green-500" />正在读取土地
      </div>
      <div v-else-if="error" class="farm-new-empty text-red-600 dark:text-red-300">
        <span class="i-carbon-warning-alt text-4xl" /><span>{{ error }}</span>
        <button type="button" class="farm-new-retry" :disabled="loading || busy" @click="refreshController.run()">
          重新读取
        </button>
      </div>
      <div v-else-if="!loaded || !lands.length" class="farm-new-empty">
        <span class="i-carbon-sprout text-4xl" /><span>{{ loaded ? '当前没有可展示的土地' : '尚未读取土地详情' }}</span>
        <button type="button" class="farm-new-retry" :disabled="loading || busy" @click="refreshController.run()">
          立即读取
        </button>
      </div>
      <div v-else class="land-grid" :class="landView === 'compact' ? 'land-grid--compact' : 'grid grid-cols-2 gap-4 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3'" :aria-busy="loading">
        <FarmNewLandCard
          v-for="land in displayLands" :key="land.id" :land="land" :compact="landView === 'compact'"
          :show-remove-action="canRemoveLand(land)" :remove-disabled="busy || loading || !accountRunning"
          :show-fertilizer-actions="canRipenLand(land)" :show-ripen-action="canRipenLand(land)"
          :fertilizer-pending="fertilizingLandId === land.id || ripeningLandId === land.id"
          :normal-fertilizer-disabled="busy || loading || !canNormalFertilize(land)" :organic-fertilizer-disabled="busy || loading"
          :ripen-pending="ripeningLandId === land.id" :ripen-disabled="busy || loading"
          @fertilize="handleFertilize" @ripen="handleRipen" @remove="requestRemoveLand"
        />
      </div>
    </div>
    <ConfirmModal
      :show="confirmVisible" :title="pendingOperation ? `确认${pendingOperation.operation.label}` : '确认操作'"
      :message="pendingOperation?.operation.message || ''"
      :type="pendingOperation?.operation.type === 'removeAll' || pendingOperation?.operation.type === 'remove' ? 'danger' : 'primary'"
      @confirm="executeOperation" @cancel="pendingOperation = null" @close="pendingOperation = null"
    />
  </section>
</template>

<style scoped>
.farm-new-panel {
  border: 1px solid var(--surface-border);
  border-radius: 16px;
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
  --ui-ink: #293b32;
  --ui-muted: #758178;
  --ui-border: #dce4da;
  --ui-primary: var(--theme-primary, #438d63);
  --ui-primary-soft: #edf7ed;
  --ui-violet: #8f79bc;
  --ui-shadow-sm: 0 2px 8px rgba(40, 48, 44, 0.08);
  --ui-shadow-md: 0 8px 20px rgba(40, 48, 44, 0.12);
}
:global(.dark) .farm-new-panel {
  --ui-ink: #e5eae4;
  --ui-muted: #a2ada4;
  --ui-border: #46554a;
  --ui-primary-soft: #263e30;
}
.farm-new-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--surface-border);
}
.farm-new-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.farm-new-heading-icon {
  width: 38px;
  height: 38px;
  padding: 9px;
  border-radius: 12px;
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 9%, transparent);
}
.farm-new-heading h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
}
.farm-new-caption {
  font-size: 12px;
  color: var(--muted-text);
}
.farm-new-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.farm-new-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--muted-text);
  font-size: 13px;
}
.farm-new-refresh:hover {
  background: var(--surface-2);
  color: var(--theme-primary);
}
.farm-new-auto-refresh {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 4px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 9px;
}
.farm-new-auto-refresh :deep(label) {
  gap: 8px;
}
.farm-new-auto-refresh :deep(label > span) {
  font-size: 12px;
}
.farm-new-interval {
  width: 48px;
  padding: 3px 2px;
  border: 0;
  border-bottom: 1px solid var(--surface-border-strong);
  border-radius: 0;
  color: var(--theme-text);
  background: transparent;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.farm-new-interval:disabled {
  opacity: 0.4;
}
.land-view-switch {
  display: flex;
  flex-shrink: 0;
  gap: 3px;
  border: 1px solid var(--surface-border);
  border-radius: 9px;
  padding: 3px;
  background: var(--surface-2);
}
.land-view-switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  padding: 4px 9px;
  border-radius: 6px;
  color: var(--muted-text);
  font-size: 12px;
}
.land-view-switch button[aria-pressed='true'] {
  color: var(--theme-primary);
  background: var(--surface-1);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.07);
}
.farm-new-command-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px 20px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}
.farm-new-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}
.farm-stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-text);
  white-space: nowrap;
}
.farm-stat strong {
  color: var(--theme-text);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.farm-stat i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a6afa7;
}
.farm-stat[data-status='harvestable'] i {
  background: #d6a243;
}
.farm-stat[data-status='growing'] i {
  background: #6aaa78;
}
.farm-stat[data-status='dead'] i {
  background: #cb8c85;
}
.farm-new-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}
.farm-operation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid var(--surface-border-strong);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    background 150ms,
    border-color 150ms;
}
.farm-operation:hover:not(:disabled) {
  border-color: var(--theme-primary);
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 5%, var(--surface-1));
}
.farm-operation[data-operation='all'] {
  color: #fff;
  border-color: var(--theme-primary);
  background: var(--theme-primary);
}
.farm-operation[data-operation='all']:hover:not(:disabled) {
  color: #fff;
  background: var(--theme-secondary);
}
.farm-operation[data-operation='removeAll'] {
  margin-left: 4px;
  color: #bf6262;
  border-color: color-mix(in srgb, #bf6262 25%, var(--surface-border));
  background: transparent;
}
.farm-operation[data-operation='removeAll']:hover:not(:disabled) {
  color: #b54d4d;
  border-color: #bf6262;
  background: color-mix(in srgb, #bf6262 7%, transparent);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.land-grid--compact {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  max-width: 640px;
}
.farm-new-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  text-align: center;
  color: var(--ui-muted);
}
.farm-new-empty strong {
  color: var(--ui-ink);
  font-size: 18px;
}
.farm-new-retry {
  padding: 6px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (max-width: 480px) {
  .farm-new-toolbar {
    padding: 14px;
  }
  .farm-new-tools {
    gap: 8px;
    width: 100%;
  }
  .farm-new-command-bar {
    padding: 12px 14px;
    gap: 12px;
  }
  .farm-new-summary {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }
  .farm-new-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    gap: 6px;
  }
  .farm-operation {
    padding: 7px 4px;
    font-size: 11px;
  }
  .farm-operation[data-operation='removeAll'] {
    margin-left: 0;
  }
  .farm-new-auto-refresh {
    gap: 7px;
    padding: 4px 7px;
  }
  .land-grid--compact {
    gap: 4px;
  }
}
</style>
