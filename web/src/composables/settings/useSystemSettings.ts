import { computed, ref } from 'vue'
import api from '@/api'

export interface SystemSettings {
  organicFertilizerDelayMinMs: number | string
  organicFertilizerDelayMaxMs: number | string
}

export function useSystemSettings() {
  const form = ref<SystemSettings>({
    organicFertilizerDelayMinMs: 200,
    organicFertilizerDelayMaxMs: 300,
  })
  const loading = ref(false)
  const saving = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const saved = ref(false)
  const validationError = computed(() => {
    const min = form.value.organicFertilizerDelayMinMs
    const max = form.value.organicFertilizerDelayMaxMs
    if (![min, max].every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60000))
      return '施肥间隔必须是 0～60000 毫秒的整数'
    return Number(min) > Number(max) ? '施肥间隔下限不能大于上限' : ''
  })

  async function load() {
    if (loading.value || saving.value)
      return
    loading.value = true
    error.value = ''
    saved.value = false
    try {
      const { data } = await api.get('/api/admin/system-settings')
      if (!data?.ok || !data.data)
        throw new Error(data?.error || '系统设置读取失败')
      form.value = { ...data.data }
      loaded.value = true
    }
    catch (cause: any) {
      loaded.value = false
      error.value = cause.response?.data?.error || cause.message || '系统设置读取失败'
    }
    finally {
      loading.value = false
    }
  }

  async function save() {
    if (!loaded.value || loading.value || saving.value || validationError.value)
      return
    saving.value = true
    error.value = ''
    saved.value = false
    try {
      const { data } = await api.post('/api/admin/system-settings', { ...form.value })
      if (!data?.ok || !data.data)
        throw new Error(data?.error || '系统设置保存失败')
      form.value = { ...data.data }
      saved.value = true
    }
    catch (cause: any) {
      error.value = cause.response?.data?.error || cause.message || '系统设置保存失败'
    }
    finally {
      saving.value = false
    }
  }

  return { form, loading, saving, loaded, error, saved, validationError, load, save }
}
