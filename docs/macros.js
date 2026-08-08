// Pure helpers — no DOM, no network. Shared by script.js (browser global) and macros.test.js (node).

function num(v) {
    return Number(v) || 0;
}

const MACRO_KEYS = ['carbs', 'protein', 'fat', 'fiber', 'sodium', 'iron', 'calories'];

function sumMacros(entries) {
    return (entries || []).reduce((acc, entry) => {
        const m = (entry && entry.macros) || {};
        MACRO_KEYS.forEach((k) => { acc[k] += num(m[k]); });
        return acc;
    }, Object.fromEntries(MACRO_KEYS.map((k) => [k, 0])));
}

// YYYY-MM-DD for a Date (local time, not UTC — the day boundary should match the user's).
function dateKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The n date keys ending at (and including) `endKey`, oldest first. Pure string/Date math.
function lastDays(endKey, n) {
    const [y, m, d] = endKey.split('-').map(Number);
    const end = new Date(y, m - 1, d);
    const keys = [];
    for (let i = n - 1; i >= 0; i--) {
        const dt = new Date(end);
        dt.setDate(end.getDate() - i);
        keys.push(dateKey(dt));
    }
    return keys;
}

// The 7 date keys ending at (and including) `endKey`, oldest first.
function weekKeys(endKey) { return lastDays(endKey, 7); }

// Scale every macro by a portion factor (1 = unchanged), rounded to 0.1.
function scaleMacros(macros, factor) {
    const m = macros || {};
    const out = {};
    MACRO_KEYS.forEach((k) => { out[k] = Math.round(num(m[k]) * factor * 10) / 10; });
    return out;
}

// A portion label appends "(×N)" for anything but 1×. These two are inverses.
function portionLabel(food, factor) {
    return factor === 1 ? food : `${food} (×${factor})`;
}
// "eggs (×2)" -> {name:'eggs', factor:2}; a plain name -> {name, factor:1}.
function parsePortion(food) {
    const m = /^(.*) \(×([0-9.]+)\)$/.exec(food || '');
    return m && Number(m[2]) > 0 ? { name: m[1], factor: Number(m[2]) } : { name: food || '', factor: 1 };
}

// Re-scale an entry to a new portion multiplier without re-estimating. The 1× base is
// recovered from the current (labeled) macros, so this works on entries added before it existed.
// ponytail: base = macros / current factor — sub-0.1g rounding drift per edit, fine for a family tracker.
function adjustEntry(entry, factor) {
    const { name, factor: cur } = parsePortion(entry.food);
    const base = scaleMacros(entry.macros, 1 / cur);
    return { ...entry, food: portionLabel(name, factor), macros: scaleMacros(base, factor) };
}

// Week averages over LOGGED days (days with ≥1 entry) — averaging over empty days is misleading.
// Returns { avg:{macro:...}, logged, days:7 }.
function weekStats(days, endKey) {
    const keys = weekKeys(endKey);
    const logged = keys.filter((k) => (((days[k] || {}).entries) || []).length > 0).length;
    const total = sumWeek(days, endKey);
    const avg = {};
    MACRO_KEYS.forEach((k) => { avg[k] = logged ? total[k] / logged : 0; });
    return { avg, logged, days: 7 };
}

// Consecutive logged days ending at endKey. Grace: an unlogged "today" doesn't break the streak
// (count from yesterday), so the number only drops once you actually miss a full day.
function streak(days, endKey) {
    const isLogged = (k) => (((days[k] || {}).entries) || []).length > 0;
    const [y, m, d] = endKey.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    if (!isLogged(dateKey(cur))) cur.setDate(cur.getDate() - 1);
    let n = 0;
    while (isLogged(dateKey(cur))) { n++; cur.setDate(cur.getDate() - 1); }
    return n;
}

