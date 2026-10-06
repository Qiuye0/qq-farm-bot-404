import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => imports[name], ...globals })
  return exports
}
const { ripenLand } = loadModule('../src/utils/ripen-land.ts')
function ripenFixture(behavior) {
  let land = { id: 1, unlocked: true, status: 'growing', matureInSec: 3600, plantId: 123, currentSeason: 1, leftInorcFertTimes: 1 }
  let cancelled = false
  const calls = []
  return {
    calls,
    run: () => ripenLand({
      getLand: () => land, cancelled: () => cancelled,
      fertilize: async (type) => {
        calls.push(type)
        const response = await behavior({ type, index: calls.length, land, cancel: () => { cancelled = true } })
        if (response?.updatedLand)
          land = response.updatedLand
        return response
      },
    }),
  }
}
function reply(land, extra = {}) {
  return { updatedLand: land, fertilizerRemainingSec: 9999, ...extra }
}

test('ripens one land with normal first and repeated organic until confirmed maturity', async () => {
  const f = ripenFixture(({ type, index, land }) => reply({ ...land,
    matureInSec: type === 'normal' ? 2000 : index === 2 ? 1000 : 0,
    status: index === 3 ? 'harvestable' : 'growing',
  }))
  const result = await f.run()
  assert.deepEqual(f.calls, ['normal', 'organic', 'organic'])
  assert.equal(result.matured, true)
  assert.equal(result.normalCount, 1)
  assert.equal(result.organicCount, 2)
})
test('normal failure still allows organic', async () => {
  const f = ripenFixture(({ type, land }) => type === 'normal' ? false : reply({ ...land, status: 'harvestable', matureInSec: 0 }))
  assert.equal((await f.run()).matured, true)
  assert.deepEqual(f.calls, ['normal', 'organic'])
})
test('stops on no progress, unavailable fertilizer, depletion or missing authoritative land', async () => {
  for (const [response, expected] of [
    [land => reply({ ...land }), 'no-progress'],
    [() => false, 'unavailable'],
    [land => reply({ ...land, matureInSec: 500 }, { fertilizerRemainingSec: 0 }), 'empty'],
    [() => reply(null), 'unconfirmed'],
  ]) {
    const f = ripenFixture(({ type, land }) => type === 'normal' ? false : response(land))
    const result = await f.run()
    assert.equal(result.stopped, expected)
    assert.equal(result.matured, false)
    assert.deepEqual(f.calls, ['normal', 'organic'])
  }
})
test('cancellation while waiting prevents any subsequent fertilizer request', async () => {
  const f = ripenFixture(({ land, cancel }) => { cancel(); return reply({ ...land, matureInSec: 500 }) })
  assert.equal((await f.run()).cancelled, true)
  assert.deepEqual(f.calls, ['normal'])
})
test('changed or replaced crop cannot be reported as a successful ripening', async () => {
  const f = ripenFixture(({ land }) => reply({ ...land, plantId: 999, status: 'harvestable', matureInSec: 0 }))
  const result = await f.run()
  assert.equal(result.matured, false)
  assert.equal(result.stopped, 'changed')
  assert.equal(f.calls.length, 1)
})
test('a zero countdown without mature status never counts as confirmed maturity', async () => {
  const f = ripenFixture(({ land }) => reply({ ...land, matureInSec: 0 }))
  assert.equal((await f.run()).matured, false)
  assert.equal(f.calls.length, 1)
})

