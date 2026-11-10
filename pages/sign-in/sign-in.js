import { signUp, createProfile, isUsernameAvailable, logout } from '../../supabase/integration.js';

const form      = document.getElementById('sign-in-form');
const usernameEl = document.getElementById('username');
const emailEl   = document.getElementById('email');
const passwordEl = document.getElementById('password');
const confirmEl = document.getElementById('confirm-password');
const errorEl   = document.getElementById('error');
const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;

    const username = usernameEl.value.trim();
    const email    = emailEl.value.trim();
    const password = passwordEl.value;
    const confirm  = confirmEl.value;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        errorEl.textContent = 'Username: 3–20 characters, letters/numbers/underscore only.';
        submitBtn.disabled = false;
        return;
    }
    if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        submitBtn.disabled = false;
        return;
    }
    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match.';
        submitBtn.disabled = false;
        return;
    }

    try {
        // best-effort pre-check — the DB unique constraint is the real guard
        const available = await isUsernameAvailable(username);
        if (!available) {
            errorEl.textContent = 'Username already taken.';
            submitBtn.disabled = false;
            return;
        }

        const { user, session } = await signUp(email, password);

        if (!session) {
            // email confirmation required — user can't create their profile yet
            errorEl.textContent = 'Check your email to confirm, then log in.';
            return;
        }

        // create the profile row (user is now authenticated)
        try {
            await createProfile(user.id, username);
        } catch (err) {
            // rare race: someone else took the username between the pre-check and now
            if (err.code === '23505') {
                await logout();
                errorEl.textContent = 'That username just got taken. Try a different one (note: your email is now registered).';
            } else {
                errorEl.textContent = err.message || 'Could not create profile.';
            }
            submitBtn.disabled = false;
            return;
        }

        // success — go to profile
        window.location.href = '../profile/profile.html';
    } catch (err) {
        errorEl.textContent = err.message || 'Sign up failed.';
        submitBtn.disabled = false;
    }
});