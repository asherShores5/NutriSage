const API_URL = 'https://q8f8dfzb0j.execute-api.us-east-1.amazonaws.com';
const PROFILES = ['asher', 'aubyn', 'tommy']; // add a family member here + a hash in the Lambda's USER_SECRETS
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']; // entry.meal buckets; order = display order

// ---- guest mode -------------------------------------------------------------
// A no-key, local-only profile so anyone can view + test the app. It never calls
// the authed /pull|/push (those would 401); its data lives in `nutri:guest` and
// sync is a no-op. The only server call a guest makes is the public macro endpoint,
// so we cap it: GUEST_DAILY_LOOKUPS Bedrock lookups per day, tracked locally. This
// sits on top of the API's global throttle (5 req/s) + budget tripwire — a soft,
// bypassable UX guard, not the real cost gate.
const GUEST = 'guest';
const GUEST_DAILY_LOOKUPS = 20;

const el = (id) => document.getElementById(id);

// ---- device keyring ---------------------------------------------------------
// Every profile authenticated on THIS device is remembered here, so switching
// profiles never re-asks for a key. Shape: { user: secret }.
function keyring() {
    try { return JSON.parse(localStorage.getItem('nutri:keys')) || {}; } catch { return {}; }
}
function rememberKey(user, secret) {
    const ks = keyring(); ks[user] = secret;
    localStorage.setItem('nutri:keys', JSON.stringify(ks));
}
function forgetKey(user) {
    const ks = keyring(); delete ks[user];
    localStorage.setItem('nutri:keys', JSON.stringify(ks));
}

// ---- session + per-user local cache ----------------------------------------
let session = null;                       // { user, secret } — secret is null for the guest
let selectedDate = dateKey(new Date());

function isGuest() { return session && session.user === GUEST; }

// Guest lookup quota: {date, count}. Resets each local day. Returns remaining lookups.
function guestLookupsLeft() {
    let q;
    try { q = JSON.parse(localStorage.getItem('nutri:guestQuota')) || {}; } catch { q = {}; }
    const today = dateKey(new Date());
    if (q.date !== today) return GUEST_DAILY_LOOKUPS;   // fresh day, untouched
    return Math.max(0, GUEST_DAILY_LOOKUPS - num(q.count));
}
function useGuestLookup() {
    const today = dateKey(new Date());
    let q;
    try { q = JSON.parse(localStorage.getItem('nutri:guestQuota')) || {}; } catch { q = {}; }
    const count = q.date === today ? num(q.count) + 1 : 1;
    localStorage.setItem('nutri:guestQuota', JSON.stringify({ date: today, count }));
}

function cacheKey() { return `nutri:${session.user}`; }
function loadCache() {
    try { return JSON.parse(localStorage.getItem(cacheKey())) || { days: {}, goals: {}, meals: [], favorites: [] }; }
    catch { return { days: {}, goals: {}, meals: [], favorites: [] }; }
}
function saveCache(state) { localStorage.setItem(cacheKey(), JSON.stringify(state)); }

// ---- server sync ------------------------------------------------------------
async function api(path, payload) {
    const resp = await fetch(API_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`${path} ${resp.status}`);
    return resp.json();
}
async function pull() {
    if (isGuest()) return loadCache();     // local-only; guest has no secret to authenticate a /pull
    const data = await api('/pull', { user: session.user, secret: session.secret });
    saveCache(data);
    return data;
}
async function pushItem(item) {
    if (isGuest()) return true;            // local-only; never write guest scratch data to the server
    try { await api('/push', { user: session.user, secret: session.secret, item }); return true; }
    catch (e) { console.error('sync failed', e); return false; } // local already saved; offline-ok
}

// ---- login / keyring boot ---------------------------------------------------
function initLogin() {
    applyTheme(localStorage.getItem('nutri:theme') || 'system');
    renderProfilePicker();

    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await attemptLogin(el('loginForm').dataset.user, el('secretInput').value.trim(), true);
    });
    el('loginBack').addEventListener('click', () => {
        el('loginForm').hidden = true;
        el('profilePicker').hidden = false;
        setText('loginStatus', '');
    });

    // Auto-resume: last active profile whose key is on this device (or the guest).
    const active = localStorage.getItem('nutri:active');
    const ks = keyring();
    if (active === GUEST) enterGuest();
    else if (active && ks[active]) attemptLogin(active, ks[active], false);
}

