<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import type { OfflineConfig } from '@/stores/setting'

defineProps<{
  saving: boolean
  testing: boolean
  showSave?: boolean
}>()

const emit = defineEmits<{
  test: []
  save: []
}>()

const config = defineModel<OfflineConfig>('config', { required: true })
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
    <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
      <div class="i-carbon-notification" />
      下线提醒
    </h4>

    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BaseSwitch v-model="config.smtpEnabled" label="邮件通知" />
        <BaseSwitch v-model="config.xtuisEnabled" label="虾推通知" />
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        两个渠道可同时开启、单独开启或全部关闭。说明会自动附带账号名称、下线原因和离线时长。
      </p>
      <BaseInput v-model="config.title" label="通知标题" placeholder="账号下线提醒" />
      <div class="flex flex-col gap-1.5">
        <label for="offline-notification-description" class="text-sm text-gray-700 font-medium dark:text-gray-300">通知说明</label>
        <textarea
          id="offline-notification-description"
          v-model="config.msg"
          rows="3"
          placeholder="账号已下线，请及时检查"
          class="w-full border border-gray-300 rounded-md bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>

      <div v-if="config.smtpEnabled" class="space-y-3 border border-gray-200 rounded-lg p-3 dark:border-gray-700">
        <h5 class="text-sm font-medium">邮件通知</h5>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseInput v-model="config.smtpHost" label="SMTP 服务器地址" placeholder="如 smtp.qq.com" />
          <BaseInput v-model.number="config.smtpPort" label="SMTP 端口" type="number" min="1" max="65535" placeholder="465" />
          <BaseInput v-model="config.smtpUser" label="邮箱账号" placeholder="发件人邮箱地址" />
          <BaseInput v-model="config.smtpPass" label="授权码" type="password" placeholder="SMTP 授权码" />
          <BaseInput v-model="config.recipientEmail" label="收件人邮箱" placeholder="接收通知的邮箱地址" />
          <BaseInput v-model="config.senderName" label="发件人名称" placeholder="发件人显示名称" />
        </div>
      </div>

      <div v-if="config.xtuisEnabled" class="space-y-3 border border-gray-200 rounded-lg p-3 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <h5 class="text-sm font-medium">虾推通知</h5>
          <a href="https://xtuis.cn/" target="_blank" rel="noopener noreferrer" class="text-sm text-blue-500">虾推官网</a>
        </div>
        <BaseInput v-model="config.xtuisToken" label="虾推 Token" type="password" placeholder="填写虾推 Token" />
      </div>
      <p v-if="!config.smtpEnabled && !config.xtuisEnabled" class="text-sm text-gray-500 dark:text-gray-400">
        所有通知渠道已关闭。
      </p>
    </div>

    <div class="mt-4 flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="testing"
        :disabled="saving || (!config.smtpEnabled && !config.xtuisEnabled)"
        @click="emit('test')"
      >
        测试通知
      </BaseButton>
      <BaseButton
        v-if="showSave !== false"
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="testing"
        @click="emit('save')"
      >
        保存下线提醒设置
      </BaseButton>
    </div>
  </div>
</template>