const timers = new Map()
let nextTimer = 1
const { createFarmRefreshController, normalizeRefreshSeconds } = loadModule('../src/utils/farm-new-refresh.ts', {}, {
  setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id },
  clearInterval(id) { timers.delete(id) },
})
test('refresh interval accepts only bounded whole seconds', () => {
  assert.equal(normalizeRefreshSeconds(0), 1)
  assert.equal(normalizeRefreshSeconds(1.8), 2)
  assert.equal(normalizeRefreshSeconds(99999), 3600)
  assert.equal(normalizeRefreshSeconds('bad'), 3)
})
test('manual and timer refresh coalesce, and account switches do not wait on previous accounts', async () => {
  let accountId = 'a'
  const calls = []
  const completions = new Map()
  const controller = createFarmRefreshController({
    getAccountId: () => accountId, canRefresh: () => true, onError: () => {},
    refresh: id => new Promise(resolve => { calls.push(id); completions.set(id, resolve) }),
  })
  const first = controller.run()
  assert.equal(controller.run(), first)
  await Promise.resolve()
  accountId = 'b'
  const second = controller.run()
  await Promise.resolve()
  assert.deepEqual(calls, ['a', 'b'])
  completions.get('b')()
  completions.get('a')()
  await Promise.all([first, second])
})
test('hidden/unmounted/busy pages cannot poll and stopping removes the timer', async () => {
  let allowed = false
  let count = 0
  const controller = createFarmRefreshController({
    getAccountId: () => 'a', canRefresh: () => allowed,
    refresh: async () => { count++ }, onError: () => {},
  })
  controller.start(3)
  const tick = [...timers.values()][0]
  tick()
  await controller.run()
  assert.equal(count, 0)
  allowed = true
  await controller.run()
  assert.equal(count, 1)
  controller.stop()
  assert.equal(timers.size, 0)
})
test('failed refresh releases concurrency guard and permits retry', async () => {
  let count = 0
  let errors = 0
  const controller = createFarmRefreshController({
    getAccountId: () => 'a', canRefresh: () => true,
    refresh: async () => { count++; throw new Error('fixture') }, onError: () => { errors++ },
  })
  await controller.run()
  await controller.run()
  assert.equal(count, 2)
  assert.equal(errors, 2)
})

function storeFixture() {
  const account = { currentAccountId: 'a' }
  let get = async () => ({ data: { ok: true, data: { lands: [], summary: {} } } })
  let post = async () => ({ data: { ok: true } })
  const api = { get: (...args) => get(...args), post: (...args) => post(...args) }
  const exports = loadModule('../src/stores/farm.ts', {
    vue: { ref: value => ({ value }) },
    pinia: { defineStore: (_name, setup) => setup },
    '@/api': { default: api },
    '@/stores/account': { useAccountStore: () => account },
  })
  return {
    store: exports.useFarmStore(), account,
    setGet: fn => { get = fn }, setPost: fn => { post = fn },
  }
}
const growingLand = { id: 1, unlocked: true, plantId: 123, currentSeason: 1, status: 'growing', matureInSec: 3600, phaseStartTime: 100 }
const landResponse = lands => ({ data: { ok: true, data: { lands, summary: {} } } })

test('old land responses cannot overwrite a newer request or a switched account', async () => {
  const f = storeFixture()
  const finish = []
  f.setGet(() => new Promise(resolve => finish.push(resolve)))
  const oldRequest = f.store.fetchLands('a')
  const newRequest = f.store.fetchLands('a')
  finish[1](landResponse([{ ...growingLand, matureInSec: 100 }]))
  await newRequest
  finish[0](landResponse([growingLand]))
  await oldRequest
  assert.equal(f.store.lands.value[0].matureInSec, 100)
  const switchedRequest = f.store.fetchLands('a')
  f.account.currentAccountId = 'b'
  f.store.clearFarmData()
  finish[2](landResponse([growingLand]))
  await switchedRequest
  assert.equal(f.store.lands.value.length, 0)
  assert.equal(f.store.loading.value, false)
})
test('a successful fertilizer reply survives an older AllLands reply and updates summary', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: {
    success: true, updatedLand: { ...growingLand, status: 'harvestable', matureInSec: 0 },
  } } }))
  await f.store.applyFertilizer('a', 1, 'organic')
  await f.store.fetchLands('a')
  assert.equal(f.store.lands.value[0].status, 'harvestable')
  assert.equal(f.store.summary.value.harvestable, 1)
  assert.equal(f.store.summary.value.growing, 0)
  // A genuinely new planting must override the overlay even for the same seed and season.
  f.setGet(async () => landResponse([{ ...growingLand, phaseStartTime: 200 }]))
  await f.store.fetchLands('a')
  assert.equal(f.store.lands.value[0].status, 'growing')
})
test('old fertilizer replies cannot update a switched-and-restored account', async () => {
  const f = storeFixture()
  f.store.lands.value = [{ ...growingLand }]
  let finish
  f.setPost(() => new Promise(resolve => { finish = resolve }))
  const pending = f.store.applyFertilizer('a', 1, 'organic')
  assert.equal(await f.store.applyFertilizer('a', 1, 'organic'), false)
  f.account.currentAccountId = 'b'
  f.store.clearFarmData()
  f.account.currentAccountId = 'a'
  f.store.clearFarmData()
  finish({ data: { ok: true, data: { success: true, updatedLand: growingLand } } })
  assert.equal(await pending, false)
  assert.equal(f.store.lands.value.length, 0)
  assert.equal(f.store.fertilizePending.value, false)
})
test('failed land reads expose an error instead of a successful empty farm', async () => {
  const f = storeFixture()
  f.setGet(async () => ({ data: { ok: false, error: 'fixture API failure' } }))
  assert.equal(await f.store.fetchLands('a'), false)
  assert.equal(f.store.loaded.value, false)
  assert.equal(f.store.error.value, 'fixture API failure')
  assert.equal(f.store.loading.value, false)
})

