// Keep the original storage keys so existing completions and streaks survive upgrades.
const DONE_PREFIX = 'game-done:';
const STREAK_PREFIX = 'game-streak:';
const DATE_KEY = 'game-done-date';

export function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createGameState(getStorage, now = () => new Date()) {
    // A null entry is a tombstone: failed removals must not revive stale saved data.
    const fallback = new Map();
    const storage = {
        get(key) {
            if (fallback.has(key)) return fallback.get(key);
            try { return getStorage().getItem(key); } catch { return null; }
        },
        write(key, value) {
            try {
                if (value === null) getStorage().removeItem(key);
                else getStorage().setItem(key, value);
                fallback.delete(key);
            } catch { fallback.set(key, value); }
        },
        keys() {
            let saved = [];
            try { saved = Object.keys(getStorage()); } catch { /* Optional storage. */ }
            return [...new Set([...saved, ...fallback.keys()])];
        },
    };

    function dates() {
        const date = new Date(now());
        const today = dateKey(date);
        date.setDate(date.getDate() - 1);
        return { today, yesterday: dateKey(date) };
    }

    function resetIfNewDay() {
        const { today } = dates();
        if (storage.get(DATE_KEY) === today) return false;
        for (const key of storage.keys()) {
            if (key.startsWith(DONE_PREFIX)) storage.write(key, null);
        }
        storage.write(DATE_KEY, today);
        return true;
    }

    function loadStreak(url) {
        try {
            const value = JSON.parse(storage.get(STREAK_PREFIX + url));
            if (Number.isSafeInteger(value?.count) && value.count > 0 &&
                typeof value.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.last) &&
                dateKey(new Date(`${value.last}T12:00:00`)) === value.last) return value;
        } catch { /* Missing or corrupt data starts a fresh streak. */ }
        return { count: 0, last: null };
    }

    return {
        resetIfNewDay,
        isDone(url) {
            resetIfNewDay();
            return storage.get(DONE_PREFIX + url) === 'true';
        },
        setDone(url, done) {
            resetIfNewDay();
            storage.write(DONE_PREFIX + url, done ? 'true' : null);
        },
        recordCompletion(url) {
            resetIfNewDay();
            const streak = loadStreak(url);
            const { today, yesterday } = dates();
            if (streak.last === today) return false;
            const count = streak.last === yesterday ? Math.min(streak.count + 1, Number.MAX_SAFE_INTEGER) : 1;
            storage.write(STREAK_PREFIX + url, JSON.stringify({ count, last: today }));
            return true;
        },
        streakFor(url) {
            const streak = loadStreak(url);
            const { today, yesterday } = dates();
            const count = [today, yesterday].includes(streak.last) ? streak.count : 0;
            return { count, doneToday: streak.last === today, label: `${count} ${count === 1 ? 'day' : 'days'} streak` };
        },
    };
}