function renderProfilePicker() {
    const picker = el('profilePicker');
    picker.replaceChildren();
    const ks = keyring();
    PROFILES.forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'profile-btn';
        btn.textContent = ks[name] ? name : `${name} 🔑`; // 🔑 = will ask for key
        btn.title = ks[name] ? 'Signed-in on this device' : 'First sign-in on this device';
        btn.addEventListener('click', () => {
            if (ks[name]) attemptLogin(name, ks[name], false);
            else showSecretForm(name);
        });
        picker.appendChild(btn);
    });

    // Guest: no key, local-only, throttled. Anyone can look around + test the app.
    const guest = document.createElement('button');
    guest.type = 'button';
    guest.className = 'profile-btn guest-btn';
    guest.textContent = 'Guest 👋';
    guest.title = 'Explore the app with sample data — no key needed, saved only on this device';
    guest.addEventListener('click', enterGuest);
    picker.appendChild(guest);
}

// Enter guest mode: no server auth, local-only session. Seeds demo data on first
// visit so the charts/week/trends aren't empty for someone just testing the app.
function enterGuest() {
    session = { user: GUEST, secret: null };
    seedGuestDataIfEmpty();
    localStorage.setItem('nutri:active', GUEST);
    startApp();
}

// Populate the guest cache with a few logged days so a first-time visitor lands on a
// filled-in app (progress bars, a streak, a trend line) instead of a blank slate. Only
// runs when the guest has no data yet — a returning guest keeps whatever they added.
function seedGuestDataIfEmpty() {
    const existing = loadCache();
    if (Object.keys(existing.days || {}).length) return;

    const mk = (food, macros, meal) => ({ food, macros, meal });
    const menu = [
        mk('2 eggs and toast', { carbs: 30, protein: 18, fat: 14, fiber: 3, sodium: 380, iron: 2.5, calories: 330 }, 'breakfast'),
        mk('Greek yogurt with berries', { carbs: 22, protein: 15, fat: 4, fiber: 3, sodium: 65, iron: 0.4, calories: 190 }, 'breakfast'),
        mk('Grilled chicken salad', { carbs: 18, protein: 38, fat: 16, fiber: 6, sodium: 620, iron: 2.1, calories: 380 }, 'lunch'),
        mk('Turkey sandwich', { carbs: 42, protein: 28, fat: 12, fiber: 5, sodium: 890, iron: 3.0, calories: 400 }, 'lunch'),
        mk('Salmon with rice and broccoli', { carbs: 45, protein: 34, fat: 18, fiber: 6, sodium: 470, iron: 1.8, calories: 500 }, 'dinner'),
        mk('Spaghetti with meat sauce', { carbs: 62, protein: 26, fat: 20, fiber: 7, sodium: 720, iron: 4.2, calories: 560 }, 'dinner'),
        mk('Apple', { carbs: 25, protein: 0, fat: 0, fiber: 4, sodium: 2, iron: 0.2, calories: 95 }, 'snack'),
        mk('Handful of almonds', { carbs: 6, protein: 6, fat: 14, fiber: 3, sodium: 0, iron: 1.1, calories: 165 }, 'snack'),
    ];

    const days = {};
    const keys = lastDays(dateKey(new Date()), 10);
    keys.forEach((k, i) => {
        if (i % 4 === 3) return;                          // skip ~1 in 4 days for a realistic gap
        const entries = [menu[i % menu.length], menu[(i + 2) % menu.length], menu[(i + 5) % menu.length]];
        days[k] = { entries, water: 4 + (i % 5), weight: 165 - i * 0.2, updatedAt: `${k}T12:00:00.000Z` };
    });

    saveCache({
        days,
        goals: { carbs: 220, protein: 130, fat: 70, fiber: 30, sodium: 2300, iron: 18, calories: 2000, waterGoal: 8 },
        meals: [menu[0], menu[2], menu[4], menu[6]].map((m) => ({ name: m.food, macros: m.macros })),
    });
}

async function attemptLogin(user, secret, fromForm) {
    if (!secret) return;
    setText('loginStatus', 'Signing in…');
    session = { user, secret };
    try {
        await pull();                       // validates the key (401 throws)
        rememberKey(user, secret);          // keyring: never ask again on this device
        localStorage.setItem('nutri:active', user);
        startApp();
    } catch {
        session = null;
        if (fromForm) { setText('loginStatus', 'Wrong access key. Try again.', true); }
        else { forgetKey(user); renderProfilePicker(); setText('loginStatus', 'Saved key was invalid — enter it again.', true); }
    }
}

function showSecretForm(name) {
    el('profilePicker').hidden = true;
    const form = el('loginForm');
    form.hidden = false;
    form.dataset.user = name;
    setText('loginName', `Signing in as ${name}`);
    el('secretInput').value = '';
    el('secretInput').focus();
}

