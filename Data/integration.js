// Log in

export const supabase = window.supabase.createClient(
    'https://lcwnjnjzhaccskqyhyjp.supabase.co',
    'sb_publishable_NE-iEaxSEAjSbnX1fcx4iw_7wt3F_90'
);

export async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

// User profile
export async function getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
}

export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function submitCheckIn(gameUrl, points) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const { error } = await supabase.from('check_ins').insert({
        user_id: user.id,
        game_url: gameUrl,
        points: points,
    });

    if (error) {
        // 23505 = unique_violation → already checked in today
        if (error.code === '23505') return { already: true };
        throw error;
    }
    return { already: false };
}

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

    const today = new Date().toISOString().slice(0, 10);
    const stats = new Map();

    for (const row of checkInsRes.data ?? []) {
        const e = stats.get(row.game_url) ?? { total_points: 0, current_streak: 0, done_today: false };
        e.total_points += row.points;
        if (row.checked_on === today) e.done_today = true;
        stats.set(row.game_url, e);
    }
    for (const row of streaksRes.data ?? []) {
        const e = stats.get(row.game_url) ?? { total_points: 0, current_streak: 0, done_today: false };
        e.current_streak = row.current_streak;
        stats.set(row.game_url, e);
    }
    return stats;   // Map<game_url, { total_points, current_streak, done_today }>
}