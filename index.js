// ---------- imports ----------

import {
    getSession, getUser, getProfile,
    submitCheckIn, fetchUserStats, fetchFriendsForGame,
} from './supabase/integration.js';

// ---------- module state ----------

/**
 * The currently logged-in user, or null when logged out.
 * Set by renderUserArea() during kickoff.
 */
let currentUser = null;

/**
 * Map of the current user's per-game stats, keyed by game URL.
 * Example:
 *   'https://nytimes.com/games/wordle/index.html' => {
 *       today_points: 4,       // score entered today (null if not played)
 *       current_streak: 3,     // consecutive days with a check-in
 *       done_today: true       // already checked in today
 *   }
 * Populated by loadUserStats(). Cleared when logged out.
 */
let userStats = new Map();

// ---------- helpers ----------

/**
 * Escapes HTML-sensitive characters in a string.
 * Used everywhere a username or avatar URL gets injected via innerHTML.
 */
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ---------- user area ----------

/**
 * Renders the header's user area.
 * Logged out → "Log in" button pointing at /pages/log-in/login.html.
 * Logged in  → avatar + username linking to /pages/profile/profile.html.
 * Also updates currentUser and (indirectly) which UI elements require auth.
 */
async function renderUserArea() {
    const area = document.getElementById('user-area');
    if (!area) return;

    const session = await getSession();
    const user = session ? await getUser() : null;
    currentUser = user;

    if (!user) {
        area.innerHTML = '<button type="button" id="login-btn">Log in</button>';
        document.getElementById('login-btn').addEventListener('click', () => {
            window.location.href = 'pages/log-in/login.html';
        });
        return;
    }

    const profile = await getProfile(user.id);
    const name    = profile?.username || user.email?.split('@')[0] || 'User';
    const avatar  = profile?.avatar_url;

    area.innerHTML = `
        <a href="pages/profile/profile.html" class="user-badge" title="Edit profile">
            <img src="${avatar ? escapeHtml(avatar) : SITE_ICONS.placeholderUser}"
                 alt=""
                 onerror="this.onerror=null;this.src='${SITE_ICONS.placeholderUser}'">
            <span>${escapeHtml(name)}</span>
        </a>
    `;
}

/**
 * Fetches the current user's stats from Supabase and stores them in
 * the module-level userStats Map. No-op (and clears stats) if logged out.
 * Called at kickoff and after every successful check-in.
 */
async function loadUserStats() {
    if (!currentUser) { userStats = new Map(); return; }
    userStats = await fetchUserStats(currentUser.id);
}

/**
 * Returns true if the current user has already checked in for this game today.
 */
function isDoneToday(url) {
    return userStats.get(url)?.done_today === true;
}

/**
 * Formats a streak count as "N day(s) streak".
 */
function streakLabel(count) {
    return `${count} ${count === 1 ? 'day' : 'days'} streak`;
}

// ---------- points dialog ----------

const pointsDialog = document.getElementById('points-dialog');
const pointsForm   = document.getElementById('points-form');
const pointsInput  = document.getElementById('points-input');
const pointsTitle  = document.getElementById('points-title');
const pointsCancel = document.getElementById('points-cancel');
const pointsLabel  = document.getElementById('points-label');

/** Holds the context for the currently-open dialog (url, max, callback). */
let pendingPoints = null;

/**
 * Turns a JSON label like " guesses" / " wpm" / "/6" into a short
 * text suitable for the dialog's input label. Labels that start with
 * "/" (Sporcle-style scores) fall back to the generic "score".
 */
function dialogLabelFor(label) {
    if (!label) return 'points';
    const t = String(label).trim();
    if (!t) return 'points';
    if (t.startsWith('/')) return 'score';
    return t;
}

/**
 * Opens the check-in dialog for a game.
 * @param {string} url   game URL (used as the check_in row's game_url)
 * @param {string} name  display name shown in the dialog header
 * @param {string} label JSON label (" guesses", "/6", ...)
 * @param {number|null} max optional max score; blocks over-max entries
 * @param {Function} onComplete called after a successful submit
 */
function openPointsDialog(url, name, label, max, onComplete) {
    pendingPoints = { url, max, onComplete };
    pointsTitle.textContent = name;
    pointsLabel.textContent = dialogLabelFor(label);
    pointsInput.value = '';
    if (max != null) pointsInput.max = String(max);
    else pointsInput.removeAttribute('max');
    pointsDialog.showModal();
    pointsInput.focus();
}