// ---- app boot ---------------------------------------------------------------
function startApp() {
    el('loginSection').hidden = true;
    el('appSection').hidden = false;
    const who = el('whoami');
    who.hidden = false;
    who.textContent = isGuest() ? 'Guest' : session.user;
    who.title = 'Go to profile';
    who.onclick = () => switchTab('profile');

    el('guestBanner').hidden = !isGuest();
    renderGuestQuota();

    el('dateInput').value = selectedDate;
    wireAppEvents();
    render();
}

// Show the guest's remaining daily AI lookups in the add-food area (hidden for signed-in users).
function renderGuestQuota() {
    const note = el('guestQuota');
    if (!note) return;
    if (!isGuest()) { note.hidden = true; return; }
    const left = guestLookupsLeft();
    note.hidden = false;
    note.textContent = `Guest mode · ${left} of ${GUEST_DAILY_LOOKUPS} AI lookups left today · Quick add is unlimited`;
}

let eventsWired = false;
function wireAppEvents() {
    if (eventsWired) return;              // survive profile switches (startApp re-runs)
    eventsWired = true;
    el('foodForm').addEventListener('submit', (e) => { e.preventDefault(); addFood(); });
    el('clearButton').addEventListener('click', clearDay);
    el('prevDay').addEventListener('click', () => shiftDay(-1));
    el('nextDay').addEventListener('click', () => shiftDay(1));
    el('todayBtn').addEventListener('click', () => { selectedDate = dateKey(new Date()); el('dateInput').value = selectedDate; render(); });
    el('dateInput').addEventListener('change', (e) => { if (e.target.value) { selectedDate = e.target.value; render(); } });
    el('goalsForm').addEventListener('submit', (e) => { e.preventDefault(); saveGoals(); });
    el('themeSelect').addEventListener('change', (e) => { applyTheme(e.target.value); localStorage.setItem('nutri:theme', e.target.value); });
    el('exportBtn').addEventListener('click', exportData);
    el('leaveGuestBtn').addEventListener('click', leaveGuest);
    el('refreshBtn').addEventListener('click', async () => { setText('goalsStatus', ''); await pull(); render(); });
    el('waterPlus').addEventListener('click', () => setWater(currentWater() + 1));
    el('waterMinus').addEventListener('click', () => setWater(currentWater() - 1));
    el('waterGoal').addEventListener('change', () => { setGoal('waterGoal', num(el('waterGoal').value)); render(); });
    el('weightForm').addEventListener('submit', (e) => { e.preventDefault(); setWeight(num(el('weightInput').value)); });
    el('weightClear').addEventListener('click', () => setWeight(0));
    el('trendMetric').addEventListener('change', renderTrends);
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}

// ---- tabs -------------------------------------------------------------------
function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'profile') renderProfileTab();
    if (name === 'trends') renderTrends();
    window.scrollTo(0, 0);
}

function shiftDay(delta) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    selectedDate = dateKey(dt);
    el('dateInput').value = selectedDate;
    render();
}

// ---- day data ---------------------------------------------------------------
// A day is { entries:[...], water:<cups>, weight:<number>, updatedAt }. Each field is edited
// independently, so every writer preserves the others on the day.
function currentDay() { return loadCache().days[selectedDate] || {}; }
function currentEntries() { return currentDay().entries || []; }
function currentWater() { return num(currentDay().water); }
function currentWeight() { return num(currentDay().weight); }

function writeDay(patch) {
    const state = loadCache();
    const day = { entries: [], ...(state.days[selectedDate] || {}), ...patch, updatedAt: new Date().toISOString() };
    state.days[selectedDate] = day;
    saveCache(state);
    pushItem({ type: 'day', date: selectedDate, entries: day.entries, water: day.water, weight: day.weight, updatedAt: day.updatedAt });
}
function setDayEntries(entries) { writeDay({ entries }); }
function setWater(cups) { writeDay({ water: Math.max(0, cups) }); render(); }
function setWeight(w) { writeDay({ weight: Math.max(0, w) }); render(); }

// ---- food entry -------------------------------------------------------------
async function addFood() {
    const foodItem = el('foodInput').value.trim();
    if (!foodItem) return;
    el('addButton').disabled = true;
    setText('status', 'Fetching macros…');
    try {
        const base = await getMacroData(foodItem);       // per-portion macros as described
        const factor = portionFactor();
        addEntry({ food: portionLabel(foodItem, factor), macros: scaleMacros(base, factor), meal: el('mealSelect').value });
        el('foodInput').value = '';
        el('portionInput').value = 1;                     // reset to default 1 after each add
        setText('status', '');
        rememberFavorite(foodItem, base);                 // library stores the 1× base
        if (isGuest()) renderGuestQuota();
    } catch (error) {
        console.error('Error fetching macro data:', error);
        const msg = error instanceof GuestLimitError
            ? error.message
            : 'Could not fetch macros. Check your connection and try again.';
        setText('status', msg, true);
    } finally {
        el('addButton').disabled = false;
    }
}

