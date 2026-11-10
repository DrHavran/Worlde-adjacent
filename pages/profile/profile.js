import {
    getSession, getUser, getProfile,
    updateProfile, searchUsers,
    getFollowing, fetchFollowedProfiles, follow, unfollow, logout,
} from '../../supabase/integration.js';

let currentUser = null;
let following = new Set();

const avatarPreview  = document.getElementById('avatar-preview');
const avatarInput    = document.getElementById('avatar-url');
const usernameInput  = document.getElementById('username');
const saveProfileBtn = document.getElementById('save-profile');
const profileMsg     = document.getElementById('profile-msg');

const searchInput   = document.getElementById('friend-search');
const searchResults = document.getElementById('search-results');
const friendsList   = document.getElementById('friends-list');

const logoutBtn     = document.getElementById('logout-btn');

// ---------- helpers ----------

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function showMsg(el, text, kind = 'ok') {
    el.textContent = text;
    el.className = `msg ${kind}`;
    setTimeout(() => {
        if (el.textContent === text) { el.textContent = ''; el.className = 'msg'; }
    }, 4000);
}

function updateAvatarPreview(url) {
    avatarPreview.onerror = null;   // reset in case previous src failed
    avatarPreview.src = url || SITE_ICONS.placeholderUser;
    avatarPreview.style.display = '';
}

// Fallback if the URL in the src fails to load
avatarPreview.addEventListener('error', () => {
    avatarPreview.onerror = null;
    if (avatarPreview.src !== SITE_ICONS.placeholderUser) {
        avatarPreview.src = SITE_ICONS.placeholderUser;
    }
});

function rowHtml(user, actionLabel, actionClass) {
    const avatarSrc = user.avatar_url || SITE_ICONS.placeholderUser;
    const avatar = `<img class="result-avatar" src="${escapeHtml(avatarSrc)}" alt="" onerror="this.onerror=null;this.src='${SITE_ICONS.placeholderUser}'">`;
    return `
        <li class="result-row">
            ${avatar}
            <span class="result-name">${escapeHtml(user.username)}</span>
            <button type="button"
                    class="result-btn ${actionClass}"
                    data-id="${user.id}">
                ${actionLabel}
            </button>
        </li>`;
}

// ---------- friends list ----------

async function renderFriendsList() {
    friendsList.innerHTML = '<li class="result-muted">Loading…</li>';
    try {
        const friends = await fetchFollowedProfiles(currentUser.id);
        if (!friends.length) {
            friendsList.innerHTML = '<li class="result-muted">No friends yet — search above to add some.</li>';
            return;
        }
        friendsList.innerHTML = friends
            .map(f => rowHtml(f, 'Unfollow', 'following'))
            .join('');
    } catch (err) {
        friendsList.innerHTML = `<li class="result-muted">${escapeHtml(err.message || 'Failed to load friends')}</li>`;
    }
}

// ---------- init ----------

async function init() {
    const session = await getSession();
    if (!session) {
        window.location.href = '../log-in/login.html';
        return;
    }
    currentUser = await getUser();

    const profile = await getProfile(currentUser.id);
    if (profile) {
        usernameInput.value = profile.username || '';
        avatarInput.value   = profile.avatar_url || '';
        updateAvatarPreview(profile.avatar_url);
    } else {
        updateAvatarPreview(null);
    }

    following = await getFollowing(currentUser.id);
    await renderFriendsList();
}

// ---------- profile ----------

avatarInput.addEventListener('input', () => updateAvatarPreview(avatarInput.value.trim()));

saveProfileBtn.addEventListener('click', async () => {
    const username   = usernameInput.value.trim();
    const avatar_url = avatarInput.value.trim() || null;

    if (username.length < 3 || username.length > 20) {
        showMsg(profileMsg, 'Username must be 3–20 characters.', 'err');
        return;
    }

    saveProfileBtn.disabled = true;
    try {
        await updateProfile(currentUser.id, { username, avatar_url });
        showMsg(profileMsg, 'Saved!', 'ok');
    } catch (err) {
        if (err.code === '23505') showMsg(profileMsg, 'Username already taken.', 'err');
        else showMsg(profileMsg, err.message || 'Failed to save.', 'err');
    } finally {
        saveProfileBtn.disabled = false;
    }
});

// ---------- friend search ----------

let searchTimeout = null;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => doSearch(q), 300);
});

async function doSearch(query) {
    searchResults.innerHTML = '<li class="result-muted">Searching…</li>';
    try {
        const users = await searchUsers(query);
        const others = users.filter(u => u.id !== currentUser.id);
        if (!others.length) {
            searchResults.innerHTML = '<li class="result-muted">No users found.</li>';
            return;
        }
        searchResults.innerHTML = others.map(u => {
            const isFollowing = following.has(u.id);
            return rowHtml(u, isFollowing ? 'Following' : 'Follow', isFollowing ? 'following' : '');
        }).join('');
    } catch (err) {
        searchResults.innerHTML = `<li class="result-muted">${escapeHtml(err.message || 'Search failed')}</li>`;
    }
}

// ---------- follow / unfollow ----------

async function toggleFollow(btn) {
    const id = btn.dataset.id;
    const isFollowing = following.has(id);
    btn.disabled = true;
    try {
        if (isFollowing) {
            await unfollow(currentUser.id, id);
            following.delete(id);
            btn.textContent = 'Follow';
            btn.classList.remove('following');
        } else {
            await follow(currentUser.id, id);
            following.add(id);
            btn.textContent = 'Following';
            btn.classList.add('following');
        }
        await renderFriendsList();
        const q = searchInput.value.trim();
        if (q.length >= 2) await doSearch(q);
    } catch (err) {
        alert(err.message || 'Failed to update follow');
    } finally {
        btn.disabled = false;
    }
}

searchResults.addEventListener('click', (e) => {
    const btn = e.target.closest('.result-btn');
    if (btn) toggleFollow(btn);
});

friendsList.addEventListener('click', (e) => {
    const btn = e.target.closest('.result-btn');
    if (btn) toggleFollow(btn);
});

// ---------- logout ----------

logoutBtn.addEventListener('click', async () => {
    await logout();
    window.location.href = '../../index.html';
});

// ---------- change password ----------

document.getElementById('change-password-btn').addEventListener('click', () => {
    window.location.href = '../change-password/change-password.html';
});

// ---------- go ----------

init();