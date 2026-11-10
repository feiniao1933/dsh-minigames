/**
 * Node smoke test for the built Client bundle.
 *
 * The browser artifact cannot be imported as ESM, so the test build exposes the
 * component/state internals; this script materializes the factory against a
 * stubbed `window`/`document`, runs `apply` against a fake Cordis context, and
 * server-renders the game page and the victory layer. That catches the two
 * failures slot inspection cannot: a factory that throws while registering, and
 * a component that throws on its first render (which blanks the slot entry).
 *
 * React must be available to the test process. It is not part of this package;
 * install it once into a scratch directory and point the test at it:
 *
 *   npm install --prefix /tmp/dsh-minigames-testdeps react@18.3.1 react-dom@18.3.1
 *   node build.mjs --test && node smoke/ui.smoke.mjs
 *
 * Without React the test reports SKIPPED instead of failing the package.
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REACT_DIR = process.env.MG_TEST_REACT_DIR ?? '/tmp/dsh-minigames-testdeps';
const requireFrom = createRequire(`${REACT_DIR}/package.json`);
if (!existsSync(`${REACT_DIR}/node_modules/react/package.json`)) {
  process.stdout.write(`SKIPPED: React not installed in ${REACT_DIR}\n`);
  process.exit(0);
}
const React = requireFrom('react');
const { renderToStaticMarkup } = requireFrom('react-dom/server');

/* ------------------------------------------------------------------ stubs */

const loaded = [];
globalThis.window = {
  __ModuleLoader__: {
    load(record) {
      loaded.push(record);
    },
  },
  localStorage: (() => {
    const store = new Map();
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
  })(),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
};

const bundlePath = fileURLToPath(new URL('./.client.test-build.js', import.meta.url));
new Function(readFileSync(bundlePath, 'utf8'))();

assert.equal(loaded.length, 1, 'bundle must register exactly one module factory');
assert.equal(loaded[0].id, 'dsh-minigames');
const moduleExports = loaded[0].factory((id) => requireFrom(id));
assert.equal(typeof moduleExports.apply, 'function');
assert.ok(Array.isArray(moduleExports.inject));

/* ------------------------------------------------------------ fake Cordis */

