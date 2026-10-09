const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-system-settings-'));
process.env.FARM_DATA_DIR = dataDir;
const store = require('../src/models/store');
const { DEFAULT_SYSTEM_SETTINGS, validateSystemSettings, normalizeSystemSettings } = require('../src/config/system-settings');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function config(min, max) {
    return { organicFertilizerDelayMinMs: min, organicFertilizerDelayMaxMs: max };
}

function loadModule(relative, mocks) {
    const filename = path.join(__dirname, relative);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, console, require: name => mocks[name] || localRequire(name)
    }, { filename });
    return module.exports;
}

test('legacy or invalid settings fall back to 200–300ms; zero and fixed delays are valid', () => {
    assert.deepEqual(store.getSystemSettings(), DEFAULT_SYSTEM_SETTINGS);
    for (const input of [undefined, null, [], {}, config(-1, 300), config(300, 200), config(0.5, 300), config('200', 300), config(200, Infinity), config(200, 60001)]) {
        assert.throws(() => validateSystemSettings(input));
        assert.deepEqual(normalizeSystemSettings(input), DEFAULT_SYSTEM_SETTINGS);
    }
    assert.deepEqual(validateSystemSettings(config(0, 0)), config(0, 0));
    assert.deepEqual(validateSystemSettings(config(60000, 60000)), config(60000, 60000));
});

