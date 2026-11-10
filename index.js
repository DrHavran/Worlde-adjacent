import {
    getSession, getUser, getProfile,
    submitCheckIn, fetchUserStats, fetchFriendsForGame,
} from './supabase/integration.js';

/**
 * Stores a map of the user stats on each game
 * Example:
 * 'https://nytimes.com/games/wordle/index.html' => {
 *     today_points: 4,      // How many points/mistakes the user scored today
 *     current_streak: 1,    // Its streak
 *     done_today: true      // If he has finished the game today
 *  },
 */
let userStats = new Map();
// Stores the current logged in user
let currentUser = null;
// Stores the website.json
let websiteData = null;

/**
 * Fetches a JSON file -> if running in localhost, fetches it directly from your pc
 */
async function getData(file) {
    const isProduction = window.location.hostname === "drhavran.github.io";
    const url = isProduction
        ? `https://drhavran.github.io/Worlde-adjacent/${file}`
        : `../${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json();
}

/**
 * Loads the top box of user with either the [Log-In] button, or its profile
 */
async function renderUserArea() {
    const area = document.getElementById('user-area');
    if (!area) return;

    const session = await getSession();
    const user = session ? await getUser() : null;
    currentUser = user;

    // If not logged in, display log-in button
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

    // Display the user
    area.innerHTML = `
        <a href="pages/profile/profile.html" class="user-badge" title="Edit profile">
            ${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : ''}
            <span>${escapeHtml(name)}</span>
        </a>
    `;
}

/**
 * Handles the pop up, when a logged in user plays a game
 */
const pointsDialog = document.getElementById('points-dialog');
const pointsForm   = document.getElementById('points-form');
const pointsInput  = document.getElementById('points-input');
const pointsTitle  = document.getElementById('points-title');
const pointsCancel = document.getElementById('points-cancel');
const pointsLabel  = document.getElementById('points-label');

let pendingPoints = null;

// Opens the pop up window
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

// Clean up function
function dialogLabelFor(label) {
    if (!label) return 'points';
    const t = String(label).trim();
    if (!t) return 'points';
    if (t.startsWith('/')) return 'score';
    return t;
}

// Closes the window
pointsCancel.addEventListener('click', () => {
    pendingPoints = null;
    pointsDialog.close();
});

// Main function for when user submits their score
pointsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingPoints) return;

    const points = parseInt(pointsInput.value, 10);
    if (!Number.isFinite(points) || points < 0) return;

    const { url, max, onComplete } = pendingPoints;
    // Check if user didn't enter a bigger value then they should
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

// ---------- friends dialog ----------

const friendsDialog    = document.getElementById('friends-dialog');
const friendsList      = document.getElementById('friends-list');
const friendsGameTitle = document.getElementById('friends-game-title');

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

async function openFriendsDialog(gameName, gameUrl, label) {
    if (!friendsDialog) {
        alert('Friends dialog missing from index.html');
        return;
    }

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
            const avatarHtml = f.avatar_url
                ? `<img class="friend-avatar" src="${escapeHtml(f.avatar_url)}" alt="">`
                : `<div class="friend-avatar friend-avatar-empty"></div>`;
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

/**
 * Loads the sections from website.json 
 */
function render(data) {
    const container = document.querySelector(".sections");
    container.innerHTML = "";

    for (const [sectionName, items] of Object.entries(data)) {
        const section = document.createElement("section");
        const h2 = document.createElement("h2");
        h2.textContent = sectionName;
        section.appendChild(h2);
        section.appendChild(renderList(items)); // Loads the game items
        container.appendChild(section);
    }
}

/**
 * Checks if there are nested categories and calls itself recursivly
 * Currently not needed since categories aren't nested but it's a nice bonus
 */
function renderList(items) {
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
            details.appendChild(renderList(value));
            li.appendChild(details);
            ul.appendChild(li);
        } else {
            ul.appendChild(createCard(name, value));
        }
    }
    return ul;
}

/**
 * Loads one game card
 */
function createCard(name, entry) {
    const url   = typeof entry === "string" ? entry : entry.url;
    const thumb = typeof entry === "string" ? ""    : (entry.thumb || "");
    const label = (typeof entry === "object" && entry.label !== undefined) ? entry.label : " pts";
    const max   = (typeof entry === "object" && entry.max !== undefined) ? entry.max : null;

    const li = document.createElement("li");
    li.className = "game-card";

    const link = document.createElement("a");
    link.className = "card-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", name);

    // Open points pop up if user didn't play today & is logged in
    link.addEventListener('click', () => {
        if (!currentUser) return;
        if (isDoneToday(url)) return;
        openPointsDialog(url, name, label, max, async () => {
            await loadUserStats();
            if (websiteData) render(websiteData);
        });
    });

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
        img.alt = "game-image";
        img.loading = "lazy";
        img.onerror = () => img.replaceWith(makePlaceholder());
        thumbWrap.appendChild(img);
    } else {
        thumbWrap.appendChild(makePlaceholder());
    }

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = name;

    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.appendChild(title);

    // If user is logged in -> add points, streak
    if (currentUser) {
        const stat = userStats.get(url) ?? { today_points: null, current_streak: 0, done_today: false };

        if (stat.today_points !== null) {
            const pointsEl = document.createElement("span");
            pointsEl.className = "card-points";
            pointsEl.textContent = `${stat.today_points}${label}`;
            footer.appendChild(pointsEl);
        }

        const streakEl = document.createElement("span");
        streakEl.className = "card-streak";

        const icon = document.createElement("img");
        icon.className = "streak-icon";
        icon.src = SITE_ICONS.streak;
        icon.alt = "streak-icon";

        const count = document.createElement("span");
        count.className = "streak-count";
        count.textContent = stat.current_streak;

        // Toggles the "fire icon" states
        streakEl.classList.toggle("zero",    stat.current_streak === 0);
        streakEl.classList.toggle("hot",     stat.done_today);
        streakEl.classList.toggle("at-risk", stat.current_streak > 0 && !stat.done_today);

        streakEl.appendChild(icon);
        streakEl.appendChild(count);
        footer.appendChild(streakEl);
    }

    li.classList.toggle("done", currentUser && isDoneToday(url));

    li.appendChild(link);
    li.appendChild(thumbWrap);
    li.appendChild(footer);

    // If user is logged in -> add friends button (Not sure why it's split into two if's)
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
            openFriendsDialog(name, url, label); // Open friend dialogue
        });

        li.appendChild(btn);
    }

    return li;
}

// ---------- helpers -----------

async function loadUserStats() {
    if (!currentUser) { userStats = new Map(); return; }
    userStats = await fetchUserStats(currentUser.id);
}

function isDoneToday(url) {
    return userStats.get(url)?.done_today === true;
}

// Makes sure user didn't put shit into its name/pfp image
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ---------- kick off ----------

(async () => {
    await renderUserArea();
    await loadUserStats();
    try {
        websiteData = await getData("website.json");
        render(websiteData);
    } catch (err) {
        console.error(err);
        document.querySelector(".sections").textContent =
            "Failed to load games. Check the console.";
    }
})();