// Cancel button just closes the dialog without touching state
pointsCancel.addEventListener('click', () => {
    pendingPoints = null;
    pointsDialog.close();
});

/**
 * Submit handler for the check-in dialog.
 * Validates the number, calls submitCheckIn(), then runs the onComplete
 * callback (which typically reloads stats + rerenders).
 * The unique (user_id, game_url, checked_on) constraint on check_ins
 * is what actually enforces "one per day"; this is just the happy path.
 */
pointsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingPoints) return;

    const points = parseInt(pointsInput.value, 10);
    if (!Number.isFinite(points) || points < 0) return;

    const { url, max, onComplete } = pendingPoints;
    if (max != null && points > max) {
        alert(`Max for this game is ${max}.`);
        return;
    }

    try {
        await submitCheckIn(url, points);
        pendingPoints = null;
        pointsDialog.close();
        await onComplete?.();
    } catch (err) {
        console.error('check_in failed:', err);
        alert(err.message || 'Failed to save points');
    }
});

// ---------- friends dialog (classic view only) ----------

const friendsDialog    = document.getElementById('friends-dialog');
const friendsList      = document.getElementById('friends-list');
const friendsGameTitle = document.getElementById('friends-game-title');

// Close button + backdrop click both dismiss the dialog
document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('#friends-close')) {
        e.preventDefault();
        if (friendsDialog) friendsDialog.close();
    }
});

if (friendsDialog) {
    friendsDialog.addEventListener('click', (e) => {
        if (e.target === friendsDialog) friendsDialog.close();
    });
}

/**
 * Opens the modal listing friends' scores for one game.
 * Includes you (marked "(you)").
 * Sorted: played today first, then by points descending,
 * then alphabetically as a tie-break.
 */
async function openFriendsDialog(gameName, gameUrl, label) {
    if (!friendsDialog) return;

    friendsGameTitle.textContent = gameName;
    friendsList.innerHTML = '<li class="friend-row muted">Loading…</li>';
    friendsDialog.showModal();

    try {
        const friends = await fetchFriendsForGame(gameUrl);

        if (!friends.length) {
            friendsList.innerHTML = '<li class="friend-row muted">No friends yet.</li>';
            return;
        }

        friends.sort((a, b) => {
            if (a.played !== b.played) return a.played ? -1 : 1;
            if (a.played && b.played) {
                const diff = (b.points ?? 0) - (a.points ?? 0);
                if (diff !== 0) return diff;
            }
            return a.username.localeCompare(b.username);
        });

        friendsList.innerHTML = friends.map(f => {
            const streakClass = f.played ? 'hot' : 'zero';
            const pointsHtml = f.played
                ? `<span class="friend-points">${f.points}${label}</span>`
                : `<span class="friend-points muted">didn't play today</span>`;
            const avatarSrc = f.avatar_url || SITE_ICONS.placeholderUser;
            const avatarHtml = `<img class="friend-avatar" src="${escapeHtml(avatarSrc)}" alt="" onerror="this.onerror=null;this.src='${SITE_ICONS.placeholderUser}'">`;
            const selfBadge = f.isSelf ? ' <span class="friend-self">(you)</span>' : '';
            return `
                <li class="friend-row${f.isSelf ? ' friend-row-self' : ''}">
                    ${avatarHtml}
                    <span class="friend-name">${escapeHtml(f.username)}${selfBadge}</span>
                    ${pointsHtml}
                    <span class="card-streak ${streakClass}">
                        <img class="streak-icon" src="${SITE_ICONS.streak}" alt="">
                        <span class="streak-count">${f.streak}</span>
                    </span>
                </li>
            `;
        }).join('');
    } catch (err) {
        console.error('[friends] fetch failed:', err);
        friendsList.innerHTML = `<li class="friend-row muted">${escapeHtml(err.message || 'Failed to load friends')}</li>`;
    }
}

// ---------- inline friends list (modern view) ----------

/**
 * Monotonic token. Every call to renderSelectionFriends bumps it; when a
 * slower fetch resolves after a newer one, its result is discarded.
 * Prevents stale rows from flickering in during fast keyboard navigation.
 */
let selectionFriendsToken = 0;

/**
 * Renders the inline friends list shown under the selection panel
 * in modern view, includes yourself.
 * Hidden entirely when there are no friends or the user is logged out.
 */
