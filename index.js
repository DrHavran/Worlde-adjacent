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

// ---------- game library ----------
const $ = selector => document.querySelector(selector);
let collections = [], collectionIndex = 0, selectedIndex = 0, cards = [], games = [];
let searchOpen = false, previousSelection = null, previousFocus = null;
let libraryData = null;
function flatten(items, group) {
    return items.flatMap(item => Object.entries(item).flatMap(([name, value]) => Array.isArray(value)
        ? flatten(value, name)
        : [{ name, group, ...(typeof value === 'string' ? { url: value } : value) }]));
}
function render(data) {
    libraryData = data;
    const groups = Object.entries(data).map(([name, items]) => ({ name: name === 'Normal games' ? 'Daily games' : name, games: flatten(items, name) }));
    collections = [...groups, { name: 'All games', games: groups.flatMap(group => group.games) }];
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
    const dailyIndex = collections.findIndex(collection => collection.name === 'Daily games');
    selectCollection(dailyIndex >= 0 ? dailyIndex : 0);
}
function selectCollection(index) {
    hideSearch();
    collectionIndex = (index + collections.length) % collections.length;
    games = collections[collectionIndex].games; selectedIndex = 0;
    document.querySelectorAll('.channel').forEach((button, i) => button.setAttribute('aria-current', String(i === collectionIndex)));
    $('#collection-label').textContent = `${collections[collectionIndex].name.toUpperCase()} · ${games.length} GAMES`;
    buildCards();
}
function buildCards() {
    renderClassic();
    $('#tiles').replaceChildren();
    cards = games.map((game, index) => {
        const card = document.createElement('a'); card.className = 'game-tile';
        card.href = game.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
        card.setAttribute('aria-label', `Play ${game.name} (opens in a new tab)`);
        card.title = game.name;
        if (game.thumb) {
            const image = document.createElement('img'); image.className = 'tile-cover'; image.src = game.thumb; image.alt = ''; image.loading = 'lazy';
            card.classList.add('has-cover');
            image.addEventListener('error', () => { image.remove(); card.classList.remove('has-cover'); }); card.append(image);
        }
        const monogram = document.createElement('span'); monogram.className = 'tile-monogram'; monogram.textContent = game.name.split(/\s+/).map(word => word[0]).slice(0, 2).join(''); monogram.setAttribute('aria-hidden', 'true'); card.append(monogram);
        const done = document.createElement('span'); done.className = 'tile-done'; card.append(done);
        const bottom = document.createElement('span'); bottom.className = 'tile-bottom';
        const title = document.createElement('strong'); title.textContent = game.name;
        const subtitle = document.createElement('small'); subtitle.textContent = game.group === 'Normal games' ? 'Daily games' : game.group;
        bottom.append(title, subtitle); card.append(bottom);
        card.addEventListener('click', event => { if (index !== selectedIndex) { event.preventDefault(); selectGame(index); } });
        $('#tiles').append(card); return card;
    });
    $('#empty-results').hidden = games.length > 0;
    $('#complete-game').disabled = games.length === 0;
    $('#play-game').setAttribute('aria-disabled', String(games.length === 0));
    if (!games.length) {
        $('#modern-cover').hidden = true; $('#modern-cover').removeAttribute('src');
        document.querySelector('.modern-art').classList.remove('completed');
        $('#modern-monogram').textContent = '—';
        $('#selected-streak').hidden = true;
        $('#game-name').textContent = 'No games found';
        $('#game-category').textContent = 'SEARCH RESULTS';
        $('#game-description').textContent = 'Try a different name or category. Esc returns to your collection.';
        $('#play-game').removeAttribute('href');
        $('#position').textContent = '00'; $('#total').textContent = ' / 00';
        $('#progress').style.width = '0%';
        $('#previous').disabled = true; $('#next').disabled = true;
        $('#completion-label').textContent = 'Mark complete';
        $('#complete-game').setAttribute('aria-pressed', 'false');
        return;
    }
    selectGame(0);
}
function selectGame(index) {
    if (!games.length) return;
    selectedIndex = Math.max(0, Math.min(games.length - 1, index));
    const game = games[selectedIndex];
    cards.forEach((card, i) => {
        card.tabIndex = i === selectedIndex ? 0 : -1;
        card.classList.toggle('selected', i === selectedIndex);
        card.setAttribute('aria-current', String(i === selectedIndex));
    });
    $('#game-name').textContent = game.name;
    $('#game-category').textContent = game.group === 'Normal games' ? 'DAILY GAMES' : game.group.toUpperCase();
    $('#game-description').textContent = modernDescription(game);
    updateModernArtwork(game);
    if (document.documentElement.dataset.design === 'modern') cards[selectedIndex].scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    $('#play-game').href = game.url;
    $('#position').textContent = String(selectedIndex + 1).padStart(2, '0');
    $('#total').textContent = ` / ${String(games.length).padStart(2, '0')}`;
    $('#progress').style.width = `${(selectedIndex + 1) / games.length * 100}%`;
    $('#previous').disabled = selectedIndex === 0; $('#next').disabled = selectedIndex === games.length - 1;
    refreshProgress();
    highlightClassicResult();
    $('#announcement').textContent = `${game.name}, ${selectedIndex + 1} of ${games.length}`;
}
const descriptions = {
    Wordle: 'Six guesses. Five letters. A little moment of clarity, every day.',
    Travle: 'Find a path between two countries. A new route, every day.',
    Globle: 'Follow the warmer clues. Find today’s mystery country.',
    Worldle: 'One silhouette. A whole world of possibilities.',
    Connections: 'Sixteen words. Four hidden connections. Bring them together.',
    TypeRacer: 'Find your rhythm. Put your typing speed to the test.',
    Moonshot: 'A fresh challenge for your daily orbit.',
};
function modernDescription(game) {
    if (descriptions[game.name]) return descriptions[game.name];
    if (/flag/i.test(game.name)) return 'A world of colors. See how many flags you can recognize.';
    if (/capital/i.test(game.name)) return 'From familiar cities to faraway places. Put your knowledge on the map.';
    if (/countr/i.test(game.name)) return 'Explore the map. Name the places. Discover what you know.';
    return 'Take a break. Try a new challenge. Make it part of your day.';
}
function updateModernArtwork(game) {
    const image = $('#modern-cover');
    $('#modern-monogram').textContent = game.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('');
    if (image.getAttribute('src') === game.thumb) return;
    image.hidden = true;
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    if (game.thumb) image.src = game.thumb;
    else image.removeAttribute('src');
}
function refreshProgress() {
    if (!games.length) return;
    cards.forEach((card, i) => {
        const game = games[i], done = isDone(game.url), streak = loadStreak(game.url);
        const alive = [todayKey(), yesterdayKey()].includes(streak.last);
        card.classList.toggle('completed', done);
        const count = alive ? streak.count : 0;
        const badge = card.querySelector('.tile-done');
        badge.textContent = `${done ? '✓ · ' : ''}${count}d`;
        badge.title = `${done ? 'Completed today. ' : ''}${count} ${count === 1 ? 'day' : 'days'} streak`;
        badge.setAttribute('aria-label', badge.title);
    });
    const streak = loadStreak(games[selectedIndex].url);
    const count = [todayKey(), yesterdayKey()].includes(streak.last) ? streak.count : 0;
    $('#selected-streak').hidden = false;
    $('#selected-streak').textContent = `🔥 ${count} ${count === 1 ? 'day' : 'days'} streak`;
    const done = isDone(games[selectedIndex].url);
    $('#complete-game').setAttribute('aria-pressed', String(done));
    $('#completion-label').textContent = done ? 'Completed today' : 'Mark complete';
    document.querySelector('.modern-art').classList.toggle('completed', done);
}
function toggleCompletion() {
    if (!games.length) return;
    const url = games[selectedIndex].url, done = !isDone(url);
    setDone(url, done); if (done) recordCompletion(url); refreshProgress(); renderClassic();
    $('#announcement').textContent = `${games[selectedIndex].name} ${done ? 'completed' : 'marked incomplete'}`;
}
function createClassicCard(name, entry) {
    const url   = typeof entry === "string" ? entry : entry.url;
    const thumb = typeof entry === "string" ? ""    : (entry.thumb || "");

    const li = document.createElement("li");
    li.className = "game-card";

    // invisible overlay link
    const link = document.createElement("a");
    link.className = "card-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", name);

    // thumbnail (or placeholder)
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const makePlaceholder = () => {
        const ph = document.createElement("div");
        ph.className = "thumb placeholder";
        return ph;
    };

    if (thumb) {
        const img = document.createElement("img");
        img.className = "thumb";
        img.src = thumb;
        img.alt = "";
        img.loading = "lazy";
        img.onerror = () => img.replaceWith(makePlaceholder());
        thumbWrap.appendChild(img);
    } else {
        thumbWrap.appendChild(makePlaceholder());
    }

    // per-game streak badge — sits in the footer, right side
    const streakEl = document.createElement("span");
    streakEl.className = "card-streak";
    streakEl.setAttribute("aria-hidden", "true");

    const streakIcon = document.createElement("img");
    streakIcon.className = "streak-icon";
    streakIcon.src = "https://cdn-icons-png.flaticon.com/256/8722/8722283.png";
    streakIcon.alt = "";

    const streakCount = document.createElement("span");
    streakCount.className = "streak-count";

    streakEl.appendChild(streakIcon);
    streakEl.appendChild(streakCount);

    function refreshStreak(bump = false) {
        const streak = loadStreak(url);
        const doneToday = streak.last === todayKey();
        const alive = doneToday || streak.last === yesterdayKey();
        const count = alive ? streak.count : 0;

        streakCount.textContent = count;
        streakEl.classList.toggle("zero", count === 0);
        streakEl.classList.toggle("hot", doneToday);
        streakEl.classList.toggle("at-risk", count > 0 && !doneToday);

        if (bump) {
            streakEl.classList.remove("bump");
            void streakEl.offsetWidth;
            streakEl.classList.add("bump");
        }
    }

    refreshStreak();

    // footer: checkbox + title + streak
    const footer = document.createElement("div");
    footer.className = "card-footer";

    const label = document.createElement("label");
    label.className = "done-check";
    label.title = "Mark as done";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `Mark ${name} as done`);
    checkbox.checked = isDone(url);

    const box = document.createElement("span");
    box.className = "box";

    label.appendChild(checkbox);
    label.appendChild(box);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = name;

    footer.appendChild(label);
    footer.appendChild(title);
    footer.appendChild(streakEl);

    li.classList.toggle("done", checkbox.checked);
    checkbox.addEventListener("change", () => {
        setDone(url, checkbox.checked);
        li.classList.toggle("done", checkbox.checked);
        const bumped = checkbox.checked ? recordCompletion(url) : false;
        refreshStreak(bumped);
        refreshProgress();
    });

    li.appendChild(link);
    li.appendChild(thumbWrap);
    li.appendChild(footer);
    return li;
}

