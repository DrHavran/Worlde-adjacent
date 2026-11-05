import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createGameState } from '../game-state.js';
import { validateCatalog } from '../catalog.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const source = read('index.js').replace(/^import .*;\n/gm, '').replace('import.meta.url', '"https://example.com/Worlde-adjacent/index.js"');
const catalog = JSON.parse(read('website.json'));

async function boot(t, { saved = {}, blocked = false, fail = false, data = catalog } = {}) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, {
        url: 'https://example.com/Worlde-adjacent/', runScripts: 'outside-only',
        pretendToBeVisual: true, virtualConsole,
    });
    const w = dom.window;
    t.after(() => { w.close(); assert.deepEqual(errors, []); });
    const $ = selector => w.document.querySelector(selector);
    for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
    if (blocked) Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
    w.createGameState = createGameState;
    w.validateCatalog = validateCatalog;
    const timers = [];
    w.setInterval = callback => timers.push(callback);
    w.fetch = async url => {
        assert.equal(String(url), 'https://example.com/Worlde-adjacent/website.json');
        return { ok: !fail, status: fail ? 503 : 200, json: async () => data };
    };
    for (const file of ['index.css', 'classic.css', 'modern.css']) {
        const style = w.document.createElement('style');
        style.textContent = read(file);
        w.document.head.append(style);
    }
    w.eval(read('design.js'));
    w.eval(read('theme.js'));
    w.eval(source);
    await new Promise(resolve => setImmediate(resolve));
    return {
        w, $, timers,
        key(key, target = w.document.body, repeat = false, extra = {}) {
            const event = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, repeat, ...extra });
            target.dispatchEvent(event);
            return event;
        },
        choose(value) {
            $('#design-select').value = value;
            $('#design-select').dispatchEvent(new w.Event('change'));
        },
        search(value) {
            $('#open-search').click();
            $('#game-search').value = value;
            $('#game-search').dispatchEvent(new w.Event('input'));
        },
    };
}

test('both layouts share completion, accessible streaks and theme preferences', async t => {
    const a = await boot(t);
    const { $, w } = a;
    assert.deepEqual([...$('#design-select').options].map(o => o.value), ['modern', 'classic']);
    assert.equal($('#game-name').textContent, 'Wordle');
    assert.equal($('#selected-streak').textContent, '🔥 0 days streak');
    assert.equal(w.getComputedStyle($('#classic')).display, 'none');
    a.key('y');
    assert.equal($('#selected-streak').textContent, '🔥 1 day streak');
    a.key('y', w.document.body, true);
    assert.equal($('#complete-game').getAttribute('aria-pressed'), 'true');
    a.choose('classic');
    assert.equal(w.getComputedStyle($('#dashboard')).display, 'none');
    const checkbox = $('.done-check input');
    assert.equal(checkbox.checked, true);
    assert.equal($('.card-streak').getAttribute('aria-label'), '1 day streak');
    checkbox.click();
    assert.equal($('#complete-game').getAttribute('aria-pressed'), 'false');
    a.choose('modern');
    assert.equal($('#selected-streak').textContent, '🔥 1 day streak');
    $('#theme-toggle').click();
    assert.equal(w.localStorage.getItem('game-theme'), 'light');
    assert.equal($('#theme-toggle').textContent, 'Dark mode');
});

test('keyboard navigation keeps tile focus and respects native controls and modified clicks', async t => {
    const a = await boot(t);
    const { $, w } = a;
    $('.game-tile').focus();
    a.key('ArrowRight', w.document.activeElement);
    assert.equal($('#game-name').textContent, 'Travle');
    assert.equal(w.document.activeElement, $('.game-tile.selected'));
    for (const selector of ['.channel', '#next', '#previous', '#theme-toggle', '#complete-game', '.game-tile.selected']) {
        assert.equal(a.key('Enter', $(selector)).defaultPrevented, false, selector);
    }
    let launched = 0;
    $('#play-game').addEventListener('click', event => { event.preventDefault(); launched++; });
    a.key('Enter');
    a.key('a');
    a.key('a', w.document.body, true);
    a.key('Enter', w.document.body, true);
    assert.equal(launched, 2);
    a.key('y', w.document.body, false, { ctrlKey: true });
    assert.equal($('#complete-game').getAttribute('aria-pressed'), 'false');
    const link = $('.game-tile');
    let intercepted;
    link.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); });
    link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    assert.equal(intercepted, false);
});