async function renderSelectionFriends(gameUrl, gameLabel) {
    const container = $('#selection-friends');
    if (!container) return;

    const token = ++selectionFriendsToken;
    container.hidden = true;
    container.replaceChildren();

    if (!currentUser) return;

    try {
        const friends = await fetchFriendsForGame(gameUrl);
        if (token !== selectionFriendsToken) return;
        if (!friends.length) return;

        // Sort: played today first, then by points descending, then alphabetically.
        // No isSelf special-casing — you land wherever your score puts you.
        friends.sort((a, b) => {
            if (a.played !== b.played) return a.played ? -1 : 1;
            if (a.played && b.played) {
                const diff = (b.points ?? 0) - (a.points ?? 0);
                if (diff !== 0) return diff;
            }
            return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
        });

        const lbl = (typeof gameLabel === 'string') ? gameLabel : ' pts';

        container.innerHTML = friends.map(f => {
            const avatarSrc = f.avatar_url || SITE_ICONS.placeholderUser;
            const selfMarker = f.isSelf ? ' <span class="friend-item-you">(you)</span>' : '';
            const scoreHtml = f.played
                ? `<span class="friend-item-score">${f.points}${lbl}</span>`
                : `<span class="friend-item-score">didn't play</span>`;
            return `<div class="friend-item${f.played ? '' : ' missed'}">
                <img src="${escapeHtml(avatarSrc)}" alt="" onerror="this.onerror=null;this.src='${SITE_ICONS.placeholderUser}'">
                <span class="friend-item-name">${escapeHtml(f.username)}${selfMarker}</span>
                ${scoreHtml}
            </div>`;
        }).join('');

        container.hidden = false;
    } catch (err) {
        console.error('[selection-friends]', err);
    }
}

// ---------- catalog validation ----------

/**
 * Validates the structure of website.json before any UI is built from it.
 * Rejects:
 *   - non-object root
 *   - collections that aren't arrays
 *   - entries with missing/extra top-level keys
 *   - URLs that aren't http(s)
 * Throws on any problem; returns the input on success so callers can chain.
 */
function validateCatalog(data, baseURL) {
    if (!data || Array.isArray(data) || typeof data !== 'object') {
        throw new Error('The game catalog must contain named collections.');
    }
    function checkURL(value, allowRelative = false) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('Missing game URL.');
        const url = allowRelative ? new URL(value, baseURL) : new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol.');
    }
    function checkItems(items) {
        if (!Array.isArray(items)) throw new Error('A collection must be an array.');
        for (const item of items) {
            if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1) {
                throw new Error('Each catalog entry must have one name.');
            }
            const [name, value] = Object.entries(item)[0];
            if (!name.trim()) throw new Error('A game or group needs a name.');
            if (Array.isArray(value)) checkItems(value);
            else if (typeof value === 'string') checkURL(value);
            else {
                if (!value || typeof value !== 'object') throw new Error('Invalid game entry.');
                checkURL(value.url);
                if (value.thumb) checkURL(value.thumb, true);
            }
        }
    }
    for (const [name, items] of Object.entries(data)) {
        if (!name.trim()) throw new Error('A collection needs a name.');
        checkItems(items);
    }
    return data;
}

/**
 * Fetches a JSON catalog file (relative to this module) and validates it.
 * Throws if the fetch fails or validation fails.
 */