async function getMacroData(foodItem) {
    // Guests get a throttled number of AI lookups per day (the Bedrock call is the cost
    // lever). Quick-add from the cached library and all local edits stay unlimited.
    if (isGuest()) {
        if (guestLookupsLeft() <= 0) {
            throw new GuestLimitError(`Guest AI lookups are capped at ${GUEST_DAILY_LOOKUPS}/day. Sign in for unlimited, or use Quick add.`);
        }
        useGuestLookup();
    }
    const resp = await fetch(API_URL + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foodItem }),
    });
    if (!resp.ok) throw new Error(`API request failed: ${resp.status}`);
    return resp.json();
}

// Distinct error so the UI can show the friendly quota message verbatim (vs. a generic
// network failure). Thrown before the fetch, so no lookup is consumed when we bail.
class GuestLimitError extends Error {}

// Portion multiplier (defaults to 1 = "as described"). Clamped to a sane range.
// portionLabel lives in macros.js (shared + tested).
function clampFactor(v) { const f = num(v); return f > 0 ? Math.min(f, 20) : 1; }
function portionFactor() { return clampFactor(el('portionInput').value); }

function addEntry(entry) {
    const entries = currentEntries();
    entries.push(entry);
    setDayEntries(entries);
    render();
}
function removeEntry(index) {
    const entries = currentEntries();
    entries.splice(index, 1);
    setDayEntries(entries);
    render();
}

// Edit a row in place. Renaming re-estimates (the food changed); only changing the
// multiplier re-scales locally — no Bedrock call, since the 1× base is already known.
async function saveEdit(index, newName, factor, statusNode) {
    newName = newName.trim();
    if (!newName) return;
    const entries = currentEntries();
    const entry = entries[index];
    const orig = parsePortion(entry.food);
    if (newName.toLowerCase() === orig.name.toLowerCase()) {   // same food, just re-portion
        entries[index] = adjustEntry(entry, factor);
        setDayEntries(entries);
        render();
        return;
    }
    statusNode.textContent = 'Updating…';                      // renamed — re-estimate the 1× base
    try {
        const base = await getMacroData(newName);
        entries[index] = { food: portionLabel(newName, factor), macros: scaleMacros(base, factor), meal: entry.meal };
        setDayEntries(entries);
        rememberFavorite(newName, base);   // keep quick-add in sync
        if (isGuest()) renderGuestQuota();
        render();
    } catch (error) {
        statusNode.textContent = error instanceof GuestLimitError ? error.message : 'Could not update. Try again.';
        statusNode.className = 'status error';
    }
}

function clearDay() {
    if (!currentEntries().length) return;
    if (!confirm(`Clear all entries for ${selectedDate}? This can't be undone.`)) return;
    setDayEntries([]);
    render();
}

// ---- favorites / shared meal library ---------------------------------------
function rememberFavorite(food, macros) {
    const state = loadCache();
    const meals = state.meals || [];
    const key = food.toLowerCase();
    const existing = meals.findIndex((m) => m.name.toLowerCase() === key);
    if (existing >= 0) meals[existing] = { name: food, macros };  // refresh macros on edit
    else meals.unshift({ name: food, macros });
    state.meals = meals.slice(0, 20); // ponytail: cap at 20; add search if it grows past that
    saveCache(state);
    pushItem({ type: 'meals', library: state.meals });
}

// ---- favorites (per-user, permanent until removed) --------------------------
// Like quick-add, but never auto-evicted. Stores the 1× base macros, so re-adding
// scales locally instead of re-querying Bedrock. Keyed by lowercased name.
function isFavorite(name) {
    const key = name.toLowerCase();
    return (loadCache().favorites || []).some((f) => f.name.toLowerCase() === key);
}
function addFavorite(name, baseMacros) {
    const state = loadCache();
    const favs = state.favorites || [];
    const key = name.toLowerCase();
    const at = favs.findIndex((f) => f.name.toLowerCase() === key);
    if (at >= 0) favs[at] = { name, macros: baseMacros }; else favs.unshift({ name, macros: baseMacros });
    state.favorites = favs;
    saveCache(state);
    pushItem({ type: 'favorites', favorites: state.favorites });
}
function removeFavorite(name) {
    const state = loadCache();
    const key = name.toLowerCase();
    state.favorites = (state.favorites || []).filter((f) => f.name.toLowerCase() !== key);
    saveCache(state);
    pushItem({ type: 'favorites', favorites: state.favorites });
}
// Star toggle on an entry: save/remove its 1× base (recovered from the labeled portion).
function toggleFavorite(entry) {
    const { name, factor } = parsePortion(entry.food);
    if (isFavorite(name)) removeFavorite(name);
    else addFavorite(name, scaleMacros(entry.macros, 1 / factor));
    render();
}

