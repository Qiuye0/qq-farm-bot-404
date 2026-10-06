<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed } from 'vue'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const props = withDefaults(defineProps<{
  status: any
  currentStatusReady: boolean
  currentAccount: Account | null | undefined
  dashboardItems: any[]
  illustratedLevels: { crop: number, mutant: number }
  localUptime: number
  compact?: boolean
}>(), { compact: false })
const currentAccountDisconnected = computed(() => props.currentStatusReady && !props.status?.connection?.connected)

const displayName = computed(() => {
  const account = props.currentAccount
  const gameName = props.status?.status?.name

  if (gameName) {
    if (account?.name)
      return `${gameName} (${account.name})`
    return gameName
  }

  if (currentAccountDisconnected.value) {
    if (account) {
      if (account.name && account.nick)
        return `${account.nick} (${account.name})`
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  if (account) {
    if (account.name && account.nick)
      return `${account.nick} (${account.name})`
    return account.name || account.nick || '未命名'
  }

  return '未命名'
})

const expRate = computed(() => {
  const gain = props.status?.sessionExpGained || 0
  const uptime = props.status?.uptime || 0
  if (!uptime)
    return '0/小时'
  const rate = gain / (uptime / 3600)
  return `${Math.floor(rate)}/小时`
})

const timeToLevel = computed(() => {
  const gain = props.status?.sessionExpGained || 0
  const uptime = props.status?.uptime || 0
  const current = props.status?.levelProgress?.current || 0
  const needed = props.status?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const ratePerHour = gain / (uptime / 3600)
  if (ratePerHour <= 0)
    return ''

  const expNeeded = Math.max(0, needed - current)
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

const fertilizerNormal = computed(() => props.dashboardItems.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => props.dashboardItems.find((item: any) => Number(item.id) === 1012))

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = Math.floor(seconds % 60)
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

function getExpPercent(progress: any) {
  if (!progress || !progress.needed)
    return 0
  return Math.min(100, Math.max(0, (progress.current / progress.needed) * 100))
}
</script>

<template>
  <div class="account-overview-cards grid grid-cols-1 shrink-0 gap-4 lg:grid-cols-3 sm:grid-cols-2" :class="{ 'account-overview-cards--compact': compact }">
    <div class="ui-card metric-card min-h-[168px] flex flex-col rounded-lg p-5">
      <div class="mb-2 flex items-start justify-between">
        <div class="flex items-center gap-1.5 text-sm text-gray-500">
          <div class="i-fas-user-circle" />
          账号
        </div>
        <div class="rounded-lg bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          Lv.{{ status?.status?.level || 0 }}
        </div>
      </div>
      <div class="mb-1 truncate text-xl font-bold" :title="displayName">
        {{ displayName }}
      </div>
      <div class="mt-auto">
        <div class="mb-1 flex justify-between text-xs text-gray-500">
          <div class="flex items-center gap-1">
            <div class="i-fas-bolt text-blue-400" />
            <span>EXP</span>
          </div>
          <span>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}</span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            class="h-full rounded-full bg-blue-500 transition-all duration-500"
            :style="{ width: `${getExpPercent(status?.levelProgress)}%` }"
          />
        </div>
        <div class="mt-2 flex justify-between text-xs text-gray-400">
          <span>效率: {{ expRate }}</span>
          <span>{{ timeToLevel }}</span>
        </div>
      </div>
    </div>

    <div class="ui-card metric-card min-h-[168px] flex flex-col justify-between rounded-lg p-5">
      <div class="grid grid-cols-4 gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/gold.png" alt="金币" class="h-5 w-5 shrink-0 object-contain">
            金币
          </div>
          <div class="text-2xl text-yellow-600 font-bold dark:text-yellow-500">
            {{ formatGoldAmount(status?.status?.gold || 0) }}
          </div>
          <div
            v-if="(status?.sessionGoldGained || 0) !== 0"
            class="text-[10px]"
            :class="(status?.sessionGoldGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
          >
            {{ (status?.sessionGoldGained || 0) > 0 ? '+' : '' }}{{ formatGoldAmount(status?.sessionGoldGained || 0) }}
          </div>
        </div>
        <div class="min-w-0 text-center">
          <div class="flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/coupon.png" alt="点券" class="h-5 w-5 shrink-0 object-contain">
            点券
          </div>
          <div class="text-2xl text-emerald-500 font-bold dark:text-emerald-400">
            {{ formatCouponAmount(status?.status?.coupon || 0) }}
          </div>
          <div
            v-if="(status?.sessionCouponGained || 0) !== 0"
            class="text-[10px]"
            :class="(status?.sessionCouponGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
          >
            {{ (status?.sessionCouponGained || 0) > 0 ? '+' : '' }}{{ formatCouponAmount(status?.sessionCouponGained || 0) }}
          </div>
        </div>
        <div class="min-w-0 text-center">
          <div class="flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/diamond.png" alt="钻石" class="h-5 w-5 shrink-0 object-contain">
            钻石
          </div>
          <div class="text-2xl text-cyan-600 font-bold dark:text-cyan-400">
            {{ formatCouponAmount(status?.status?.diamond || 0) }}
          </div>
        </div>
        <div class="min-w-0 text-right">
          <div class="flex items-center justify-end gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/gold-bean.png" alt="金豆豆" class="h-5 w-5 shrink-0 object-contain">
            金豆
          </div>
          <div class="text-2xl text-amber-500 font-bold dark:text-amber-400">
            {{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}
          </div>
        </div>
      </div>
      <div class="mt-4 border-t border-gray-100/80 pt-3 dark:border-gray-700/80">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="h-2.5 w-2.5 rounded-full" :class="status?.connection?.connected ? 'bg-green-500' : currentStatusReady ? 'bg-red-500' : 'bg-gray-300'" />
            <span class="text-xs font-bold">{{ status?.connection?.connected ? '在线' : currentStatusReady ? '离线' : '检查中' }}</span>
          </div>
          <div class="flex items-center gap-1.5 text-xs text-gray-400">
            <div class="i-fas-clock text-purple-400" />
            {{ formatDuration(localUptime) }}
          </div>
        </div>
      </div>
    </div>

    <div class="ui-card metric-card min-h-[168px] flex flex-col justify-between rounded-lg p-5">
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <img src="/game-config/resource-icons/fertilizer-normal.png" alt="普通化肥" class="h-5 w-5 shrink-0 object-contain">
            普通
          </div>
          <div class="font-bold">
            {{ formatBucketTime(fertilizerNormal) }}
          </div>
        </div>
        <div>
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <img src="/game-config/resource-icons/fertilizer-organic.png" alt="有机化肥" class="h-5 w-5 shrink-0 object-contain">
            有机
          </div>
          <div class="font-bold">
            {{ formatBucketTime(fertilizerOrganic) }}
          </div>
        </div>
      </div>
      <div class="my-3 border-t border-gray-100/80 dark:border-gray-700/80" />
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <img src="/game-config/resource-icons/illustrated-crop.png" alt="作物图鉴" class="h-6 w-6 shrink-0 object-contain">
            作物图鉴
          </div>
          <div class="font-bold">
            Lv.{{ illustratedLevels.crop }}
          </div>
        </div>
        <div>
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <img src="/game-config/resource-icons/illustrated-mutant.png" alt="超变图鉴" class="h-6 w-6 shrink-0 object-contain">
            超变图鉴
          </div>
          <div class="font-bold">
            Lv.{{ illustratedLevels.mutant }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-overview-cards--compact {
  gap: 12px;
}
.account-overview-cards--compact > div {
  min-height: 154px;
  border-radius: 14px;
  padding: 16px 18px;
}
.account-overview-cards--compact .text-2xl {
  font-size: clamp(17px, 1.65vw, 24px);
  line-height: 1.4;
}
@media (min-width: 1100px) {
  .account-overview-cards--compact {
    grid-template-columns: 1.05fr 1.25fr 1fr;
  }
}
@media (max-width: 639px) {
  .account-overview-cards--compact > div {
    min-height: 138px;
    padding: 14px 16px;
  }
}
</style>
