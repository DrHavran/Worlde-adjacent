import { login } from '../../supabase/integration.js';

const form      = document.getElementById('login-form');
const emailEl   = document.getElementById('email');
const passEl    = document.getElementById('password');
const errorEl   = document.getElementById('error');
const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;

    try {
        await login(emailEl.value.trim(), passEl.value);
        window.location.href = '../../index.html';
    } catch (err) {
        errorEl.textContent = err.message || 'Login failed';
        submitBtn.disabled = false;
    }
});