import { getSession, updatePassword } from '../../supabase/integration.js';

const form      = document.getElementById('change-password-form');
const info      = document.getElementById('info');
const passEl    = document.getElementById('new-password');
const confirmEl = document.getElementById('confirm-password');
const errorEl   = document.getElementById('error');

async function init() {
    const session = await getSession();

    if (!session) {
        info.textContent = 'You need to be logged in to change your password.';
        info.className = 'error';
        form.hidden = true;
        return;
    }

    info.hidden = true;
    form.hidden = false;
    passEl.focus();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const pw = passEl.value;
    const confirm = confirmEl.value;

    if (pw.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        return;
    }
    if (pw !== confirm) {
        errorEl.textContent = 'Passwords do not match.';
        return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        await updatePassword(pw);
        window.location.href = '../profile/profile.html';
    } catch (err) {
        errorEl.textContent = err.message || 'Failed to update password.';
        btn.disabled = false;
    }
});

init();