const { canNormalFertilize } = loadModule('../src/utils/ripen-land.ts')
test('ordinary fertilizer is available only with a confirmed positive remaining count', () => {
  for (const remaining of [0, -1, null, undefined, 'bad'])
    assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: remaining }), false)
  assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: 1 }), true)
  assert.equal(canNormalFertilize({ ...growingLand, leftInorcFertTimes: '1' }), true)
  assert.equal(canNormalFertilize({ ...growingLand, status: 'harvestable', leftInorcFertTimes: 1 }), false)
})
test('ripening skips ordinary fertilizer when it has already been used', async () => {
  let land = { ...growingLand, leftInorcFertTimes: 0 }
  const calls = []
  const result = await ripenLand({
    getLand: () => land, cancelled: () => false,
    fertilize: async (type) => {
      calls.push(type)
      land = { ...land, status: 'harvestable', matureInSec: 0 }
      return reply(land)
    },
  })
  assert.equal(result.matured, true)
  assert.deepEqual(calls, ['organic'])
})

function panelFixture() {
  const ref = value => ({ value })
  const calls = []
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const farm = {
    lands: ref([{ ...growingLand }]), summary: ref({}), loading: ref(false), loaded: ref(true), error: ref(''),
    fertilizePending: ref(false), fertilizeError: ref(''),
    async operate(...args) { calls.push(['operate', ...args]); return { ok: true } },
    async removePlant(...args) { calls.push(['remove', ...args]); return { ok: true } },
    async removeAllPlants(...args) { calls.push(['removeAll', ...args]); return { ok: true, data: { removed: 3 } } },
    async applyFertilizer(...args) { calls.push(['fertilize', ...args]); return false },
  }
  const source = readFileSync(new URL('../src/components/FarmNewPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const { outputText } = ts.transpileModule(`${source}\nexports.panel = { operations, pendingOperation, operating, requestOperation, executeOperation, handleFertilize, requestRemoveLand };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  const ripening = loadModule('../src/utils/ripen-land.ts')
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      const modules = {
        'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch() {}, onUnmounted() {} },
        '@vueuse/core': { useDocumentVisibility: () => ref('visible'), useIntervalFn: () => ({ pause() {} }) },
        'pinia': { storeToRefs: store => store },
        '@/stores/account': { useAccountStore: () => account },
        '@/stores/farm': { useFarmStore: () => farm },
        '@/stores/status': { useStatusStore: () => ({ realtimeConnected: true }) },
        '@/stores/toast': { useToastStore: () => ({ success() {}, error() {}, warning() {} }) },
        '@/utils/ripen-land': ripening,
        '@/utils/farm-land-actions': loadModule('../src/utils/farm-land-actions.ts'),
        '@/utils/farm-new-refresh': { createFarmRefreshController: () => ({ start() {}, stop() {}, run() {} }) },
      }
      return modules[name] || {}
    },
  })
  return { ...exports.panel, calls, farm, account }
}
test('all six operations require confirmation and dispatch to their matching existing API', async () => {
  const f = panelFixture()
  assert.deepEqual(Array.from(f.operations, item => item.type), ['harvest', 'clear', 'plant', 'upgrade', 'all', 'removeAll'])
  for (const operation of f.operations) {
    const before = f.calls.length
    f.requestOperation(operation)
    assert.equal(f.calls.length, before)
    assert.equal(f.pendingOperation.value.operation.type, operation.type)
    await f.executeOperation()
    assert.deepEqual(f.calls.at(-1), operation.type === 'removeAll' ? ['removeAll', 'a'] : ['operate', 'a', operation.type])
    assert.equal(f.pendingOperation.value, null)
    assert.equal(f.operating.value, false)
  }
})
test('confirmation cannot target a newly selected account, and executing operations cannot be repeated', async () => {
  const f = panelFixture()
  f.requestOperation(f.operations[0])
  f.account.currentAccountId.value = 'b'
  await f.executeOperation()
  assert.equal(f.calls.length, 0)
  let finish
  f.farm.operate = () => new Promise(resolve => { finish = resolve })
  f.requestOperation(f.operations[0])
  const pending = f.executeOperation()
  f.requestOperation(f.operations[1])
  await f.executeOperation()
  assert.equal(f.pendingOperation.value, null)
  assert.equal(f.operating.value, true)
  finish()
  await pending
  assert.equal(f.operating.value, false)
})
test('bulk operations and ordinary fertilizer are blocked when unavailable', async () => {
  const f = panelFixture()
  f.farm.loading.value = true
  f.requestOperation(f.operations[0])
  assert.equal(f.pendingOperation.value, null)
  f.farm.loading.value = false
  f.farm.lands.value[0].leftInorcFertTimes = 0
  await f.handleFertilize(growingLand, 'normal')
  assert.equal(f.calls.length, 0)
})
test('remove-all clears fertilizer overlays and failed business responses are surfaced', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: { success: true, updatedLand: { ...growingLand, matureInSec: 0, status: 'harvestable' } } } }))
  await f.store.applyFertilizer('a', 1, 'organic')
  f.setPost(async () => ({ data: { ok: true, data: { removed: 1 } } }))
  await f.store.removeAllPlants('a')
  assert.equal(f.store.lands.value[0].status, 'growing')
  f.setPost(async () => ({ data: { ok: false, error: 'fixture failure' } }))
  await assert.rejects(() => f.store.removeAllPlants('a'), /fixture failure/)
  await assert.rejects(() => f.store.operate('a', 'all'), /fixture failure/)
})

