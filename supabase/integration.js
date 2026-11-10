export const supabase = window.supabase.createClient(
    'https://lcwnjnjzhaccskqyhyjp.supabase.co',
    'sb_publishable_NE-iEaxSEAjSbnX1fcx4iw_7wt3F_90'
);

export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

export async function getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
}


// Send login request
export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
}

// Logout of your account
export async function logout() {
    await supabase.auth.signOut();
}

// Get your profile
export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

// Submit your points for a game
export async function submitCheckIn(gameUrl, points) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const { error } = await supabase.from('check_ins').insert({
        user_id: user.id,
        game_url: gameUrl,
        points: points,
    });

    if (error) {
        if (error.code === '23505') return { already: true };
        throw error;
    }
    return { already: false };
}

// Fetches the user stats for games
export async function fetchUserStats(userId) {
    const [checkInsRes, streaksRes] = await Promise.all([
        supabase.from('check_ins')
            .select('game_url, points, checked_on')
            .eq('user_id', userId),
        supabase.from('current_streaks')
            .select('game_url, current_streak')
            .eq('user_id', userId),
    ]);
    if (checkInsRes.error) throw checkInsRes.error;
    if (streaksRes.error)   throw streaksRes.error;

    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const stats = new Map();

    for (const row of checkInsRes.data ?? []) {
        const e = stats.get(row.game_url) ?? { today_points: null, current_streak: 0, done_today: false };
        if (row.checked_on === today) {
            e.today_points = row.points;
            e.done_today   = true;
        }
        stats.set(row.game_url, e);
    }
    for (const row of streaksRes.data ?? []) {
        const e = stats.get(row.game_url) ?? { today_points: null, current_streak: 0, done_today: false };
        e.current_streak = row.current_streak;
        stats.set(row.game_url, e);
    }
    return stats;
}

// Fetch your friends scores
export async function fetchFriendsForGame(gameUrl) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // followers of me → friend ids. No FK join, so no schema-cache dependency.
    const { data: follows, error: fErr } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', user.id);
    if (fErr) throw fErr;

    const friendIds = follows?.map(f => f.followee_id) ?? [];
    const allIds = [user.id, ...friendIds];   // self + friends

    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const [profilesRes, todayRes, streakRes] = await Promise.all([
        supabase.from('profiles')
            .select('id, username, avatar_url')
            .in('id', allIds),
        supabase.from('check_ins')
            .select('user_id, points')
            .eq('game_url', gameUrl)
            .eq('checked_on', today)
            .in('user_id', allIds),
        supabase.from('current_streaks')
            .select('user_id, current_streak')
            .eq('game_url', gameUrl)
            .in('user_id', allIds),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (todayRes.error)    throw todayRes.error;
    if (streakRes.error)   throw streakRes.error;

    const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p]));
    const todayMap   = new Map((todayRes.data   ?? []).map(r => [r.user_id, r.points]));
    const streakMap  = new Map((streakRes.data  ?? []).map(r => [r.user_id, r.current_streak]));

    return allIds
        .map(id => {
            const profile = profileMap.get(id);
            if (!profile) return null;
            const played = todayMap.has(id);
            return {
                user_id:    id,
                username:   profile.username,
                avatar_url: profile.avatar_url,
                played,
                points:     played ? todayMap.get(id) : null,
                streak:     streakMap.get(id) ?? 0,
                isSelf:     id === user.id,
            };
        })
        .filter(Boolean);
}

// Update your profile
export async function updateProfile(userId, updates) {
    const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);
    if (error) throw error;
}

// Update your password
export async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

// Search thru users
export async function searchUsers(query) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${query}%`)
        .limit(20);
    if (error) throw error;
    return data || [];
}

// Get the users you are following
export async function getFollowing(userId) {
    const { data, error } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', userId);
    if (error) throw error;
    return new Set((data ?? []).map(r => r.followee_id));
}

// Follow a new person
export async function follow(followerId, followeeId) {
    const { error } = await supabase
        .from('follows')
        .insert({ follower_id: followerId, followee_id: followeeId });
    if (error && error.code !== '23505') throw error;
}

// Unfollow a person
export async function unfollow(followerId, followeeId) {
    const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('followee_id', followeeId);
    if (error) throw error;
}

// Fetch other people profiles
export async function fetchFollowedProfiles(userId) {
    const { data: follows, error: fErr } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', userId);
    if (fErr) throw fErr;
    if (!follows?.length) return [];

    const ids = follows.map(f => f.followee_id);
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', ids);
    if (pErr) throw pErr;

    const order = new Map(ids.map((id, i) => [id, i]));
    return (profiles ?? []).sort((a, b) => order.get(a.id) - order.get(b.id));
}

// Create a new account (email + password)
export async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;   // { user, session }
}

// Create the profile row for a freshly-signed-up user
export async function createProfile(userId, username, avatarUrl = null) {
    const { error } = await supabase
        .from('profiles')
        .insert({ id: userId, username, avatar_url: avatarUrl });
    if (error) throw error;
}

// Check if a username is still free (best-effort, pre-flight)
export async function isUsernameAvailable(username) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();
    if (error) throw error;
    return !data;
}