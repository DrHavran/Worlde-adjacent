// ---------- site icons ----------

/**
 * Central icon URLs, resolved relative to theme.js's own location
 * so they work from any page depth (root, /pages/*, etc).
 * Consumed as `SITE_ICONS.favicon` / `.friends` / `.streak` / `.placeholderUser`.
 */
var SITE_ICONS = (() => {
    const script = document.currentScript;
    const base = script ? new URL('.', script.src).href : location.href;
    return {
        favicon: base + 'images/icon.png',
        friends: base + 'images/friends-icon.png',
        streak:  base + 'images/streak-icon.png',
        placeholderUser: base + 'images/placeholder-user-icon.jpg',
    };
})();

// Auto-inject the favicon unless the page already declared one
if (!document.querySelector('link[rel~="icon"]')) {
    const link = document.createElement('link');
    link.rel  = 'icon';
    link.type = 'image/png';
    link.href = SITE_ICONS.favicon;
    document.head.appendChild(link);
}

// ---------- available designs ----------

/**
 * All designs the home page knows about.
 * Adding a new design requires: a CSS file under design/, a matching
 * <link> in index.html, and an entry here. If it supports keyboard
 * navigation, add it to KEYBOARD_DESIGNS too.
 * Order determines dropdown order.
 */
var DESIGNS = [
    { id: 'classic', name: 'Classic' },
    { id: 'modern',  name: 'Modern'  },
];

/**
 * Designs whose keyboard shortcuts (arrows, /, Y, B) should be active
 * on the home page. Designs not in this list ignore shortcuts.
 */
var KEYBOARD_DESIGNS = ['classic', 'modern'];

// Theme choices are shared by the home page and profile settings.
var THEMES = [
    { id: 'light', name: 'White', color: '#f6f7fb' },
    { id: 'dark', name: 'Dark', color: '#12121c' },
    { id: 'oled', name: 'OLED', color: '#000000' },
];

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme.id;
    let color = document.querySelector('meta[name="theme-color"]');
    if (!color) {
        color = document.createElement('meta');
        color.name = 'theme-color';
        document.head.appendChild(color);
    }
    color.content = theme.color;
}

// ---------- apply theme + design before paint ----------

/**
 * Applies the saved theme/design to <html> synchronously so the first
 * paint already matches. Runs in <head> — no flash of unstyled content.
 */
(() => {
    const THEME_KEY  = 'game-theme';
    const DESIGN_KEY = 'game-design';

    let theme = THEMES[0];
    try {
        const saved = localStorage.getItem(THEME_KEY);
        theme = THEMES.find(t => t.id === saved) || theme;
    } catch {}
    applyTheme(theme);

    let design = 'classic';
    try {
        const saved = localStorage.getItem(DESIGN_KEY);
        if (saved && DESIGNS.some(d => d.id === saved)) design = saved;
    } catch {}
    document.documentElement.dataset.design = design;
})();

// ---------- wire up controls after DOM ready ----------

/**
 * Wires up the theme button and design dropdown.
 * Both write to localStorage so the choice persists across visits.
 * Runs on DOMContentLoaded because the controls don't exist yet when
 * this script first executes from <head>.
 */
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.querySelector('#theme-toggle');
    if (themeToggle) {
        function nextTheme() {
            const current = THEMES.findIndex(t => t.id === document.documentElement.dataset.theme);
            return THEMES[(current + 1) % THEMES.length];
        }

        function updateThemeButton() {
            const next = nextTheme();
            themeToggle.textContent = `${next.name} mode`;
            themeToggle.title = `Switch to ${next.name} mode`;
        }

        updateThemeButton();
        themeToggle.addEventListener('click', () => {
            const theme = nextTheme();
            applyTheme(theme);
            try { localStorage.setItem('game-theme', theme.id); } catch {}
            updateThemeButton();
        });
    }

    const designSelect = document.querySelector('#design-select');
    if (designSelect) {
        // Populate the dropdown from DESIGNS (single source of truth)
        for (const d of DESIGNS) {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.name;
            designSelect.append(opt);
        }
        designSelect.value = document.documentElement.dataset.design;

        designSelect.addEventListener('change', () => {
            const next = designSelect.value;
            document.documentElement.dataset.design = next;
            try { localStorage.setItem('game-design', next); } catch {}
            document.dispatchEvent(new CustomEvent('designchange'));
            designSelect.blur();
        });

        // Escape closes the dropdown → return focus to the page
        // so keyboard shortcuts work immediately.
        designSelect.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') designSelect.blur();
        });
    }
});