async function getData(file) {
    const url = new URL(file, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return validateCatalog(await response.json(), url);
}

// ---------- game library ----------

const $ = selector => document.querySelector(selector);

// Collection / selection state
let collections = [], collectionIndex = 0, selectedIndex = 0, cards = [], games = [];

// Search state
let searchOpen = false, previousSelection = null, previousFocus = null;

// Data caches
let libraryData = null;
let classicSearchMode = null;
const classicCards = new Map(); // <li> → refresh() for classic view repaints

/**
 * Flattens one collection's nested arrays into a flat game array.
 * Each game keeps its group name so the UI can label it.
 * A game entry may be a bare URL string or an object { url, thumb, label, max }.
 */
function flatten(items, group) {
    return items.flatMap(item => Object.entries(item).flatMap(([name, value]) => Array.isArray(value)
        ? flatten(value, name)
        : [{ ...(typeof value === 'string' ? { url: value } : value), name, group }]));
}

/**
 * Builds the channel list (Daily games / Geography / Flags / All games)
 * and shows the initial collection.
 * Called once after website.json is fetched + validated.
 */
function render(data) {
    libraryData = data;
    const groups = Object.entries(data).map(([name, items]) => ({
        name: name === 'Normal games' ? 'Daily games' : name,
        games: flatten(items, name)
    }));
    collections = [...groups, { name: 'All games', games: groups.flatMap(group => group.games) }];
    if (!collections.at(-1).games.length) throw new Error('No games found in the library.');

    $('#loading').hidden = true;
    $('#open-search').disabled = false;

    collections.forEach((collection, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'channel';
        button.textContent = collection.name;
        const count = document.createElement('small');
        count.textContent = String(collection.games.length).padStart(2, '0');
        button.append(count);
        button.addEventListener('click', () => selectCollection(index));
        $('#channels').append(button);
    });

    // Prefer "Daily games" if present, otherwise the first collection
    const dailyIndex = collections.findIndex(collection => collection.name === 'Daily games');
    selectCollection(dailyIndex >= 0 ? dailyIndex : 0);
}

/**
 * Switches to a different collection.
 * Resets game selection to 0 and hides the search bar (changing channels
 * cancels any active search).
 */
function selectCollection(index) {
    hideSearch();
    collectionIndex = (index + collections.length) % collections.length;
    games = collections[collectionIndex].games; selectedIndex = 0;
    document.querySelectorAll('.channel').forEach((button, i) => button.setAttribute('aria-current', String(i === collectionIndex)));
    $('#collection-label').textContent = `${collections[collectionIndex].name.toUpperCase()} · ${games.length} GAMES`;
    buildCards();
}

/**
 * Rebuilds the modern-view tile strip and re-renders the classic view.
 * Runs whenever games/collections change or a design switch is triggered.
 */
function buildCards() {
    renderClassic();

    const tileHadFocus = $('#tiles').contains(document.activeElement);
    $('#tiles').replaceChildren();

    cards = games.map((game, index) => {
        const card = document.createElement('a');
        card.className = 'game-tile';
        card.href = game.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
        card.setAttribute('aria-label', `Play ${game.name} (opens in a new tab)`);
        card.title = game.name;

        // Cover image (optional; falls back to monogram if missing/broken)
        if (game.thumb) {
            const image = document.createElement('img');
            image.className = 'tile-cover'; image.src = game.thumb;
            image.alt = ''; image.loading = 'lazy';
            card.classList.add('has-cover');
            image.addEventListener('error', () => {
                image.remove(); card.classList.remove('has-cover');
            });
            card.append(image);
        }

        // Monogram (initials) fallback
        const monogram = document.createElement('span');
        monogram.className = 'tile-monogram';
        monogram.textContent = game.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('');
        monogram.setAttribute('aria-hidden', 'true');
        card.append(monogram);

        // Done badge (streak count etc., populated by refreshProgress)
        const done = document.createElement('span');
        done.className = 'tile-done';
        card.append(done);

        // Hidden title block used only when .tile-bottom isn't hidden
        const bottom = document.createElement('span');
        bottom.className = 'tile-bottom';
        const title = document.createElement('strong'); title.textContent = game.name;
        const subtitle = document.createElement('small');
        subtitle.textContent = game.group === 'Normal games' ? 'Daily games' : game.group;
        bottom.append(title, subtitle); card.append(bottom);

        // Click with modifier = let browser open the game directly in a new tab.
        // Plain click on non-selected tile = just select it (no navigation).
        card.addEventListener('click', event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            if (index !== selectedIndex) { event.preventDefault(); selectGame(index); }
        });

        $('#tiles').append(card); return card;
    });

    $('#empty-results').hidden = games.length > 0;
    $('#complete-game').disabled = games.length === 0 || !currentUser;
    $('#play-game').setAttribute('aria-disabled', String(games.length === 0));

    if (!games.length) {
        // Empty-state: no games to show
        $('#modern-cover').hidden = true; $('#modern-cover').removeAttribute('src');
        document.querySelector('.modern-art').classList.remove('completed');
        $('#modern-monogram').textContent = '—';
        $('#selected-streak').hidden = true;
        $('#selected-points').hidden = true;
        $('#selection-friends').hidden = true;
        $('#game-name').textContent = 'No games found';
        $('#game-category').textContent = 'SEARCH RESULTS';
        $('#play-game').removeAttribute('href');
        $('#position').textContent = '00'; $('#total').textContent = ' / 00';
        $('#progress').style.width = '0%';
        $('#previous').disabled = true; $('#next').disabled = true;
        $('#completion-label').textContent = 'Mark complete';
        $('#complete-game').setAttribute('aria-pressed', 'false');
        return;
    }

    selectGame(0);
    if (tileHadFocus) cards[0]?.focus({ preventScroll: true });
}