// Sum a week of days. `days` is {dateKey: {entries:[...]}}. Returns combined macro totals.
function sumWeek(days, endKey) {
    return weekKeys(endKey).reduce((acc, k) => {
        const t = sumMacros((days[k] || {}).entries);
        MACRO_KEYS.forEach((key) => { acc[key] += t[key]; });
        return acc;
    }, Object.fromEntries(MACRO_KEYS.map((k) => [k, 0])));
}

// Percent of goal, clamped 0..100 for a progress bar. goal<=0 -> 0 (no goal set).
function pct(value, goal) {
    if (!goal || goal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((num(value) / goal) * 100)));
}

// ---- bar coloring -----------------------------------------------------------
// Independent-goal color intent (green = on target). Protein/fiber: green once at/over
// goal (more is fine). Others: green within ±10% of goal, red when >10% over. Under-target
// stays neutral. Carbs/fat DON'T use this directly — they go through energyBalance (below),
// which treats them as one shared caloric pool.
const MORE_IS_GOOD = new Set(['protein', 'fiber']);
function barState(key, value, goal) {
    if (goal <= 0) return '';
    const v = num(value);
    if (MORE_IS_GOOD.has(key)) return v >= goal * 0.9 ? 'good' : '';
    if (v >= goal * 0.9 && v <= goal * 1.1) return 'good';
    if (v > goal * 1.1) return 'over';
    return '';
}

// Carbs and fat are interchangeable energy: 4 cal/g and 9 cal/g. Being over one while
// under the other by the same calories is a SWAP, not an overage — so we judge them as a
// single caloric pool instead of two independent limits.
const CAL_PER_G = { carbs: 4, fat: 9 };

// Returns { carbs:{state, spillCal, partner}, fat:{...} }. State is:
//   'over'  — the COMBINED carb+fat calories exceed the combined goal by >10% (real overage);
//             the individual macro(s) that are over their own grams get flagged.
//   'spill' — this macro is over its own grams, but the pool is still on target because the
//             partner is under: it borrowed spillCal calories from the partner (not bad).
//   'good'  — the pool is balanced (±10%), so this macro is fine even if individually under.
//   ''      — under target with no borrowing, or a goal is unset (falls back to independent).
function energyBalance(totals, goals) {
    const g = goals || {}, t = totals || {};
    const cGoal = num(g.carbs), fGoal = num(g.fat);
    const cVal = num(t.carbs), fVal = num(t.fat);
    const out = {
        carbs: { state: barState('carbs', cVal, cGoal), spillCal: 0, partner: 'fat' },
        fat: { state: barState('fat', fVal, fGoal), spillCal: 0, partner: 'carbs' },
    };
    // Need both goals set to treat them as a shared pool; otherwise keep the independent states.
    if (cGoal <= 0 || fGoal <= 0) return out;

    const poolGoal = cGoal * CAL_PER_G.carbs + fGoal * CAL_PER_G.fat;
    const poolVal = cVal * CAL_PER_G.carbs + fVal * CAL_PER_G.fat;
    const poolOver = poolVal > poolGoal * 1.1;
    const poolGood = poolVal >= poolGoal * 0.9 && poolVal <= poolGoal * 1.1;

    [['carbs', cVal, cGoal], ['fat', fVal, fGoal]].forEach(([key, val, goal]) => {
        const overGrams = val - goal;
        if (overGrams > goal * 0.1) {                 // individually over its own grams (>10%)
            if (poolOver) {
                out[key].state = 'over';              // pool genuinely over -> a real overage
            } else {
                out[key].state = 'spill';             // compensated by the partner's headroom
                out[key].spillCal = Math.round(overGrams * CAL_PER_G[key]);
            }
        } else if (poolGood) {
            out[key].state = 'good';                  // pool balanced -> this macro is fine even if under
        }
    });
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { num, sumMacros, dateKey, weekKeys, lastDays, sumWeek, scaleMacros, portionLabel, parsePortion, adjustEntry, weekStats, streak, pct, MACRO_KEYS, MORE_IS_GOOD, barState, energyBalance, CAL_PER_G };
}