// ---------- recursive list renderer ----------

function renderClassicList(items) {
    const ul = document.createElement("ul");
    ul.className = "card-grid";

    for (const item of items) {
        const [name, value] = Object.entries(item)[0];

        if (Array.isArray(value)) {
            const li = document.createElement("li");
            li.className = "category";

            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = name;
            details.appendChild(summary);
            details.appendChild(renderClassicList(value));
            li.appendChild(details);
            ul.appendChild(li);
        } else {
            ul.appendChild(createClassicCard(name, value));
        }
    }
    return ul;
}

function highlightClassicResult() {
    document.querySelectorAll('#classic .card-link').forEach(link => {
        const selected = searchOpen && games[selectedIndex]?.url === link.getAttribute('href');
        link.closest('.game-card').classList.toggle('search-selected', selected);
    });
}
function renderClassic() {
    if (!libraryData) return;
    const container = document.querySelector('.sections');
    container.replaceChildren();
    const data = searchOpen ? { 'Search results': games.map(game => ({ [game.name]: game })) } : libraryData;
    for (const [name, items] of Object.entries(data)) {
        const section = document.createElement('section');
        const heading = document.createElement('h2'); heading.textContent = name;
        section.append(heading, renderClassicList(items)); container.append(section);
    }
    if (searchOpen && !games.length) {
        const empty = document.createElement('p'); empty.textContent = 'No games found. Try another search.'; container.append(empty);
    }
}
document.addEventListener('designchange', () => {
    if (!collections.length) return;
    renderClassic();
    if (games.length) selectGame(selectedIndex);
});
$('#previous').addEventListener('click', () => selectGame(selectedIndex - 1));
$('#next').addEventListener('click', () => selectGame(selectedIndex + 1));
$('#complete-game').addEventListener('click', toggleCompletion);
function hideSearch() {
    searchOpen = false;
    $('#search-bar').hidden = true;
    $('#open-search').setAttribute('aria-expanded', 'false');
}
function openSearch() {
    if (!collections.length) return;
    if (!searchOpen) {
        previousSelection = { collection: collectionIndex, game: selectedIndex };
        previousFocus = document.activeElement;
        searchOpen = true;
        $('#search-bar').hidden = false;
        $('#open-search').setAttribute('aria-expanded', 'true');
        $('#game-search').value = '';
        filterGames();
    }
    $('#game-search').focus();
}
function closeSearch() {
    if (!searchOpen) return;
    hideSearch();
    selectCollection(previousSelection.collection);
    selectGame(previousSelection.game);
    if (previousFocus?.isConnected) previousFocus.focus();
}
function filterGames() {
    const query = $('#game-search').value.trim().toLocaleLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    games = collections.at(-1).games.filter(game => words.every(word => `${game.name} ${game.group}`.toLocaleLowerCase().includes(word)));
    document.querySelectorAll('.channel').forEach(button => button.setAttribute('aria-current', 'false'));
    $('#collection-label').textContent = `SEARCH RESULTS · ${games.length} GAMES`;
    $('#search-count').textContent = `${games.length} ${games.length === 1 ? 'match' : 'matches'}`;
    buildCards();
}
function launchGame() { if (games.length) $('#play-game').click(); }
$('#open-search').addEventListener('click', openSearch);
$('#close-search').addEventListener('click', closeSearch);
$('#game-search').addEventListener('input', filterGames);
$('#search-bar').addEventListener('submit', event => event.preventDefault());
document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (searchOpen && event.key === 'Escape') { event.preventDefault(); closeSearch(); return; }
    if (event.target === $('#game-search')) {
        if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) launchGame(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectGame(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)); }
        return;
    }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key === '/') { event.preventDefault(); openSearch(); return; }
    if (document.documentElement.dataset.design === 'classic' && !searchOpen) return;
    if (!games.length) return;
    // Browsing controls launch the selected game; other controls retain native activation.
    if (event.key === 'Enter' && event.target.closest?.('button, a')
        && !event.target.closest('.game-tile, .channel, #previous, #next')) return;
    const key = event.key.toLowerCase();
    const actions = {
        arrowleft: () => selectGame(selectedIndex - 1), arrowright: () => selectGame(selectedIndex + 1),
        arrowup: () => selectCollection(collectionIndex - 1), arrowdown: () => selectCollection(collectionIndex + 1),
        enter: () => { if (!event.repeat) launchGame(); },
        a: launchGame, b: () => selectCollection(collections.length - 1), y: () => { if (!event.repeat) toggleCompletion(); },
    };
    if (actions[key]) { event.preventDefault(); actions[key](); }
});
window.addEventListener('resize', () => { if (games.length) selectGame(selectedIndex); });
window.addEventListener('storage', () => { if (games.length) { resetIfNewDay(); refreshProgress(); renderClassic(); } });
setInterval(() => { if (games.length && storage.getItem(STORAGE_DATE_KEY) !== todayKey()) { resetIfNewDay(); refreshProgress(); renderClassic(); } }, 30000);
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