/**
 * Updates the modern selection panel to reflect a particular game index.
 * Highlights the tile, updates title/category/artwork, refreshes the
 * streak/points/friends row, and updates the shelf controls.
 */
function selectGame(index) {
    if (!games.length) return;

    const tileHadFocus = $('#tiles').contains(document.activeElement);
    selectedIndex = Math.max(0, Math.min(games.length - 1, index));
    const game = games[selectedIndex];

    cards.forEach((card, i) => {
        card.tabIndex = i === selectedIndex ? 0 : -1;
        card.classList.toggle('selected', i === selectedIndex);
        card.setAttribute('aria-current', String(i === selectedIndex));
    });
    if (tileHadFocus) cards[selectedIndex].focus({ preventScroll: true });

    $('#game-name').textContent = game.name;
    $('#game-category').textContent = game.group === 'Normal games' ? 'DAILY GAMES' : game.group.toUpperCase();
    updateModernArtwork(game);

    if (document.documentElement.dataset.design === 'modern') {
        cards[selectedIndex].scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }

    $('#play-game').href = game.url;
    $('#position').textContent = String(selectedIndex + 1).padStart(2, '0');
    $('#total').textContent = ` / ${String(games.length).padStart(2, '0')}`;
    $('#progress').style.width = `${(selectedIndex + 1) / games.length * 100}%`;
    $('#previous').disabled = selectedIndex === 0;
    $('#next').disabled = selectedIndex === games.length - 1;

    refreshProgress();
    highlightClassicResult();
    renderSelectionFriends(game.url, game.label);

    $('#announcement').textContent = `${game.name}, ${selectedIndex + 1} of ${games.length}`;
}

/**
 * Swaps the big cover image in the selection panel.
 * Fades in on successful load; hides on failure (monogram stays visible).
 */
function updateModernArtwork(game) {
    const image = $('#modern-cover');
    $('#modern-monogram').textContent = game.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('');

    // Skip work if the src is already correct
    if (image.getAttribute('src') === game.thumb) return;

    image.hidden = true;
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    if (game.thumb) image.src = game.thumb;
    else image.removeAttribute('src');
}

/**
 * Repaints every score-related piece of UI:
 *   - modern tile badges
 *   - selection panel (streak, points, button state, cover overlay)
 *   - every classic card (via classicCards map)
 * Safe to call at any time; no-op for logged-out users.
 */
function refreshProgress() {
    // Tile badges
    cards.forEach((card, i) => {
        const game = games[i];
        const badge = card.querySelector('.tile-done');
        if (!currentUser) {
            badge.hidden = true;
            card.classList.remove('completed');
            return;
        }
        const stat = userStats.get(game.url);
        const done = stat?.done_today === true;
        const count = stat?.current_streak ?? 0;
        badge.hidden = false;
        badge.textContent = `${done ? '✓ · ' : ''}${count}d`;
        badge.title = `${done ? 'Completed today. ' : ''}${streakLabel(count)}`;
        badge.setAttribute('aria-label', badge.title);
        card.classList.toggle('completed', done);
    });

    // Selection panel
    if (games.length) {
        const game = games[selectedIndex];
        const stat = currentUser ? userStats.get(game.url) : null;
        const count = stat?.current_streak ?? 0;
        const done  = stat?.done_today === true;

        $('#selected-streak').hidden = !currentUser;
        if (currentUser) {
            $('#selected-streak').textContent = `🔥 ${streakLabel(count)}`;
        }

        const pointsEl = $('#selected-points');
        const todayPoints = stat?.today_points;
        if (currentUser && todayPoints != null) {
            const lbl = (typeof game.label === 'string' && game.label.trim()) ? game.label : ' pts';
            pointsEl.textContent = `${todayPoints}${lbl}`;
            pointsEl.hidden = false;
        } else {
            pointsEl.hidden = true;
        }

        $('#complete-game').setAttribute('aria-pressed', String(done));
        $('#completion-label').textContent = done ? 'Completed today' : 'Mark complete';
        document.querySelector('.modern-art').classList.toggle('completed', done);
    }

    // Classic cards
    for (const refresh of classicCards.values()) refresh();
}

