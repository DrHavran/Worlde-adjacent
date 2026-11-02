// Apply the saved preference before the stylesheet paints the page.
(() => {
    const storageKey = "game-theme";
    let theme = "dark";
    try {
        if (localStorage.getItem(storageKey) === "light") theme = "light";
    } catch { /* The switch still works when browser storage is unavailable. */ }

    document.documentElement.dataset.theme = theme;

    document.addEventListener("DOMContentLoaded", () => {
        const toggle = document.querySelector("#theme-toggle");
        function updateButton() {
            const light = document.documentElement.dataset.theme === "light";
            toggle.textContent = "Light mode";
            toggle.setAttribute("aria-pressed", String(light));
            toggle.title = light ? "Switch to dark mode" : "Switch to light mode";
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