function overviewFixture() {
  const ref = value => ({ value })
  const account = { currentAccountId: ref('a'), currentAccount: ref({ running: true }) }
  const ready = ref(true)
  const visibility = ref('visible')
  const watchers = []
  const cleanup = []
  const calls = []
  const completions = new Map()
  const statusStore = {
    status: { connection: { connected: true }, uptime: 100 }, realtimeConnected: true,
    currentStatusReady: ready,
    connectRealtime(id) { calls.push(['realtime', id]) },
    async fetchStatus(id) { calls.push(['status', id]) },
  }
  const bag = {
    dashboardItems: ref([]),
    async fetchBag(id) { calls.push(['bag', id]) }, clearBag() { calls.push(['clearBag']) },
  }
  const source = readFileSync(new URL('../src/components/PersonalAccountOverview.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const { outputText } = ts.transpileModule(`${source}\nexports.overview = { refresh, illustratedLevels };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      const modules = {
        'vue': { ref, computed: fn => ({ get value() { return fn() } }), watch: (...args) => watchers.push(args), onUnmounted: fn => cleanup.push(fn) },
        '@vueuse/core': { useDocumentVisibility: () => visibility, useIntervalFn() {} },
        'pinia': { storeToRefs: store => store },
        '@/stores/account': { useAccountStore: () => account },
        '@/stores/status': { useStatusStore: () => statusStore },
        '@/stores/bag': { useBagStore: () => bag },
        '@/stores/farm': { useFarmStore: () => ({ fertilizePending: false }) },
        '@/api': { default: { get(_path, options) {
          const key = `${options.headers['x-account-id']}:${options.params.illustrated_type}`
          calls.push(['illustrated', key])
          return new Promise(resolve => completions.set(key, resolve))
        } } },
      }
      return modules[name] || {}
    },
  })
  return { ...exports.overview, account, ready, visibility, statusStore, watchers, cleanup, calls, completions }
}
function completeLevels(f, accountId, level) {
  for (const type of [1, 2])
    f.completions.get(`${accountId}:${type}`)({ data: { ok: true, data: { level } } })
}
test('personal overview coalesces requests and cannot show an old account illustrated response', async () => {
  const f = overviewFixture()
  const old = f.refresh(true)
  assert.equal(f.refresh(true), old)
  assert.equal(f.calls.filter(call => call[0] === 'bag').length, 1)
  f.account.currentAccountId.value = 'b'
  f.watchers.find(([source]) => source === f.account.currentAccountId)[1]('b', 'a')
  const current = f.refresh(true)
  completeLevels(f, 'b', 42)
  await current
  completeLevels(f, 'a', 3)
  await old
  assert.equal(f.illustratedLevels.value.crop, 42)
  assert.equal(f.illustratedLevels.value.mutant, 42)
})
test('personal overview skips resource calls while hidden, disconnected or unmounted', async () => {
  const f = overviewFixture()
  f.visibility.value = 'hidden'
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
  f.visibility.value = 'visible'
  f.statusStore.status.connection.connected = false
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
  f.statusStore.status.connection.connected = true
  f.cleanup[0]()
  await f.refresh(true)
  assert.equal(f.calls.length, 0)
})
test('normal overview polling throttles inventory reads and avoids repeated illustrated requests', async () => {
  const f = overviewFixture()
  const first = f.refresh(true)
  completeLevels(f, 'a', 8)
  await first
  await f.refresh()
  assert.equal(f.calls.filter(call => call[0] === 'bag').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'illustrated').length, 2)
})