/**
 * Handles the "Mark complete" button and the Y keyboard shortcut.
 * Opens the check-in dialog for the selected game if not already done today.
 * No-op for logged-out users or already-completed games.
 */
function toggleCompletion() {
    if (!games.length || !currentUser) return;
    const game = games[selectedIndex];
    if (isDoneToday(game.url)) return;
    openPointsDialog(game.url, game.name, game.label, game.max, async () => {
        await loadUserStats();
        refreshProgress();
        renderSelectionFriends(game.url, game.label);
        $('#announcement').textContent = `${game.name} completed`;
    });
}

// ---------- classic card ----------

/**
 * Builds one classic-view card (<li>).
 * Wires up:
 *   - click on the overlay link → check-in dialog if logged in + not done
 *   - checkbox → check-in dialog (once done, can't uncheck)
 *   - streak pill / points pill (updated by classicCards refresh)
 *   - friends button (opens the classic friends dialog)
 * The card is registered in classicCards so refreshProgress() can repaint it.
 */
function createClassicCard(name, entry) {
    const url   = typeof entry === "string" ? entry : entry.url;
    const thumb = typeof entry === "string" ? ""    : (entry.thumb || "");
    const label = (typeof entry === "object" && entry.label !== undefined) ? entry.label : " pts";
    const max   = (typeof entry === "object" && entry.max !== undefined) ? entry.max : null;

    const li = document.createElement("li");
    li.className = "game-card";

    // Full-card overlay link
    const link = document.createElement("a");
    link.className = "card-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${name} (opens in a new tab)`);

    link.addEventListener('click', () => {
        if (!currentUser) return;
        if (isDoneToday(url)) return;
        openPointsDialog(url, name, label, max, async () => {
            await loadUserStats();
            refreshProgress();
            renderSelectionFriends(url, label);
        });
    });

    // Thumbnail (or gradient placeholder)
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

    // Streak pill
    const streakEl = document.createElement("span");
    streakEl.className = "card-streak";
    streakEl.setAttribute("role", "img");
    const streakIcon = document.createElement("img");
    streakIcon.className = "streak-icon";
    streakIcon.src = SITE_ICONS.streak;
    streakIcon.alt = "";
    const streakCount = document.createElement("span");
    streakCount.className = "streak-count";
    streakEl.appendChild(streakIcon);
    streakEl.appendChild(streakCount);

    function refreshStreak() {
        const stat = currentUser ? userStats.get(url) : null;
        const count = stat?.current_streak ?? 0;
        const doneToday = stat?.done_today === true;
        const lbl = streakLabel(count);
        streakEl.setAttribute('aria-label', lbl);
        streakEl.title = lbl;
        streakCount.textContent = count;
        streakEl.classList.toggle("zero", count === 0);
        streakEl.classList.toggle("hot", doneToday);
        streakEl.classList.toggle("at-risk", count > 0 && !doneToday);
    }

    // Points pill
    const pointsEl = document.createElement("span");
    pointsEl.className = "card-points";
    pointsEl.hidden = true;
    function refreshPoints() {
        const stat = currentUser ? userStats.get(url) : null;
        if (stat && stat.today_points !== null && stat.today_points !== undefined) {
            pointsEl.textContent = `${stat.today_points}${label}`;
            pointsEl.hidden = false;
        } else {
            pointsEl.hidden = true;
        }
    }

    // Footer: checkbox + title + points + streak
    const footer = document.createElement("div");
    footer.className = "card-footer";

    const doneLabel = document.createElement("label");
    doneLabel.className = "done-check";
    doneLabel.title = "Mark as done";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `Mark ${name} as done`);
    checkbox.checked = isDoneToday(url);
    const box = document.createElement("span");
    box.className = "box";
    doneLabel.appendChild(checkbox);
    doneLabel.appendChild(box);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = name;

    if (currentUser) {
        footer.appendChild(doneLabel);
        footer.appendChild(title);
        footer.appendChild(pointsEl);
        footer.appendChild(streakEl);
    } else {
        footer.appendChild(title);
    }

    li.classList.toggle("done", currentUser && isDoneToday(url));

    // Checkbox: click → open dialog (or revert immediately if already done).
    // Unchecking a completed game is blocked while logged in.
    checkbox.addEventListener("change", () => {
        if (!currentUser) return;
        if (!checkbox.checked) {
            checkbox.checked = true;
            return;
        }
        if (isDoneToday(url)) return;
        checkbox.checked = false;
        openPointsDialog(url, name, label, max, async () => {
            await loadUserStats();
            refreshProgress();
            renderSelectionFriends(url, label);
        });
    });

    // Registered so refreshProgress() can repaint this card.
    classicCards.set(li, () => {
        if (!currentUser) return;
        checkbox.checked = isDoneToday(url);
        li.classList.toggle('done', checkbox.checked);
        refreshStreak();
        refreshPoints();
    });

    li.appendChild(link);
    li.appendChild(thumbWrap);
    li.appendChild(footer);

    // Friends button (top-right, only shown for logged-in users)
    if (currentUser) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "card-friends-btn";
        btn.setAttribute("aria-label", `Friends playing ${name}`);
        const btnIcon = document.createElement("img");
        btnIcon.src = SITE_ICONS.friends;
        btnIcon.alt = "friends-icon";
        btnIcon.onerror = () => { btn.textContent = '👥'; };
        btn.appendChild(btnIcon);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFriendsDialog(name, url, label);
        });
        li.appendChild(btn);
    }

    refreshStreak();
    refreshPoints();

    return li;
}

