<script setup lang="ts">
import axios from 'axios'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { verifyAdminCode } from '@/utils/admin-auth'
import { safeAuthRedirect } from '@/utils/auth-redirect'

const route = useRoute()
const version = __APP_VERSION__
const router = useRouter()
const appStore = useAppStore()
const code = ref('')
const visible = ref(false)
const submitting = ref(false)
const error = ref('')
const retrySeconds = ref(0)
const codeInput = ref<HTMLInputElement | null>(null)
const title = computed(() => appStore.loginPageConfig.title || 'QQ农场智能助手')
let retryTimer: ReturnType<typeof setInterval> | undefined

function startRetryCountdown(seconds: number) {
  if (retryTimer)
    clearInterval(retryTimer)
  const deadline = Date.now() + seconds * 1000
  retrySeconds.value = seconds
  retryTimer = setInterval(() => {
    retrySeconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!retrySeconds.value)
      clearInterval(retryTimer)
  }, 1000)
}

async function submit() {
  if (submitting.value || retrySeconds.value)
    return
  if (!code.value) {
    error.value = '请输入 Code'
    codeInput.value?.focus()
    return
  }
  submitting.value = true
  error.value = ''
  try {
    await verifyAdminCode(code.value)
    code.value = ''
    await router.replace(safeAuthRedirect(route.query.redirect))
  }
  catch (cause) {
    if (axios.isAxiosError(cause)) {
      if (cause.response?.status === 429) {
        const retryAfter = Number(cause.response.headers['retry-after'])
        startRetryCountdown(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60)
        error.value = '验证次数过多，请稍后再试'
      }
      else if (cause.response?.status === 401) {
        error.value = 'Code 不正确，请重新输入'
        codeInput.value?.focus()
        codeInput.value?.select()
      }
      else {
        error.value = cause.response ? '验证暂时不可用，请稍后重试' : '无法连接服务器，请稍后重试'
      }
    }
    else {
      error.value = '验证失败，请重试'
    }
  }
  finally {
    submitting.value = false
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  codeInput.value?.focus()
})

onBeforeUnmount(() => {
  if (retryTimer)
    clearInterval(retryTimer)
  code.value = ''
})
</script>

<template>
  <main class="code-login">
    <div class="code-login-content">
      <header class="code-login-brand">
        <img src="/icon.png" :alt="title" width="56" height="56">
        <h1>{{ title }}</h1>
      </header>

      <form class="code-login-form" :aria-busy="submitting" @submit.prevent="submit">
        <div class="code-login-heading">
          <span class="i-carbon-locked" aria-hidden="true" />
          <h2>访问验证</h2>
        </div>
        <label for="access-code">Code</label>
        <div class="code-login-input">
          <input
            id="access-code"
            ref="codeInput"
            v-model="code"
            name="code"
            :type="visible ? 'text' : 'password'"
            placeholder="输入访问 Code"
            autocomplete="current-password"
            autocapitalize="off"
            :spellcheck="false"
            maxlength="128"
            :disabled="submitting"
            :aria-invalid="!!error"
            aria-describedby="code-error"
            @input="error = ''"
          >
          <button
            type="button"
            :title="visible ? '隐藏 Code' : '显示 Code'"
            :aria-label="visible ? '隐藏 Code' : '显示 Code'"
            :aria-pressed="visible"
            @click="visible = !visible"
          >
            <span :class="visible ? 'i-carbon-view-off' : 'i-carbon-view'" aria-hidden="true" />
          </button>
        </div>
        <div id="code-error" class="code-login-error" role="status" aria-live="polite">
          {{ error }}
        </div>
        <button class="code-login-submit" type="submit" :disabled="submitting || retrySeconds > 0">
          <span v-if="submitting" class="i-svg-spinners-ring-resize" aria-hidden="true" />
          <span>{{ submitting ? '正在验证' : retrySeconds ? `${retrySeconds} 秒后重试` : '验证并进入' }}</span>
          <span v-if="!submitting && !retrySeconds" class="i-carbon-arrow-right" aria-hidden="true" />
        </button>
      </form>
      <footer>QQ FARM ASSISTANT <span>v{{ version }}</span></footer>
    </div>
  </main>
</template>

<style scoped>
.code-login {
  display: grid;
  min-height: 100dvh;
  height: 100%;
  padding: 32px 20px;
  overflow-y: auto;
  background: var(--surface-2);
  place-items: center;
}

.code-login-content {
  width: min(100%, 380px);
  min-width: 0;
}

.code-login-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 32px;
}

.code-login-brand img {
  flex: none;
  border-radius: 8px;
}

h1 {
  font-size: 22px;
  font-weight: 650;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.code-login-form {
  padding-top: 24px;
  border-top: 1px solid var(--surface-border-strong);
}

.code-login-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
  color: var(--theme-text);
}

.code-login-heading span {
  font-size: 20px;
  color: var(--theme-primary);
}

h2 {
  font-size: 18px;
  font-weight: 600;
}

label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.code-login-input {
  display: flex;
  min-height: 48px;
  overflow: hidden;
  border: 1px solid var(--surface-border-strong);
  border-radius: 8px;
  background: var(--input-bg);
}

.code-login-input:focus-within {
  border-color: var(--theme-primary);
  outline: 2px solid color-mix(in srgb, var(--theme-primary) 18%, transparent);
  outline-offset: 2px;
}

input {
  flex: 1;
  width: 0;
  min-width: 0;
  padding: 12px 14px;
  outline: none;
  color: var(--theme-text);
  font-size: 16px;
}

input::placeholder {
  color: var(--muted-text);
}

.code-login-input button {
  display: grid;
  width: 48px;
  flex: none;
  color: var(--muted-text);
  font-size: 20px;
  place-items: center;
}

button:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: -3px;
}

.code-login-error {
  min-height: 48px;
  padding: 10px 0;
  color: #e5484d;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.code-login-submit {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--theme-primary);
  color: white;
  font-size: 15px;
  font-weight: 600;
  transition: opacity 150ms;
}

.code-login-submit:hover {
  opacity: 0.88;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-top: 32px;
  color: var(--muted-text);
  font-size: 11px;
}
</style>
