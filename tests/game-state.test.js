import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameState } from '../game-state.js';
import { validateCatalog } from '../catalog.js';

function fixture(saved = {}) {
    const data = { ...saved };
    const storage = new Proxy({
        getItem: key => data[key] ?? null,
        setItem: (key, value) => { data[key] = value; },
        removeItem: key => { delete data[key]; },
    }, { ownKeys: () => Object.keys(data), getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, writable: true }) });
    let time = '2026-11-05T23:59:59';
    const state = createGameState(() => storage, () => new Date(time));
    return { state, data, storage, at: value => { time = value; } };
}

test('midnight clears completions before interaction and retains preferences and streaks', () => {
    const f = fixture({ 'game-theme': 'light' });
    f.state.setDone('wordle', true);
    f.state.recordCompletion('wordle');
    f.at('2026-11-06T00:00:01');
    assert.equal(f.state.isDone('wordle'), false);
    assert.equal(f.state.streakFor('wordle').count, 1);
    f.state.setDone('wordle', true);
    f.state.recordCompletion('wordle');
    assert.equal(f.state.streakFor('wordle').count, 2);
    assert.equal(f.state.recordCompletion('wordle'), false);
    f.state.setDone('wordle', false);
    f.state.setDone('wordle', true);
    assert.equal(f.state.recordCompletion('wordle'), false);
    assert.equal(f.data['game-theme'], 'light');
    f.at('2026-11-08T12:00:00');
    assert.equal(f.state.streakFor('wordle').count, 0);
    f.state.recordCompletion('wordle');
    assert.equal(f.state.streakFor('wordle').count, 1);
});

test('calendar transitions work over month, year and daylight-saving boundaries', () => {
    for (const [previous, next] of [
        ['2026-12-31', '2027-01-01'], ['2028-02-29', '2028-03-01'],
        ['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02'],
    ]) {
        const f = fixture();
        f.at(`${previous}T12:00:00`);
        f.state.recordCompletion('wordle');
        f.at(`${next}T12:00:00`);
        f.state.recordCompletion('wordle');
        assert.equal(f.state.streakFor('wordle').count, 2);
    }
});

test('failed writes and removals use memory without reviving stale saved completions', () => {
    const f = fixture();
    f.state.setDone('wordle', true);
    f.storage.setItem = f.storage.removeItem = () => { throw new Error('quota'); };
    f.state.setDone('wordle', false);
    assert.equal(f.state.isDone('wordle'), false);
    f.state.setDone('wordle', true);
    f.at('2026-11-06T12:00:00');
    assert.equal(f.state.isDone('wordle'), false);
    const blocked = createGameState(() => { throw new Error('blocked'); });
    blocked.setDone('wordle', true);
    blocked.recordCompletion('wordle');
    assert.equal(blocked.isDone('wordle'), true);
    assert.equal(blocked.streakFor('wordle').count, 1);
});

test('corrupt streak values are ignored', () => {
    for (const value of ['invalid', null, { count: -1, last: '2026-11-05' },
        { count: 1.5, last: '2026-11-05' }, { count: 5, last: '2026-02-30' }]) {
        const f = fixture({ 'game-streak:wordle': JSON.stringify(value) });
        assert.equal(f.state.streakFor('wordle').count, 0);
        f.state.recordCompletion('wordle');
        assert.equal(f.state.streakFor('wordle').count, 1);
    }
});

test('catalog validates nested groups and rejects malformed or executable links', () => {
    const base = 'https://example.com/Worlde-adjacent/website.json';
    const valid = { Games: [{ Group: [{ Wordle: { url: 'https://example.com', thumb: 'images/wordle.png' } }] }] };
    assert.equal(validateCatalog(valid, base), valid);
    for (const value of [null, [], { Games: null }, { Games: [null] },
        { Games: [{ Bad: 'javascript:alert(1)' }] }, { Games: [{ Bad: { url: 'https://example.com', thumb: 'data:text/html,bad' } }] },
        { Games: [{ One: 'https://example.com', Two: 'https://example.com' }] }]) {
        assert.throws(() => validateCatalog(value, base));
    }
});