const registeredTypes = [];
const registrations = [];
const disposers = [];
const localeRegistrations = [];
const fakeLocale = {
  bind: () => makeTranslate('zh'),
  register: (namespace, dicts) => {
    localeRegistrations.push({ namespace, dicts });
    return () => {};
  },
};
const openedTabs = [];
const fakeCtx = {
  sidebarRight: {
    openTab(kind) {
      openedTabs.push(kind);
    },
  },
  effect(callback) {
    const dispose = callback();
    disposers.push(dispose);
    return dispose;
  },
  locale: fakeLocale,
  sidebarRightTabs: {
    register(definition) {
      registeredTypes.push(definition);
      return () => {};
    },
  },
  slots: {
    inject(key, callback) {
      callback();
      return () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

function makeTranslate(localeId) {
  return (key, params) => {
    const table = localeDicts[localeId] ?? localeDicts.en;
    let text = table[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

/* The dictionaries live inside the bundle; read them back through a bound
 * translate so the test asserts real copy rather than duplicating it. */
const localeDicts = {};
moduleExports.apply(fakeCtx);
assert.equal(localeRegistrations.length, 1, 'apply registers one dictionary set');
assert.equal(localeRegistrations[0].namespace, 'minigames');
Object.assign(localeDicts, localeRegistrations[0].dicts);

/* ------------------------------------------------------- registration face */

assert.equal(registeredTypes.length, 1, 'one tab type registered');
const type = registeredTypes[0];
assert.equal(type.kind, 'minigames');
assert.equal(type.id, 'dsh-minigames');
assert.equal(type.multiple, false);
assert.equal(type.keepMounted, true);
assert.equal(typeof type.title, 'function');
assert.ok(type.title().length > 0);
assert.ok(Array.isArray(type.guide) && type.guide.length === 1, 'one Start-page capsule');
const capsule = type.guide[0];
assert.equal(capsule.id, 'gomoku');
assert.equal(typeof capsule.order, 'number');
assert.ok(capsule.title().length > 0);
assert.ok(capsule.description().length > 0);
assert.equal(typeof capsule.icon, 'function');

const slotNames = registrations.map((entry) => `${entry.options.name}|${entry.options.key ?? entry.options.id}`);
for (const expected of [
  'sidebar.right.pane.tab|dsh-minigames',
  'sidebar.right.pane.tab.title|dsh-minigames',
  'shell.overlay|dsh-minigames-celebration',
  'conversation.input.left|dsh-minigames-launcher',
]) {
  assert.ok(slotNames.includes(expected), `missing slot registration: ${expected}`);
}
assert.equal(registrations.length, 4);


/* ------------------------------------------------------------ render check */

const t = makeTranslate('zh');

/* The composer launcher opens the right-sidebar tab through the navigation face. */
const Launcher = moduleExports.__test.createLauncher(fakeCtx);
const launcher = Launcher({ t });
assert.equal(launcher.type, 'button');
assert.equal(launcher.props['aria-label'], '打开游戏盒子');
assert.ok(launcher.props.title.length > 0);
launcher.props.onClick();
assert.deepEqual(openedTabs, ['minigames'], 'launcher opens the game-box tab');

const html = renderToStaticMarkup(React.createElement(moduleExports.__test.GameBoxBody, { t }));
assert.ok(html.includes('class="mgRoot"'), 'game page renders its root');
assert.equal((html.match(/mgHitCell/g) ?? []).length, 225, 'board renders 225 playable cells');
assert.equal((html.match(/<line/g) ?? []).length, 30, 'board renders 15 + 15 grid lines');
assert.equal((html.match(/mgGridRow/g) ?? []).length, 15, 'board exposes 15 ARIA rows');
assert.ok(html.includes('五子棋'), 'active game card is labelled');
assert.ok(html.includes('难度'), 'difficulty row is labelled');
assert.equal((html.match(/mgSegBtn/g) ?? []).length, 3, 'three difficulty choices render');
for (const label of ['简单', '普通', '困难']) assert.ok(html.includes(label), `difficulty option ${label} renders`);
assert.ok(html.includes('aria-pressed="true"'), 'hard is the pressed option');
assert.ok(html.includes('mgIconBtn'), 'sound toggle renders');
assert.ok(html.includes('关闭音效'), 'sound toggle is on by default');
assert.ok(html.includes('轮到你落子'), 'human moves first');
assert.ok(html.includes('重新开始') && html.includes('悔棋'), 'controls are present');
assert.ok(html.includes('aria-label="五子棋棋盘'), 'board is labelled for assistive tech');

const titleHtml = renderToStaticMarkup(
  React.createElement(moduleExports.__test.GameBoxTitle, { useTabInfo: () => ({ tab: { title: '游戏盒子' } }) }),
);
assert.ok(titleHtml.includes('游戏盒子') && titleHtml.includes('<svg'));

/* --------------------------------------------------------- celebration */

const { celebration } = moduleExports.__test;
assert.equal(renderToStaticMarkup(React.createElement(moduleExports.__test.CelebrationLayer)), '');
celebration.trigger({
  kicker: '胜利',
  title: '你赢了！',
  subtitle: '五子棋 · 困难难度',
  stats: '用 26 手赢下对局 · 2:14',
  again: '再来一局',
  dismiss: '继续看看',
  onAgain() {},
});
const overlay = renderToStaticMarkup(React.createElement(moduleExports.__test.CelebrationLayer));
assert.ok(overlay.includes('你赢了！'), 'victory title renders');
assert.ok(overlay.includes('再来一局'), 'replay control renders');
assert.ok(overlay.includes('mgoConfetti'), 'confetti layer renders');
assert.ok(overlay.includes('mgoSpark'), 'firework sparks render');
assert.ok(overlay.includes('mgoTrophy'), 'trophy artwork renders');
assert.ok(overlay.includes('pointer-events:none'), 'celebration layer cannot swallow pointer input');
celebration.dismiss();
assert.equal(renderToStaticMarkup(React.createElement(moduleExports.__test.CelebrationLayer)), '');

/* ------------------------------------------------------- game transition */

const { createGame, applyMove, undoMove, elapsedSeconds, emergencyMove } = moduleExports.__test;
const prefs = moduleExports.__test;
assert.deepEqual(prefs.DIFFICULTY_ORDER, ['easy', 'normal', 'hard']);
for (const id of prefs.DIFFICULTY_ORDER) {
  assert.ok(prefs.DIFFICULTIES[id].maxDepth <= 6 && prefs.DIFFICULTIES[id].timeBudgetMs <= 430);
}
assert.equal(prefs.readDifficulty(), 'hard', 'difficulty defaults to hard');
assert.equal(prefs.readSound(), true, 'sound defaults to on');
prefs.writeDifficulty('normal');
assert.equal(prefs.readDifficulty(), 'normal', 'difficulty round-trips through storage');
prefs.writeDifficulty('hard');
prefs.writeSound(false);
assert.equal(prefs.readSound(), false, 'sound preference round-trips');
prefs.writeSound(true);
assert.equal(emergencyMove(createGame().board), 112, 'fallback AI move starts at the centre');
const nearlyFull = createGame().board;
nearlyFull.fill(1);
nearlyFull[0] = 0;
assert.equal(emergencyMove(nearlyFull), 0, 'fallback AI move finds the last legal point');
const fullBoard = createGame().board;
fullBoard.fill(1);
assert.equal(emergencyMove(fullBoard), -1, 'fallback AI move reports no point on a full board');
let game = createGame();
assert.equal(game.phase, 'playing');
assert.equal(game.turn, 1);

/* A human win on the top row: H,H,H,H,H interleaved with AI stones. */
const humanSequence = [0, 1, 2, 3, 4];
const aiSequence = [30, 31, 32, 33];
for (let i = 0; i < humanSequence.length; i += 1) {
  game = applyMove(game, humanSequence[i], 1);
  if (game.phase !== 'playing') break;
  game = applyMove(game, aiSequence[i], 2);
}
assert.equal(game.phase, 'won');
assert.equal(game.history.length, 9);
assert.ok(Array.isArray(game.winLine) && game.winLine.length >= 5, 'winning line is reported');
assert.ok(elapsedSeconds(game) >= 0);

/* Illegal moves must be inert. */
const before = game;
assert.equal(applyMove(game, 0, 1), before, 'occupied cell rejected');
assert.equal(applyMove(game, 225, 1), before, 'out-of-range cell rejected');

let fresh = createGame();
fresh = applyMove(fresh, 5, 1);
fresh = applyMove(fresh, 100, 2);
assert.equal(fresh.turn, 1);
const undone = undoMove(fresh);
assert.equal(undone.history.length, 0);
assert.equal(undone.board[5], 0);
assert.equal(undone.board[100], 0);
assert.equal(undoMove(fresh).board[5], 0, 'undo restores both stones');
assert.equal(undoMove(createGame()).history.length, 0, 'undo on empty game is inert');

/* All effect disposers must run without throwing. */
for (const dispose of disposers) if (typeof dispose === 'function') dispose();

process.stdout.write('PASS: ui smoke test (registration, render, celebration, game transitions)\n');