// ---- goals ------------------------------------------------------------------
function saveGoals() {
    const state = loadCache();
    const goals = {
        ...state.goals,                          // keep non-form goals (e.g. waterGoal)
        carbs: num(el('goalCarbs').value),
        protein: num(el('goalProtein').value),
        fat: num(el('goalFat').value),
        fiber: num(el('goalFiber').value),
        sodium: num(el('goalSodium').value),
        iron: num(el('goalIron').value),
        calories: num(el('goalCalories').value),
    };
    state.goals = goals;
    saveCache(state);
    pushItem({ type: 'goals', goals });
    setText('goalsStatus', 'Goals saved.');
    render();
}

// Set a single goal key (used by the water goal control) and sync.
function setGoal(key, value) {
    const state = loadCache();
    state.goals = { ...state.goals, [key]: value };
    saveCache(state);
    pushItem({ type: 'goals', goals: state.goals });
}

// ---- profile tab ------------------------------------------------------------
function renderProfileTab() {
    el('profileName').textContent = isGuest() ? 'Guest' : session.user;
    el('themeSelect').value = localStorage.getItem('nutri:theme') || 'system';
    el('guestProfileNote').hidden = !isGuest();

    // switch-profile buttons (only profiles with a saved key = one tap)
    const sw = el('switchList');
    sw.replaceChildren();
    const ks = keyring();
    PROFILES.forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'profile-btn' + (name === session.user ? ' active' : '');
        btn.textContent = ks[name] ? name : `${name} 🔑`;
        btn.disabled = name === session.user;
        btn.addEventListener('click', () => {
            if (ks[name]) { attemptLogin(name, ks[name], false); switchTab('today'); }
            else { el('appSection').hidden = true; el('loginSection').hidden = false; showSecretForm(name); }
        });
        sw.appendChild(btn);
    });

    // per-device saved keys with "forget" (data control)
    const list = el('keyList');
    list.replaceChildren();
    Object.keys(ks).forEach((name) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'row keyrow';
        const label = document.createElement('span');
        label.textContent = `${name} — key saved`;
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'ghost danger';
        forget.textContent = name === session.user ? 'Sign out' : 'Forget key';
        forget.addEventListener('click', () => {
            if (!confirm(`Remove ${name}'s saved key and cached data from THIS device? Server data is untouched; you'll re-enter the key next time.`)) return;
            forgetKey(name);
            localStorage.removeItem(`nutri:${name}`);
            if (name === session.user) {
                localStorage.removeItem('nutri:active');
                location.reload();
            } else { renderProfileTab(); }
        });
        rowEl.append(label, forget);
        list.appendChild(rowEl);
    });
}

// Leave guest mode: wipe the local scratch data (it was never on the server) and return
// to the profile picker. A signed-in user uses "Sign out" in the key list instead.
function leaveGuest() {
    if (!confirm('Exit guest mode? Sample and test data on this device will be cleared.')) return;
    localStorage.removeItem('nutri:guest');
    localStorage.removeItem('nutri:guestQuota');
    localStorage.removeItem('nutri:active');
    location.reload();
}