test('search handles category names, empty results and restores keyboard focus and selection', async t => {
    const a = await boot(t);
    const { $, w } = a;
    $('#next').click();
    $('.game-tile.selected').focus();
    a.key('/');
    assert.equal(w.document.activeElement, $('#game-search'));
    a.search('daily games');
    assert.equal($('.tiles').children.length, 11);
    a.search('flags');
    assert.equal($('.tiles').children.length, 7);
    a.key('ArrowDown', $('#game-search'));
    assert.equal($('#game-name').textContent, 'Flags of Europe');
    a.search('no-such-game');
    assert.equal($('#selected-streak').hidden, true);
    assert.equal($('#complete-game').disabled, true);
    assert.equal($('#play-game').hasAttribute('href'), false);
    a.key('Escape', $('#game-search'));
    assert.equal($('#game-name').textContent, 'Travle');
    assert.equal(w.document.activeElement, $('.game-tile.selected'));
});

test('background updates keep Original focus and expanded groups even with no search results', async t => {
    const data = { Games: [{ Group: [{ Test: 'https://example.com/game' }] }] };
    const a = await boot(t, { data });
    const { $, w } = a;
    a.choose('classic');
    $('details').open = true;
    const checkbox = $('.done-check input');
    checkbox.focus();
    w.localStorage.setItem('game-done:https://example.com/game', 'true');
    w.dispatchEvent(new w.StorageEvent('storage', { key: 'game-done:https://example.com/game' }));
    assert.equal(w.document.activeElement, checkbox);
    assert.equal($('details').open, true);
    assert.equal(checkbox.checked, true);
    a.search('no-match');
    w.localStorage.setItem('game-done-date', '2000-01-01');
    a.timers.forEach(tick => tick());
    assert.equal(w.localStorage.getItem('game-done:https://example.com/game'), null);
});

test('loading failures are visible in either layout; invalid catalogs fail safely', async t => {
    for (const design of ['classic', 'modern']) {
        const a = await boot(t, { saved: { 'game-design': design }, fail: true });
        assert.equal(a.$('#loading').hidden, false);
        assert.equal(a.$('#loading').getAttribute('role'), 'alert');
        assert.equal(a.$('#loading').closest('main'), null);
        assert.equal(a.$('#complete-game').disabled, true);
    }
    const a = await boot(t, { data: { Games: [{ Unsafe: 'javascript:alert(1)' }] } });
    assert.equal(a.$('#loading').getAttribute('role'), 'alert');
    assert.equal(a.$('.game-tile'), null);
});

test('design preferences migrate, opt out and tolerate blocked storage', async t => {
    for (const value of ['classic', 'modern', 'dashboard', 'tiled', 'invalid']) {
        const a = await boot(t, { saved: { 'game-design': value } });
        assert.equal(a.$('#design-select').value, value === 'classic' ? 'classic' : 'modern');
    }
    const a = await boot(t);
    a.choose('classic');
    assert.equal(a.w.localStorage.getItem('game-design'), 'classic');
    a.$('#remember-design').click();
    assert.equal(a.w.localStorage.getItem('game-design'), null);
    const disabled = await boot(t, { saved: { 'game-design': 'classic', 'game-remember-design': 'false' } });
    assert.equal(disabled.$('#design-select').value, 'modern');
    const blocked = await boot(t, { blocked: true });
    blocked.choose('classic');
    blocked.choose('modern');
    blocked.key('y');
    assert.equal(blocked.$('#selected-streak').textContent, '🔥 1 day streak');
});