/**
 * Recursively renders a list of items.
 * Categories (nested arrays) become <details>/<summary> blocks.
 * Leaf items become classic cards.
 */
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

/**
 * Outlines the currently-selected tile in the classic grid.
 * Only does anything while a search is open (since outside search,
 * selection isn't meaningful in the classic layout).
 */
function highlightClassicResult() {
    document.querySelectorAll('#classic .card-link').forEach(link => {
        const selected = searchOpen && games[selectedIndex]?.url === link.getAttribute('href');
        link.closest('.game-card').classList.toggle('search-selected', selected);
    });
}

/**
 * Rebuilds the classic grid from libraryData (or filtered results
 * when search is active). No-op if the design isn't classic yet — saves
 * a full re-render until the user actually switches.
 */
function renderClassic() {
    if (!libraryData) return;
    if (!searchOpen && classicSearchMode === false) return;
    classicSearchMode = searchOpen;
    classicCards.clear();

    const container = document.querySelector('.sections');
    container.replaceChildren();

    const data = searchOpen
        ? { 'Search results': games.map(game => ({ [game.name]: game })) }
        : libraryData;

    for (const [name, items] of Object.entries(data)) {
        const section = document.createElement('section');
        const heading = document.createElement('h2'); heading.textContent = name;
        section.append(heading, renderClassicList(items));
        container.append(section);
    }

    if (searchOpen && !games.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No games found. Try another search.';
        container.append(empty);
    }
}

// Re-render classic + selection when the design dropdown changes
document.addEventListener('designchange', () => {
    if (!collections.length) return;
    renderClassic();
    if (games.length) selectGame(selectedIndex);
});

// ---------- controls ----------

$('#previous').addEventListener('click', () => selectGame(selectedIndex - 1));
$('#next').addEventListener('click', () => selectGame(selectedIndex + 1));
$('#complete-game').addEventListener('click', toggleCompletion);

// "Play game" opens the dialog in addition to navigating (the anchor's
// default behavior opens the game in a new tab; this handler just prompts
// for a score afterwards).
$('#play-game').addEventListener('click', () => {
    if (!currentUser || !games.length) return;
    const game = games[selectedIndex];
    if (isDoneToday(game.url)) return;
    openPointsDialog(game.url, game.name, game.label, game.max, async () => {
        await loadUserStats();
        refreshProgress();
        renderSelectionFriends(game.url, game.label);
    });
});

/**
 * Hides the search bar without restoring previous selection.
 * Called internally by openSearch/closeSearch/selectCollection.
 */
function hideSearch() {
    searchOpen = false;
    $('#search-bar').hidden = true;
    $('#open-search').setAttribute('aria-expanded', 'false');
}

/**
 * Opens the search bar. Remembers the previous selection so closeSearch()
 * can return to it.
 */
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

/**
 * Closes search and restores the collection + selection that were active
 * before openSearch() ran. Focus goes back to whatever had it.
 */