test('single-land removal confirms, uses the existing API, and rejects a replaced crop', async () => {
  const f = panelFixture()
  const land = f.farm.lands.value[0]
  f.requestRemoveLand(land)
  assert.equal(f.pendingOperation.value.operation.type, 'remove')
  assert.equal(f.calls.length, 0)
  await f.executeOperation()
  assert.deepEqual(f.calls, [['remove', 'a', land.id]])
  f.requestRemoveLand(land)
  f.farm.lands.value[0] = { ...land, plantId: 999 }
  await f.executeOperation()
  assert.equal(f.calls.length, 1)
  f.requestRemoveLand(f.farm.lands.value[0])
  f.account.currentAccountId.value = 'b'
  await f.executeOperation()
  assert.equal(f.calls.length, 1)
})
test('only planted master lands expose removal for growing, mature and dead crops', () => {
  const { canRemoveLand } = loadModule('../src/utils/farm-land-actions.ts')
  for (const status of ['growing', 'harvestable', 'dead'])
    assert.equal(canRemoveLand({ ...growingLand, status }), true)
  for (const patch of [{ status: 'empty' }, { status: 'locked', unlocked: false }, { occupiedByMaster: true }, { plantId: 0 }])
    assert.equal(canRemoveLand({ ...growingLand, ...patch }), false)
})
test('single-land removal discards fertilizer overlays and reports server rejection', async () => {
  const f = storeFixture()
  f.setGet(async () => landResponse([growingLand]))
  await f.store.fetchLands('a')
  f.setPost(async () => ({ data: { ok: true, data: { success: true, updatedLand: { ...growingLand, matureInSec: 1000 } } } }))
  await f.store.applyFertilizer('a', growingLand.id, 'organic')
  f.setPost(async () => ({ data: { ok: false, error: 'remove rejected' } }))
  await assert.rejects(f.store.removePlant('a', growingLand.id), /remove rejected/)
  f.setPost(async () => ({ data: { ok: true } }))
  await f.store.removePlant('a', growingLand.id)
  assert.equal(f.store.lands.value[0].matureInSec, growingLand.matureInSec)
})
