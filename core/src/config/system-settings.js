const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
    organicFertilizerDelayMinMs: 200,
    organicFertilizerDelayMaxMs: 300
});
const MAX_FERTILIZER_DELAY_MS = 60000;

function validateSystemSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('系统设置格式无效');
    }
    const min = input.organicFertilizerDelayMinMs;
    const max = input.organicFertilizerDelayMaxMs;
    if (![min, max].every(value => Number.isInteger(value) && value >= 0 && value <= MAX_FERTILIZER_DELAY_MS)) {
        throw new Error('施肥间隔必须是 0～60000 毫秒的整数');
    }
    if (min > max) throw new Error('施肥间隔下限不能大于上限');
    return {
        organicFertilizerDelayMinMs: min,
        organicFertilizerDelayMaxMs: max
    };
}

function normalizeSystemSettings(input) {
    try {
        return validateSystemSettings(input);
    } catch {
        return { ...DEFAULT_SYSTEM_SETTINGS };
    }
}

module.exports = {
    DEFAULT_SYSTEM_SETTINGS,
    validateSystemSettings,
    normalizeSystemSettings
};