function exportData() {
    const blob = new Blob([JSON.stringify(loadCache(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nutrisage-${session.user}-${dateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---- theme ------------------------------------------------------------------
function applyTheme(mode) {
    // 'system' -> let CSS media query decide; else force via data-theme
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
}

// ---- rendering (all textContent/createElement — never innerHTML) ------------
function render() {
    const state = loadCache();
    const entries = (state.days[selectedDate] || {}).entries || [];
    renderEntries(entries);
    renderProgress(sumMacros(entries), state.goals);
    renderWater(state.goals);
    renderWeight();
    renderWeek(state.days, state.goals);
    renderFavoritesMenu(state.favorites || []);
    renderFavorites(state.meals || []);
    renderGoalInputs(state.goals);
    if (!el('tab-trends').hidden) renderTrends();
}

function renderEntries(entries) {
    const list = el('entries');
    list.replaceChildren();
    if (!entries.length) {
        const li = document.createElement('li');
        li.className = 'muted empty';
        li.textContent = 'No entries yet. Add a food above.';
        list.appendChild(li);
        return;
    }
    // Group by meal, preserving each entry's original index (edit/remove need it).
    // Legacy entries with no `meal` fall into snack.
    MEALS.forEach((meal) => {
        const rows = entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => (entry.meal || 'snack') === meal);
        if (!rows.length) return;
        const header = document.createElement('li');
        header.className = 'meal-header';
        const title = document.createElement('span');
        title.textContent = meal[0].toUpperCase() + meal.slice(1);
        const cals = document.createElement('span');
        cals.className = 'meal-cals';
        cals.textContent = `${Math.round(sumMacros(rows.map((r) => r.entry)).calories)} cal`;
        header.append(title, cals);
        list.appendChild(header);
        rows.forEach(({ entry, index }) => list.appendChild(entryRow(entry, index)));
    });
}

function entryRow(entry, index) {
    const m = entry.macros || {};
    const li = document.createElement('li');
    li.className = 'entry';

    const main = document.createElement('div');
    main.className = 'entry-main';
    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = entry.food;
    const macros = document.createElement('span');
    macros.className = 'entry-macros';
    macros.textContent = `${num(m.calories)} cal · ${num(m.carbs)}c / ${num(m.protein)}p / ${num(m.fat)}f · ${num(m.fiber)}g fiber`;
    const micros = document.createElement('span');
    micros.className = 'entry-micros';
    micros.textContent = `Na ${num(m.sodium)}mg · Fe ${num(m.iron)}mg`;
    main.append(name, macros, micros);

    const favName = parsePortion(entry.food).name;
    const faved = isFavorite(favName);
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const favBtn = iconBtn(faved ? '★' : '☆', `${faved ? 'Remove' : 'Save'} ${favName} ${faved ? 'from' : 'to'} favorites`, () => toggleFavorite(entry));
    if (faved) favBtn.classList.add('faved');
    const editBtn = iconBtn('✎', `Edit ${entry.food}`, () => openEditor(li, entry, index));
    const rmBtn = iconBtn('✕', `Remove ${entry.food}`, () => removeEntry(index));
    rmBtn.classList.add('danger');
    actions.append(favBtn, editBtn, rmBtn);

    li.append(main, actions);
    return li;
}

function openEditor(li, entry, index) {
    li.replaceChildren();
    li.classList.add('editing');
    const { name, factor } = parsePortion(entry.food);   // edit the base name + its multiplier
    const input = document.createElement('input');
    input.type = 'text';
    input.value = name;
    input.maxLength = 80;
    const mult = document.createElement('input');
    mult.type = 'number';
    mult.className = 'edit-mult';
    mult.value = factor;
    mult.min = 0.25; mult.step = 0.25;
    mult.setAttribute('aria-label', 'Portion multiplier');
    const status = document.createElement('span');
    status.className = 'status';
    const commit = () => saveEdit(index, input.value, clampFactor(mult.value), status);
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.addEventListener('click', commit);
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', render);
    const row = document.createElement('div');
    row.className = 'edit-row';
    const times = document.createElement('span');
    times.className = 'edit-times';
    times.textContent = '×';
    row.append(input, times, mult, save, cancel);
    li.append(row, status);
    input.focus();
    input.select();
    const onKey = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); };
    input.addEventListener('keydown', onKey);
    mult.addEventListener('keydown', onKey);
}

function iconBtn(glyph, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
}

// Macronutrients (grams + energy) and micronutrients (mg) shown as separate groups.
const MACRO_ROWS = [['Carbs', 'carbs', 'g'], ['Protein', 'protein', 'g'], ['Fat', 'fat', 'g'], ['Fiber', 'fiber', 'g'], ['Calories', 'calories', '']];
const MICRO_ROWS = [['Sodium', 'sodium', 'mg'], ['Iron', 'iron', 'mg']];

// Render the macro bars, a "Micronutrients" divider, then the micro bars.
// valueFor/goalFor map a macro key -> number, so this is reused for daily/avg/total.
// Carbs+fat share a caloric pool (energyBalance): over one but under the other by the
// same calories is a "spill", shown amber with a caption, not a red overage.
function renderBarGroups(container, valueFor, goalFor) {
    container.replaceChildren();
    const totals = { carbs: valueFor('carbs'), fat: valueFor('fat') };
    const goals = { carbs: goalFor('carbs'), fat: goalFor('fat') };
    const energy = energyBalance(totals, goals);
    const stateFor = (key) => energy[key]                     // carbs/fat: pooled state
        ? energy[key].state
        : barState(key, valueFor(key), goalFor(key));         // everything else: independent
    const spillFor = (key) => (energy[key] && energy[key].spillCal)
        ? `⇄ ${energy[key].spillCal} cal swapped with ${energy[key].partner}`
        : '';
    MACRO_ROWS.forEach(([label, key, unit]) =>
        container.appendChild(bar(label, valueFor(key), goalFor(key), unit, stateFor(key), spillFor(key))));
    const divider = document.createElement('div');
    divider.className = 'bar-group-label';
    divider.textContent = 'Micronutrients';
    container.appendChild(divider);
    MICRO_ROWS.forEach(([label, key, unit]) =>
        container.appendChild(bar(label, valueFor(key), goalFor(key), unit, barState(key, valueFor(key), goalFor(key)))));
}

function renderProgress(totals, goals) {
    renderBarGroups(el('progressBars'), (k) => totals[k], (k) => (goals || {})[k] || 0);
}

function renderWeek(days, goals) {
    days = days || {};
    goals = goals || {};
    const keys = weekKeys(selectedDate);

    // streak
    const n = streak(days, selectedDate);
    el('streakBig').textContent = n ? `🔥 ${n}` : '—';
    el('streakSub').textContent = n
        ? `day${n === 1 ? '' : 's'} logged in a row. Keep it going!`
        : 'No active streak — log a day to start one.';

    // daily average over logged days
    const stats = weekStats(days, selectedDate);
    el('avgSub').textContent = stats.logged
        ? `Averaged over ${stats.logged} logged day${stats.logged === 1 ? '' : 's'} this week.`
        : 'No days logged this week yet.';
    renderBarGroups(el('weekAvgBars'), (k) => stats.avg[k], (k) => goals[k] || 0);

    // week total
    el('weekRange').textContent = `${keys[0]} → ${keys[6]}`;
    const wk = sumWeek(days, selectedDate);
    renderBarGroups(el('weekBars'), (k) => wk[k], (k) => (goals[k] || 0) * 7);
}

// ---- water ------------------------------------------------------------------
function renderWater(goals) {
    const cups = currentWater();
    const goal = num((goals || {}).waterGoal) || 8;
    el('waterGoal').value = goal;
    el('waterCount').textContent = `${cups} / ${goal} cups`;
    const wrap = el('waterCups');
    wrap.replaceChildren();
    const shown = Math.max(goal, cups);          // show overflow cups too
    for (let i = 0; i < shown; i++) {
        const cup = document.createElement('button');
        cup.type = 'button';
        cup.className = 'cup' + (i < cups ? ' filled' : '') + (i >= goal ? ' extra' : '');
        cup.textContent = i < cups ? '💧' : '○';
        cup.setAttribute('aria-label', `Set water to ${i + 1} cups`);
        cup.addEventListener('click', () => setWater(i + 1 === cups ? i : i + 1)); // tap filled top cup to undo
        wrap.appendChild(cup);
    }
}

// ---- weight (one weigh-in per day) ------------------------------------------
function renderWeight() {
    const w = currentWeight();
    el('weightInput').value = w || '';
    el('weightCurrent').textContent = w ? `${w}` : 'Not logged';
    el('weightClear').hidden = !w;
}

// ---- trends (30-day canvas line chart, no libs) -----------------------------
// Weight and water live on the day object; everything else is a summed nutrient.
// Weight is drawn with gaps (an unlogged day is a hole, not zero), so null = no point.
function trendValue(day, metric) {
    if (metric === 'weight') return num(day.weight) || null; // gap on missing
    if (metric === 'water') return num(day.water);
    return Math.round(sumMacros(day.entries)[metric]);
}

function renderTrends() {
    const days = loadCache().days || {};
    const metric = el('trendMetric').value;
    const keys = lastDays(selectedDate, 30);
    const vals = keys.map((k) => trendValue(days[k] || {}, metric));
    const present = vals.filter((v) => v != null && v > 0);
    el('trendSub').textContent = present.length
        ? `Last 30 days · ${present.length} logged · max ${Math.max(...present)}`
        : 'No data in the last 30 days.';
    drawChart(el('trendChart'), keys, vals, metric === 'weight');
}

// vals may contain nulls (gaps — the line lifts the pen and doesn't connect through them).
// zoom: base the y-axis on min..max instead of 0..max, so small weight swings are visible.
function drawChart(canvas, keys, vals, zoom) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, pad = 28;
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const brand = css.getPropertyValue('--brand').trim() || '#3e4eb8';
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    const border = css.getPropertyValue('--border').trim() || '#ddd';

    const present = vals.filter((v) => v != null);
    const hi = Math.max(1, ...present);
    const lo = zoom && present.length ? Math.min(...present) : 0;
    const span = hi - lo || 1;
    const x = (i) => pad + (i * (W - 2 * pad)) / (keys.length - 1);
    const y = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);

    // baseline
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();

    // axis labels (min shown too when zoomed)
    ctx.fillStyle = muted;
    ctx.font = '12px sans-serif';
    ctx.fillText(String(Math.round(hi)), 2, pad);
    if (zoom) ctx.fillText(String(Math.round(lo)), 2, H - pad - 2);

    // line — lift pen across nulls so gaps aren't bridged
    ctx.strokeStyle = brand;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let pen = false;
    vals.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        if (pen) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
        pen = true;
    });
    ctx.stroke();

    // dots on logged days
    ctx.fillStyle = brand;
    vals.forEach((v, i) => { if (v != null && v > 0) { ctx.beginPath(); ctx.arc(x(i), y(v), 2.5, 0, 7); ctx.fill(); } });

    // first/last date labels
    ctx.fillStyle = muted;
    ctx.fillText(keys[0].slice(5), pad, H - 8);
    ctx.fillText(keys[keys.length - 1].slice(5), W - pad - 28, H - 8);
}

