/**
 * This file applies dark/white theme and the visualization of the page + stores ICON links for them to be applied everywhere on change
 * Both get saved to cookies so the user doesn't have to constantly change
 */
(() => {
    const storageKey = "game-theme";
    let theme = "dark";
    try {
        if (localStorage.getItem(storageKey) === "light") theme = "light";
    } catch { /* The switch still works when browser storage is unavailable. */ }

    document.documentElement.dataset.theme = theme;

    document.addEventListener("DOMContentLoaded", () => {
        const toggle = document.querySelector("#theme-toggle");
        if (!toggle) return;
        function updateButton() {
            const light = document.documentElement.dataset.theme === "light";
            toggle.textContent = light ? "Dark mode" : "White mode";
            toggle.title = light ? "Switch to dark mode" : "Switch to white mode";
        }
        updateButton();
        toggle.addEventListener("click", () => {
            theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
            document.documentElement.dataset.theme = theme;
            try { localStorage.setItem(storageKey, theme); } catch { /* Optional persistence. */ }
            updateButton();
        });
    });
})();

/**
 * Strips the url and provides the correct link
 */
var SITE_ICONS = (() => {
    const script = document.currentScript;
    const base = script ? new URL('.', script.src).href : location.href;
    return {
        favicon: base + 'images/icon.png',
        friends: base + 'images/friends-icon.png',
        streak:  base + 'images/streak-icon.png',
    };
})();

// inject the favicon if the page doesn't already declare one
if (!document.querySelector('link[rel~="icon"]')) {
    const link = document.createElement('link');
    link.rel  = 'icon';
    link.type = 'image/png';
    link.href = SITE_ICONS.favicon;
    document.head.appendChild(link);
}