function closeSearch() {
    if (!searchOpen) return;
    hideSearch();
    selectCollection(previousSelection.collection);
    selectGame(previousSelection.game);
    if (previousFocus?.isConnected) previousFocus.focus();
    else if (document.documentElement.dataset.design === 'modern') cards[selectedIndex]?.focus();
    else $('#open-search').focus();
}

/**
 * Filters the "All games" list against the search query and rebuilds
 * the tile strip. Called on every input event.
 */
function filterGames() {
    const query = $('#game-search').value.trim().toLocaleLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    games = collections.at(-1).games.filter(game => words.every(word =>
        `${game.name} ${game.group === 'Normal games' ? 'Daily games' : game.group}`.toLocaleLowerCase().includes(word)
    ));
    document.querySelectorAll('.channel').forEach(button => button.setAttribute('aria-current', 'false'));
    $('#collection-label').textContent = `SEARCH RESULTS · ${games.length} GAMES`;
    $('#search-count').textContent = `${games.length} ${games.length === 1 ? 'match' : 'matches'}`;
    buildCards();
}

/** Fires the "Play game" click (navigates + opens the check-in dialog). */
function launchGame() { if (games.length) $('#play-game').click(); }

$('#open-search').addEventListener('click', openSearch);
$('#close-search').addEventListener('click', closeSearch);
$('#game-search').addEventListener('input', filterGames);
$('#search-bar').addEventListener('submit', event => event.preventDefault());

/**
 * Global keyboard handler.
 * Shortcuts (only when focus isn't in a text field):
 *   ←/→      previous/next game
 *   ↑/↓      previous/next collection
 *   Enter/A  open game (with dialog)
 *   Y        mark complete
 *   B        jump to "All games"
 *   /        open search
 *   Esc      close search (when search bar is open)
 */
document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;

    if (searchOpen && event.key === 'Escape') { event.preventDefault(); closeSearch(); return; }

    // When focus is in the search input, only handle its own keys
    if (event.target === $('#game-search')) {
        if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) launchGame(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            selectGame(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
        }
        return;
    }

    // Don't hijack shortcuts while typing into any other input
    if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;

    if (event.key === '/') { event.preventDefault(); openSearch(); return; }

    // Design switch (classic vs modern) dictates whether bare-letter shortcuts apply
    if (!KEYBOARD_DESIGNS.includes(document.documentElement.dataset.design) && !searchOpen) return;
    if (!games.length) return;

    // Enter activates a focused native control; don't double-fire it
    if (event.key === 'Enter' && event.target.closest?.('button, a, summary')) {
        if (event.repeat && event.target.closest('.game-tile, #play-game')) event.preventDefault();
        return;
    }

    const key = event.key.toLowerCase();
    const actions = {
        arrowleft: () => selectGame(selectedIndex - 1),
        arrowright: () => selectGame(selectedIndex + 1),
        arrowup: () => selectCollection(collectionIndex - 1),
        arrowdown: () => selectCollection(collectionIndex + 1),
        enter: () => { if (!event.repeat) launchGame(); },
        a: () => { if (!event.repeat) launchGame(); },
        b: () => selectCollection(collections.length - 1),
        y: () => { if (!event.repeat) toggleCompletion(); },
    };
    if (actions[key]) { event.preventDefault(); actions[key](); }
});

// ---------- sync ----------

/**
 * Reloads user stats and repaints everything. Called when the window
 * regains focus or the tab becomes visible — so coming back from a game
 * (played in another tab) shows the fresh check-in without a manual reload.
 */
async function syncProgress() {
    if (currentUser) await loadUserStats();
    refreshProgress();
    if (games.length) {
        const game = games[selectedIndex];
        renderSelectionFriends(game.url, game.label);
    }
}

window.addEventListener('focus', syncProgress);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncProgress();
});

// ---------- kickoff ----------

(async () => {
    // 1. Resolve auth + profile
    try {
        await renderUserArea();
        await loadUserStats();
    } catch (err) {
        console.error('User setup failed:', err);
    }

    // 2. Hide auth-only UI when logged out
    if (!currentUser) {
        document.getElementById('complete-game').hidden = true;
        document.getElementById('complete-control').hidden = true;
    }

    // 3. Load catalog and render the library
    try {
        getData('website.json').then(render).catch(error => {
            console.error(error);
            const status = $('#loading');
            status.hidden = false;
            status.textContent = 'Could not load games. Refresh the page to try again.';
            status.setAttribute('role', 'alert');
        });
    } catch (err) {
        console.error(err);
    }
})();