test('global settings persist, survive reload and return defensive copies', () => {
    const expected = config(500, 800);
    const returned = store.setSystemSettings(expected);
    returned.organicFertilizerDelayMinMs = 1;
    assert.deepEqual(store.getSystemSettings(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8')).systemSettings, expected);
    const reloaded = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(require.resolve('../src/models/store'))}).getSystemSettings()))`], {
        env: { ...process.env, FARM_DATA_DIR: dataDir }, encoding: 'utf8'
    });
    assert.equal(reloaded.status, 0, reloaded.stderr);
    assert.deepEqual(JSON.parse(reloaded.stdout), expected);
    assert.throws(() => store.setSystemSettings(config(900, 500)));
    assert.deepEqual(store.getSystemSettings(), expected);
});

test('failed persistence rolls back the in-memory settings', () => {
    const previous = store.getSystemSettings();
    const file = path.join(dataDir, 'store.json');
    const backup = path.join(dataDir, 'store.backup');
    fs.renameSync(file, backup);
    fs.mkdirSync(file);
    try {
        assert.throws(() => store.setSystemSettings(config(1000, 2000)));
        assert.deepEqual(store.getSystemSettings(), previous);
    } finally {
        fs.rmdirSync(file);
        fs.renameSync(backup, file);
    }
});

test('worker snapshots include global settings and apply them without disk writes; account saves cannot override them', () => {
    const { createRuntimeState } = loadModule('../src/runtime/runtime-state.js', {
        '../services/logger': { createModuleLogger: () => ({ info() {}, warn() {}, error() {} }) },
        '../services/stats': {}
    });
    store.setSystemSettings(config(700, 900));
    const state = createRuntimeState({ store });
    const snapshot = state.buildConfigSnapshotForAccount('fixture-account');
    assert.deepEqual(snapshot.systemSettings, config(700, 900));
    const file = path.join(dataDir, 'store.json');
    const before = fs.readFileSync(file, 'utf8');
    store.applyConfigSnapshot({ ...snapshot, systemSettings: config(1000, 1500) }, { persist: false, accountId: 'fixture-account' });
    assert.deepEqual(store.getSystemSettings(), config(1000, 1500));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    store.applyConfigSnapshot({ systemSettings: config(0, 0) }, { accountId: 'fixture-account' });
    assert.deepEqual(store.getSystemSettings(), config(1000, 1500));
});

test('saving via the provider advances the revision and broadcasts to all workers only after persistence', async () => {
    const { createDataProvider } = loadModule('../src/runtime/data-provider.js', {
        '../services/scheduler': { getSchedulerRegistrySnapshot: () => [] }
    });
    const events = [];
    const provider = createDataProvider({
        store: { setSystemSettings: value => { events.push('persist'); return value; } },
        nextConfigRevision: () => events.push('revision'),
        broadcastConfigToWorkers: id => events.push(['broadcast', id])
    });
    assert.deepEqual(await provider.saveSystemSettings(config(200, 400)), config(200, 400));
    assert.deepEqual(events, ['persist', 'revision', ['broadcast', undefined]]);
    const failed = createDataProvider({
        store: { setSystemSettings: () => { throw new Error('fixture write failure'); } },
        nextConfigRevision: () => assert.fail('must not advance'),
        broadcastConfigToWorkers: () => assert.fail('must not broadcast')
    });
    await assert.rejects(failed.saveSystemSettings(config(200, 400)), /fixture write failure/);
});

test('organic loop reads updated intervals every iteration, retains round-robin ordering and stops on failure', async () => {
    store.setSystemSettings(config(200, 300));
    const delays = [];
    const lands = [];
    const fertilizer = loadModule('../src/services/farm-fertilizer.js', {
        '../utils/network': { sendMsgAsync: async (_service, _method, payload) => {
            lands.push(payload.land_ids[0]);
            if (lands.length === 4) throw new Error('fixture depleted');
            return {};
        } },
        '../utils/proto': { types: { FertilizeRequest: {
            create: value => value, encode: value => ({ finish: () => value })
        } } },
        '../models/store': { getAutomation: () => ({ fertilizer: 'organic' }), getSystemSettings: store.getSystemSettings },
        '../utils/utils': {
            toNum: Number, log() {}, logWarn() {},
            randomDelay: async (min, max) => {
                delays.push([min, max]);
                store.applyConfigSnapshot({ systemSettings: config(700, 900) }, { persist: false });
            }
        },
        './farm-land-analyzer': { getCurrentPhase: () => ({ phase: 2 }) },
        './farm-api': {
            NORMAL_FERTILIZER_ID: 1011, ORGANIC_FERTILIZER_ID: 1012,
            fertilizeOne: async (landId, fertilizerId) => {
                assert.equal(fertilizerId, 1012);
                lands.push(landId);
                if (lands.length === 4) throw new Error('fixture depleted');
                return {};
            },
            getAllLands: async () => ({ lands: [1, 2].map(id => ({
                id, unlocked: true, level: 1, plant: { phases: [{}] }
            })) })
        },
        './stats': { recordOperation() {} }
    });
    const result = await fertilizer.runFertilizerByConfig([1, 2]);
    assert.equal(result.organic, 3);
    assert.deepEqual(lands, [1, 2, 1, 2]);
    assert.deepEqual(delays, [[200, 300], [700, 900], [700, 900]]);
});

test('system settings endpoints require admin middleware, reject invalid ranges and surface persistence errors', async () => {
    const { registerAdminSystemRoutes } = require('../src/controllers/admin-system-routes');
    const routes = new Map();
    let saves = 0;
    let fail = false;
    const token = (_req, _res, next) => next();
    const role = (req, res, next) => req.currentUser?.role === 'admin'
        ? next() : res.status(403).json({ ok: false });
    registerAdminSystemRoutes({
        app: {
            get: (url, ...handlers) => routes.set(`GET ${url}`, handlers),
            post: (url, ...handlers) => routes.set(`POST ${url}`, handlers)
        },
        store,
        provider: { saveSystemSettings: async value => {
            saves++;
            if (fail) throw new Error('fixture persistence failure');
            return store.setSystemSettings(value);
        } },
        requireAdminToken: token, requireAdminRole: role
    });
    async function invoke(method, body, isAdmin = true) {
        const handlers = routes.get(`${method} /api/admin/system-settings`);
        assert.equal(handlers[0], token);
        assert.equal(handlers[1], role);
        const req = { body, currentUser: { role: isAdmin ? 'admin' : 'user' } };
        const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
        let index = 0;
        const next = () => handlers[index++]?.(req, res, next);
        await next();
        return res;
    }
    assert.equal((await invoke('POST', config(200, 300), false)).code, 403);
    assert.equal((await invoke('GET', undefined, false)).code, 403);
    for (const input of [null, {}, config(-1, 300), config(300, 200), config(200, 300.1), config(200, 60001)]) {
        assert.equal((await invoke('POST', input)).code, 400);
    }
    assert.equal(saves, 0);
    const saved = await invoke('POST', config(0, 0));
    assert.equal(saved.body.ok, true);
    assert.deepEqual(saved.body.data, config(0, 0));
    assert.deepEqual((await invoke('GET')).body.data, config(0, 0));
    fail = true;
    assert.equal((await invoke('POST', config(200, 300))).code, 500);
});
