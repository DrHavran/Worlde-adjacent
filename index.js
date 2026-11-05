import { isDone, setDone, resetIfNewDay } from './Data/cookies.js';

import {
    getSession, getUser, getProfile,
    submitCheckIn, fetchUserStats,
} from './Data/integration.js';

let currentUser = null;
let userStats = new Map();    // game_url → { total_points, current_streak, done_today }
let websiteData = null;

// ---------- data loading ----------

async function getData(file) {
    const isProduction = window.location.hostname === "drhavran.github.io";
    const url = isProduction
        ? `https://drhavran.github.io/Worlde-adjacent/${file}`
        : `../${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json();
}

// ---------- header user area ----------

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function renderUserArea() {
    const area = document.getElementById('user-area');
    if (!area) return;

    const session = await getSession();
    const user = session ? await getUser() : null;
    currentUser = user;

    if (!user) {
        area.innerHTML = '<button type="button" id="login-btn">Log in</button>';
        document.getElementById('login-btn').addEventListener('click', () => {
            window.location.href = 'LogInPage/logIn.html';
        });
        return;
    }

    const profile = await getProfile(user.id);
    const name    = profile?.username || user.email?.split('@')[0] || 'User';
    const avatar  = profile?.avatar_url;

    area.innerHTML = `
        <div class="user-badge">
            ${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : ''}
            <span>${escapeHtml(name)}</span>
        </div>
    `;
}

// ---------- user stats ----------

async function loadUserStats() {
    if (!currentUser) { userStats = new Map(); return; }
    userStats = await fetchUserStats(currentUser.id);
    // mirror "done today" into localStorage so the popup stays suppressed
    for (const [url, stat] of userStats) {
        if (stat.done_today) setDone(url, true);
    }
}

// ---------- points dialog ----------

const pointsDialog = document.getElementById('points-dialog');
const pointsForm   = document.getElementById('points-form');
const pointsInput  = document.getElementById('points-input');
const pointsTitle  = document.getElementById('points-title');
const pointsCancel = document.getElementById('points-cancel');

let pendingPoints = null;

function openPointsDialog(url, name, onComplete) {
    pendingPoints = { url, onComplete };
    pointsTitle.textContent = name;
    pointsInput.value = '';
    pointsDialog.showModal();
    pointsInput.focus();
}

pointsCancel.addEventListener('click', () => {
    pendingPoints = null;
    pointsDialog.close();
});

pointsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingPoints) return;

    const points = parseInt(pointsInput.value, 10);
    if (!Number.isFinite(points) || points < 0) return;

    const { url, onComplete } = pendingPoints;

    try {
        const result = await submitCheckIn(url, points);
        setDone(url, true);
        pendingPoints = null;
        pointsDialog.close();
        await onComplete?.(result);
    } catch (err) {
        console.error('check_in failed:', err);
        alert(err.message || 'Failed to save points');
    }
});

// ---------- one game card ----------

function createCard(name, entry) {
    const url   = typeof entry === "string" ? entry : entry.url;
    const thumb = typeof entry === "string" ? ""    : (entry.thumb || "");
    const label = (typeof entry === "object" && entry.label !== undefined)
        ? entry.label
        : "pts";

    const li = document.createElement("li");
    li.className = "game-card";

    const link = document.createElement("a");
    link.className = "card-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", name);

    link.addEventListener('click', () => {
        if (!currentUser) return;
        if (isDone(url)) return;
        openPointsDialog(url, name, async () => {
            await loadUserStats();
            if (websiteData) render(websiteData);
        });
    });

    // thumbnail
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

    // title
    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = name;

        // footer: title (+ points + streak if logged in)
        const footer = document.createElement("div");
        footer.className = "card-footer";
        footer.appendChild(title);
    
        if (currentUser) {
            const stat = userStats.get(url);
    
            // points — only render once the user has logged a score
            if (stat) {
                const pointsEl = document.createElement("span");
                pointsEl.className = "card-points";
                pointsEl.textContent = label
                    ? `${stat.total_points}${label}`
                    : String(stat.total_points);
                footer.appendChild(pointsEl);
            }
    
            // streak — still shown (0 with grey flame if never played)
            const streakStat = stat ?? { current_streak: 0, done_today: false };
    
            const streakEl = document.createElement("span");
            streakEl.className = "card-streak";
    
            const icon = document.createElement("img");
            icon.className = "streak-icon";
            icon.src = "https://cdn-icons-png.flaticon.com/256/8722/8722283.png";
            icon.alt = "";
    
            const count = document.createElement("span");
            count.className = "streak-count";
            count.textContent = streakStat.current_streak;
    
            streakEl.classList.toggle("zero",    streakStat.current_streak === 0);
            streakEl.classList.toggle("hot",     streakStat.done_today);
            streakEl.classList.toggle("at-risk", streakStat.current_streak > 0 && !streakStat.done_today);
    
            streakEl.appendChild(icon);
            streakEl.appendChild(count);
            footer.appendChild(streakEl);
        }

    li.classList.toggle("done", currentUser && isDone(url));

    li.appendChild(link);
    li.appendChild(thumbWrap);
    li.appendChild(footer);
    return li;
}

// ---------- recursive list renderer ----------

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

// ---------- top-level renderer ----------

function render(data) {
    const container = document.querySelector(".sections");
    container.innerHTML = "";

    for (const [sectionName, items] of Object.entries(data)) {
        const section = document.createElement("section");
        const h2 = document.createElement("h2");
        h2.textContent = sectionName;
        section.appendChild(h2);
        section.appendChild(renderList(items));
        container.appendChild(section);
    }
}

// ---------- kick off ----------

resetIfNewDay();

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