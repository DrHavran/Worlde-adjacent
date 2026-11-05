// Restore the design before styles paint. Theme and design are independent.
(() => {
    const designKey = 'game-design';
    const rememberKey = 'game-remember-design';
    let remember = true;
    let design = 'modern';
    try {
        remember = localStorage.getItem(rememberKey) !== 'false';
        const saved = localStorage.getItem(designKey);
        if (remember && ['classic', 'modern'].includes(saved)) design = saved;
        else if (remember && saved) localStorage.setItem(designKey, 'modern');
    } catch { /* The switch works for this visit if storage is unavailable. */ }
    document.documentElement.dataset.design = design;
    document.addEventListener('DOMContentLoaded', () => {
        const select = document.querySelector('#design-select');
        const checkbox = document.querySelector('#remember-design');
        select.value = design;
        checkbox.checked = remember;
        function savePreference() {
            try {
                localStorage.setItem(rememberKey, String(checkbox.checked));
                if (checkbox.checked) localStorage.setItem(designKey, select.value);
                else localStorage.removeItem(designKey);
                checkbox.title = checkbox.checked ? 'Your design will be restored next time' : 'Use the default design on your next visit';
            } catch {
                checkbox.title = 'Browser storage is unavailable; your choice applies to this visit';
            }
        }
        select.addEventListener('change', () => {
            document.documentElement.dataset.design = select.value;
            savePreference();
            document.dispatchEvent(new CustomEvent('designchange'));
        });
        checkbox.addEventListener('change', savePreference);
    });
})();
