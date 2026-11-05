// ---------- "done" state (per-URL, per-browser) ----------

const STORAGE_PREFIX = "game-done:";

export function isDone(url) {
    return localStorage.getItem(STORAGE_PREFIX + url) === "true";
}

export function setDone(url, done) {
    if (done) localStorage.setItem(STORAGE_PREFIX + url, "true");
    else localStorage.removeItem(STORAGE_PREFIX + url);
}

// ---------- daily reset ----------

const STORAGE_DATE_KEY = "game-done-date"; // no colon → not caught by the wipe below

export function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function resetIfNewDay() {
    const today = todayKey();
    if (localStorage.getItem(STORAGE_DATE_KEY) === today) return;

    Object.keys(localStorage)
        .filter(k => k.startsWith(STORAGE_PREFIX))
        .forEach(k => localStorage.removeItem(k));

    localStorage.setItem(STORAGE_DATE_KEY, today);
}

// ---------- daily streak (per game) ----------

export const STREAK_PREFIX = "game-streak:"; // not caught by the "game-done:" wipe above

export function loadStreak(url) {
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

export function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/* first tick of the day → +1 (or reset to 1 if the chain broke) */
export function recordCompletion(url) {
    const streak = loadStreak(url);
    const today = todayKey();
    if (streak.last === today) return false; // already counted today
    streak.count = (streak.last === yesterdayKey()) ? streak.count + 1 : 1;
    streak.last = today;
    saveStreak(url, streak);
    return true;
}