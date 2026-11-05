// Preserve the existing game state keys, with an in-memory fallback.
const memory = new Map();
const storage = {
    getItem(key) { if (memory.has(key)) return memory.get(key); try { return localStorage.getItem(key); } catch { return null; } },
    setItem(key, value) { try { localStorage.setItem(key, value); memory.delete(key); } catch { memory.set(key, String(value)); } },
    removeItem(key) { memory.delete(key); try { localStorage.removeItem(key); } catch { /* Storage is optional. */ } },
    keys() { try { return [...new Set([...Object.keys(localStorage), ...memory.keys()])]; } catch { return [...memory.keys()]; } }
};

// ---------- data loading ----------

async function getData(file) {
    const url = new URL(file, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json();
}

// ---------- "done" state (per-URL, per-browser) ----------

const STORAGE_PREFIX = "game-done:";

function isDone(url) {
    return storage.getItem(STORAGE_PREFIX + url) === "true";
}

function setDone(url, done) {
    if (done) storage.setItem(STORAGE_PREFIX + url, "true");
    else storage.removeItem(STORAGE_PREFIX + url);
}

// ---------- daily reset ----------

const STORAGE_DATE_KEY = "game-done-date"; // no colon → not caught by the wipe below

function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function resetIfNewDay() {
    const today = todayKey();
    if (storage.getItem(STORAGE_DATE_KEY) === today) return;

    storage.keys()
        .filter(k => k.startsWith(STORAGE_PREFIX))
        .forEach(k => storage.removeItem(k));

    storage.setItem(STORAGE_DATE_KEY, today);
}

// ---------- daily streak (per game) ----------

const STREAK_PREFIX = "game-streak:"; // not caught by the "game-done:" wipe above

function loadStreak(url) {
    try {
        const parsed = JSON.parse(storage.getItem(STREAK_PREFIX + url));
        if (parsed && Number.isFinite(parsed.count) && typeof parsed.last === "string") {
            return { count: parsed.count, last: parsed.last };
        }
    } catch { /* missing or corrupt → fresh start */ }
    return { count: 0, last: null };
}

function saveStreak(url, streak) {
    storage.setItem(STREAK_PREFIX + url, JSON.stringify(streak));
}

function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/* first tick of the day → +1 (or reset to 1 if the chain broke) */
function recordCompletion(url) {
    const streak = loadStreak(url);
    const today = todayKey();
    if (streak.last === today) return false; // already counted today
    streak.count = (streak.last === yesterdayKey()) ? streak.count + 1 : 1;
    streak.last = today;
    saveStreak(url, streak);
    return true;
}

// ---------- local NXE-inspired game dashboard ----------
const $ = selector => document.querySelector(selector);
const icons = {
    daily: '<circle cx="60" cy="60" r="47" fill="url(#disc)"/><circle cx="60" cy="60" r="17" fill="#699a25"/><circle cx="60" cy="60" r="9" fill="#cee49a"/><path d="M23 31 47 47M73 73l24 24M18 66l24-3M78 57l24-3" stroke="#87ac39" stroke-width="8" opacity=".6"/>',
    geography: '<circle cx="60" cy="60" r="44" fill="url(#disc)"/><ellipse cx="60" cy="60" rx="22" ry="44" fill="none" stroke="#7f9f45" stroke-width="3"/><path d="M17 60h86M24 36h72M24 84h72" fill="none" stroke="#7f9f45" stroke-width="3"/><path d="m35 22 14 9-2 16 12 4 9-8 8 15-8 11-2 23-12 8-8-24-14-10 5-18-9-8z" fill="#6a982e" opacity=".8"/>',
    flags: '<path d="M29 105V15" stroke="#ebf5d0" stroke-width="7" stroke-linecap="round"/><path d="M33 18c24-19 41 20 65 0v54c-24 20-41-19-65 0z" fill="url(#disc)"/><path d="M34 35c23-17 42 20 63 0v17c-22 20-42-16-63 0z" fill="#9ebc4f"/>',
};
function artwork(group) {
    const kind = /flag/i.test(group) ? 'flags' : /geography/i.test(group) ? 'geography' : 'daily';
    return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="disc" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#eaf4bb"/><stop offset="1" stop-color="#a9c951"/></linearGradient></defs>${icons[kind]}</svg>`;
}
let collections = [], collectionIndex = 0, selectedIndex = 0, cards = [], games = [];
function flatten(items, group) {
    return items.flatMap(item => Object.entries(item).flatMap(([name, value]) => Array.isArray(value)
        ? flatten(value, name)
        : [{ name, group, ...(typeof value === 'string' ? { url: value } : value) }]));
}
function render(data) {
    const groups = Object.entries(data).map(([name, items]) => ({ name: name === 'Normal games' ? 'Daily games' : name, games: flatten(items, name) }));
    collections = [...groups, { name: 'My games', games: groups.flatMap(group => group.games) }];
    if (!collections.at(-1).games.length) throw new Error('No games found in the library.');
    $('#loading').remove();
    collections.forEach((collection, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'channel';
        button.textContent = collection.name;
        const count = document.createElement('small'); count.textContent = String(collection.games.length).padStart(2, '0'); button.append(count);
        button.addEventListener('click', () => selectCollection(index));
        $('#channels').append(button);
    });
    selectCollection(collections.length - 1);
}
function selectCollection(index) {
    collectionIndex = (index + collections.length) % collections.length;
    games = collections[collectionIndex].games; selectedIndex = 0;
    document.querySelectorAll('.channel').forEach((button, i) => button.setAttribute('aria-current', String(i === collectionIndex)));
    $('#collection-label').textContent = `${collections[collectionIndex].name.toUpperCase()} · ${games.length} GAMES`;
    $('#tiles').replaceChildren();
    cards = games.map((game, index) => {
        const card = document.createElement('a'); card.className = 'game-tile';
        card.href = game.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
        card.setAttribute('aria-label', `Play ${game.name} (opens in a new tab)`);
        if (game.thumb) {
            const image = document.createElement('img'); image.className = 'tile-cover'; image.src = game.thumb; image.alt = ''; image.loading = 'lazy';
            image.addEventListener('error', () => image.remove()); card.append(image);
        }
        const pattern = document.createElement('span'); pattern.className = 'tile-pattern'; card.append(pattern);
        const icon = document.createElement('span'); icon.className = 'tile-icon'; icon.innerHTML = artwork(game.group); card.append(icon);
        const number = document.createElement('span'); number.className = 'tile-number'; number.textContent = `WORLDE 360 / ${String(index + 1).padStart(2, '0')}`; card.append(number);
        const done = document.createElement('span'); done.className = 'tile-done'; card.append(done);
        const bottom = document.createElement('span'); bottom.className = 'tile-bottom';
        const title = document.createElement('strong'); title.textContent = game.name;
        const subtitle = document.createElement('small'); subtitle.textContent = game.group === 'Normal games' ? 'Daily games' : game.group;
        bottom.append(title, subtitle); card.append(bottom);
        card.addEventListener('click', event => { if (index !== selectedIndex || swiped) { event.preventDefault(); if (!swiped) selectGame(index); } });
        $('#tiles').append(card); return card;
    });
    selectGame(0);
}
function selectGame(index) {
    selectedIndex = Math.max(0, Math.min(games.length - 1, index));
    const game = games[selectedIndex];
    const width = cards[0].offsetWidth, height = cards[0].offsetHeight;
    cards.forEach((card, i) => {
        const distance = i - selectedIndex;
        const scale = distance <= 0 ? 1 : Math.max(.28, .84 - (distance - 1) * .12);
        const x = distance < 0 ? distance * (width + 50) : distance === 0 ? 0 : width * .96 + (distance - 1) * width * .46;
        card.style.transform = `translate3d(${x}px, ${(1 - scale) * height / 2}px, ${-Math.max(0, distance) * 25}px) scale(${scale}) rotateY(${distance > 0 ? -8 : 0}deg)`;
        card.style.zIndex = String(100 - Math.abs(distance));
        card.style.opacity = distance < 0 || distance > 6 ? '0' : '1';
        card.style.pointerEvents = distance < 0 || distance > 6 ? 'none' : 'auto';
        card.setAttribute('aria-hidden', String(distance < 0 || distance > 6));
        card.tabIndex = distance === 0 ? 0 : -1;
        card.classList.toggle('selected', distance === 0);
    });
    $('#game-name').textContent = game.name;
    $('#game-category').textContent = game.group === 'Normal games' ? 'DAILY GAMES' : game.group.toUpperCase();
    $('#game-description').textContent = `Launch ${new URL(game.url).hostname.replace(/^www\./, '')} and start playing.`;
    $('#play-game').href = game.url;
    $('#position').textContent = String(selectedIndex + 1).padStart(2, '0');
    $('#total').textContent = ` / ${String(games.length).padStart(2, '0')}`;
    $('#progress').style.width = `${(selectedIndex + 1) / games.length * 100}%`;
    $('#previous').disabled = selectedIndex === 0; $('#next').disabled = selectedIndex === games.length - 1;
    refreshProgress();
    $('#announcement').textContent = `${game.name}, ${selectedIndex + 1} of ${games.length}`;
}
function refreshProgress() {
    cards.forEach((card, i) => {
        const game = games[i], done = isDone(game.url), streak = loadStreak(game.url);
        const alive = [todayKey(), yesterdayKey()].includes(streak.last);
        card.classList.toggle('completed', done);
        card.querySelector('.tile-done').textContent = done ? '✓ Complete' : `${alive ? streak.count : 0} day streak`;
    });
    const done = isDone(games[selectedIndex].url);
    $('#complete-game').setAttribute('aria-pressed', String(done));
    $('#completion-label').textContent = done ? 'Completed today' : 'Mark complete';
    $('#gamerscore').textContent = `${collections.at(-1).games.filter(game => isDone(game.url)).length} completed today`;
}
function toggleCompletion() {
    if (!games.length) return;
    const url = games[selectedIndex].url, done = !isDone(url);
    setDone(url, done); if (done) recordCompletion(url); refreshProgress();
    $('#announcement').textContent = `${games[selectedIndex].name} ${done ? 'completed' : 'marked incomplete'}`;
}
$('#previous').addEventListener('click', () => selectGame(selectedIndex - 1));
$('#next').addEventListener('click', () => selectGame(selectedIndex + 1));
$('#complete-game').addEventListener('click', toggleCompletion);
document.addEventListener('keydown', event => {
    if (!games.length || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    const actions = {
        arrowleft: () => selectGame(selectedIndex - 1), arrowright: () => selectGame(selectedIndex + 1),
        arrowup: () => selectCollection(collectionIndex - 1), arrowdown: () => selectCollection(collectionIndex + 1),
        a: () => $('#play-game').click(), b: () => selectCollection(collections.length - 1), y: toggleCompletion,
    };
    if (actions[key]) { event.preventDefault(); actions[key](); }
});
let touchX = null, swiped = false;
$('#stage').addEventListener('touchstart', event => { touchX = event.touches[0].clientX; swiped = false; }, { passive: true });
$('#stage').addEventListener('touchend', event => {
    if (touchX === null || !games.length) return;
    const delta = event.changedTouches[0].clientX - touchX;
    if (Math.abs(delta) > 45) { swiped = true; selectGame(selectedIndex + (delta < 0 ? 1 : -1)); setTimeout(() => { swiped = false; }, 300); }
    touchX = null;
}, { passive: true });
window.addEventListener('resize', () => { if (games.length) selectGame(selectedIndex); });
window.addEventListener('storage', () => { if (games.length) { resetIfNewDay(); refreshProgress(); } });
setInterval(() => { if (games.length && storage.getItem(STORAGE_DATE_KEY) !== todayKey()) { resetIfNewDay(); refreshProgress(); } }, 30000);
function refreshClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
refreshClock(); setInterval(refreshClock, 30000);
resetIfNewDay();
getData('website.json').then(render).catch(error => {
    console.error(error);
    const status = $('#loading') || document.createElement('p');
    status.textContent = 'Could not load games. Refresh the page to try again.';
    status.setAttribute('role', 'alert');
    if (!status.isConnected) $('#stage').append(status);
});
