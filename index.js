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
    return localStorage.getItem(STORAGE_PREFIX + url) === "true";
}

function setDone(url, done) {
    if (done) localStorage.setItem(STORAGE_PREFIX + url, "true");
    else localStorage.removeItem(STORAGE_PREFIX + url);
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
    if (localStorage.getItem(STORAGE_DATE_KEY) === today) return;

    Object.keys(localStorage)
        .filter(k => k.startsWith(STORAGE_PREFIX))
        .forEach(k => localStorage.removeItem(k));

    localStorage.setItem(STORAGE_DATE_KEY, today);
}

// ---------- completed-day streak (per game, gaps do not erase progress) ----------

const STREAK_PREFIX = "game-streak:"; // not caught by the "game-done:" wipe above

function loadStreak(url) {
    try {
        const parsed = JSON.parse(localStorage.getItem(STREAK_PREFIX + url));
        if (parsed && Number.isFinite(parsed.count) && typeof parsed.last === "string") {
            return { count: parsed.count, last: parsed.last };
        }
    } catch { /* missing or corrupt → fresh start */ }
    return { count: 0, last: null };
}

function saveStreak(url, streak) {
    localStorage.setItem(STREAK_PREFIX + url, JSON.stringify(streak));
}

/* Count each completed day once, keeping progress across missed days. */
function recordCompletion(url) {
    const streak = loadStreak(url);
    const today = todayKey();
    if (streak.last === today) return false; // already counted today
    streak.count += 1;
    streak.last = today;
    saveStreak(url, streak);
    return true;
}

// ---------- one game card ----------

function createCard(name, entry) {
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
        const count = streak.count;

        streakCount.textContent = count;
        streakEl.title = `${count} completed ${count === 1 ? "day" : "days"} — progress is kept if you miss a day`;
        streakEl.setAttribute("aria-label", streakEl.title);
        streakEl.classList.toggle("zero", count === 0);
        streakEl.classList.toggle("hot", doneToday);
        streakEl.classList.toggle("pending", count > 0 && !doneToday);

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
    });

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

getData("website.json")
    .then(render)
    .catch((err) => {
        console.error(err);
        document.querySelector(".sections").textContent =
            "Failed to load games. Check the console.";
    });
