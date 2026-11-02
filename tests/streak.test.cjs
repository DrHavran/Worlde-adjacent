const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
    .split('// ---------- kick off ----------')[0]
    .replace('import.meta.url', '"https://example.com/index.js"');
const url = 'https://example.com/game';

class Element {
    constructor() {
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.classes = new Set();
        this.classList = {
            toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
            add: name => this.classes.add(name),
            remove: name => this.classes.delete(name),
        };
    }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
}

function browser(storage = {}) {
    let date = new Date(2026, 10, 2, 12);
    Object.defineProperties(storage, {
        getItem: { configurable: true, value: key => storage[key] ?? null },
        setItem: { configurable: true, value: (key, value) => { storage[key] = String(value); } },
        removeItem: { configurable: true, value: key => { delete storage[key]; } },
    });
    const context = vm.createContext({
        Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date])); } },
        URL,
        document: { createElement: () => new Element() },
        localStorage: storage,
    });
    vm.runInContext(source, context);
    return {
        storage,
        run: code => vm.runInContext(code, context),
        advance: days => { date.setDate(date.getDate() + days); },
        card: () => context.createCard('Game', url),
    };
}

const complete = app => app.run(`recordCompletion('${url}')`);
const count = app => app.run(`loadStreak('${url}').count`);
const badge = card => card.children[2].children[2];

test('saved count stays visible after missed days and a reload', () => {
    const app = browser();
    complete(app);
    app.advance(4);
    assert.equal(badge(app.card()).children[1].textContent, 1);
    assert(badge(app.card()).classes.has('pending'));
    const reopened = browser(app.storage);
    reopened.advance(4);
    assert.equal(badge(reopened.card()).children[1].textContent, 1);
    complete(reopened);
    assert.equal(count(reopened), 2);
});

test('existing streak data survives gaps and increments without migration', () => {
    const app = browser({ ['game-streak:' + url]: JSON.stringify({ count: 12, last: '2026-09-01' }) });
    assert.equal(badge(app.card()).children[1].textContent, 12);
    complete(app);
    assert.equal(count(app), 13);
    assert(badge(app.card()).classes.has('hot'));
});

test('checkbox toggles and reloads cannot count the same day twice', () => {
    const app = browser();
    const checkbox = app.card().children[2].children[0].children[0];
    for (const checked of [true, false, true]) {
        checkbox.checked = checked;
        checkbox.listeners.change();
    }
    assert.equal(count(app), 1);
    const reopened = browser(app.storage);
    assert.equal(reopened.card().children[2].children[0].children[0].checked, true);
    assert.equal(complete(reopened), false);
    assert.equal(count(reopened), 1);
    reopened.advance(1);
    assert.equal(complete(reopened), true);
    assert.equal(count(reopened), 2);
});

test('daily checkbox reset preserves streak and theme data', () => {
    const app = browser({ 'game-theme': 'light' });
    app.run('resetIfNewDay()');
    app.run(`setDone('${url}', true)`);
    complete(app);
    app.advance(2);
    app.run('resetIfNewDay()');
    assert.equal(app.run(`isDone('${url}')`), false);
    assert.equal(count(app), 1);
    assert.equal(app.storage['game-theme'], 'light');
});