// barState/MORE_IS_GOOD/energyBalance now live in macros.js (pure + tested).

// `state` is pre-resolved by the caller ('good'|'over'|'spill'|''); `spill` is an optional
// caption shown under the bar when carbs/fat borrowed calories from each other.
function bar(label, value, goal, unit, state, spill) {
    const wrap = document.createElement('div');
    wrap.className = 'bar';
    const head = document.createElement('div');
    head.className = 'bar-head';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    const rounded = Math.round(num(value));
    val.textContent = goal > 0 ? `${rounded}${unit} / ${goal}${unit}` : `${rounded}${unit}`;
    head.append(name, val);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = pct(value, goal) + '%';
    if (state) fill.classList.add(state);      // 'good' | 'over' | 'spill'
    track.appendChild(fill);
    wrap.append(head, track);
    if (spill) {
        const note = document.createElement('div');
        note.className = 'bar-spill';
        note.textContent = spill;
        wrap.appendChild(note);
    }
    return wrap;
}

// Permanent favorites menu: one-tap re-add at the current portion, plus a remove (×).
function renderFavoritesMenu(favorites) {
    const c = el('favoriteMenu');
    c.replaceChildren();
    if (!favorites.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Star a food from your entries to save it here permanently.';
        c.appendChild(p);
        return;
    }
    favorites.forEach((fav) => {
        const chip = document.createElement('span');
        chip.className = 'chip fav-chip';
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'chip-add';
        add.textContent = '★ ' + fav.name;
        add.title = `Add ${fav.name}`;
        add.addEventListener('click', () => {
            const factor = portionFactor();
            addEntry({ food: portionLabel(fav.name, factor), macros: scaleMacros(fav.macros, factor), meal: el('mealSelect').value });
        });
        const rm = iconBtn('✕', `Remove ${fav.name} from favorites`, () => { removeFavorite(fav.name); render(); });
        rm.classList.add('chip-rm', 'danger');
        chip.append(add, rm);
        c.appendChild(chip);
    });
}

function renderFavorites(meals) {
    const c = el('favoriteChips');
    c.replaceChildren();
    if (!meals.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Foods you add show up here for one-tap re-adding.';
        c.appendChild(p);
        return;
    }
    meals.forEach((meal) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = meal.name;
        chip.title = `Add ${meal.name}`;
        chip.addEventListener('click', () => {
            const factor = portionFactor();
            addEntry({ food: portionLabel(meal.name, factor), macros: scaleMacros(meal.macros, factor), meal: el('mealSelect').value });
        });
        c.appendChild(chip);
    });
}

function renderGoalInputs(goals) {
    goals = goals || {};
    el('goalCarbs').value = goals.carbs || '';
    el('goalProtein').value = goals.protein || '';
    el('goalFat').value = goals.fat || '';
    el('goalFiber').value = goals.fiber || '';
    el('goalSodium').value = goals.sodium || '';
    el('goalIron').value = goals.iron || '';
    el('goalCalories').value = goals.calories || '';
}

// ---- helpers ----------------------------------------------------------------
function setText(id, message, isError) {
    const node = el(id);
    node.textContent = message || '';
    node.className = isError ? 'status error' : 'status';
}

initLogin();
