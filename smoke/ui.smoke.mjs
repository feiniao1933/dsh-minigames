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
      removeItem: (key) => store.delete(key),
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

/* Second game: WeChat-style sky shooter */
assert.equal((html.match(/class="mgCard"/g) ?? []).length, 3, 'three playable games in the shelf');
assert.ok(html.includes('打飞机'), 'sky shooter card renders');
assert.ok(html.includes('经典复刻'), 'sky shooter card describes itself');
assert.ok(html.includes('鲸鱼飞飞'), 'flappy whale card renders');
assert.ok(html.includes('海底飞行'), 'flappy whale card describes itself');
assert.ok(html.includes('mgMore'), 'the "more games" placeholder renders');
assert.ok(html.includes('mgPanePlane'), 'the arcade pane is mounted');
assert.ok(html.includes('mgPlaneCanvas'), 'the arcade canvas is mounted');
assert.ok(html.includes('mgPaneFlappy'), 'the flappy pane is mounted');
assert.equal((html.match(/mgPlaneCanvas/g) ?? []).length, 2, 'both canvas games mount their screens');
assert.ok(html.includes('开始游戏'), 'the arcade idle overlay offers a start button');
assert.ok(html.includes('拖动移动'), 'the arcade hint renders');
assert.ok(html.includes('hidden=""'), 'the inactive pane is hidden from layout');

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

/* Preferences + arcade simulation through the built bundle */
assert.deepEqual(prefs.GAME_ORDER, ['gomoku', 'plane', 'flappy']);
assert.equal(prefs.readActiveGame(), 'gomoku', 'gomoku is the default game');
prefs.writeActiveGame('plane');
assert.equal(prefs.readActiveGame(), 'plane', 'selected game round-trips');
prefs.writeActiveGame('gomoku');
assert.equal(prefs.readPlaneBest(), 0, 'plane best starts at zero');
prefs.writePlaneBest(321);
assert.equal(prefs.readPlaneBest(), 321, 'plane best persists');
prefs.writePlaneBest(100);
assert.equal(prefs.readPlaneBest(), 321, 'plane best never regresses');

const planeSim = prefs.plane;
const shooter = planeSim.createPlaneState(7);
planeSim.startPlane(shooter, { best: 0 });
assert.equal(shooter.phase, 'running');
for (let i = 0; i < 600; i += 1) planeSim.stepPlane(shooter, 1 / 60);
assert.ok(shooter.elapsed > 9.9 && shooter.bullets.length > 0, 'arcade simulation steps inside the bundle');
assert.ok(shooter.score >= 0 && Number.isFinite(shooter.score));
const beforeScore = shooter.score;
planeSim.pausePlane(shooter);
for (let i = 0; i < 60; i += 1) planeSim.stepPlane(shooter, 1 / 60);
assert.equal(shooter.score, beforeScore, 'paused arcade simulation does not advance');
planeSim.resumePlane(shooter);
assert.equal(shooter.phase, 'running');
const startX = shooter.player.x;
planeSim.movePlayerBy(shooter, -30, 0);
assert.ok(shooter.player.x < startX, 'arcade input moves the plane');

/* Enemy fire through the built bundle: a fighter in the play area must shoot. */
const shooter2 = planeSim.createPlaneState(9);
planeSim.startPlane(shooter2, { best: 0 });
shooter2.spawnTimer = 9999;
shooter2.fireTimer = 9999;
shooter2.enemies.push({
  id: 500,
  type: 'fighter',
  x: 120,
  y: 120,
  width: 32,
  height: 34,
  hp: 3,
  maxHp: 3,
  vx: 0,
  drift: 0,
  phase: 0,
  fireTimer: 0.02,
});
shooter2.player.x = 300;
planeSim.stepPlane(shooter2, 0.05);
assert.ok(Array.isArray(shooter2.enemyBullets) && shooter2.enemyBullets.length === 1, 'enemy fire runs through the bundle');
assert.ok(shooter2.enemyBullets[0].vy > 0 && shooter2.enemyBullets[0].vx > 0, 'enemy bullet aims down at the player');
assert.ok(shooter2.lastEvents.some((event) => event.type === 'enemy-shot'), 'enemy-shot event reaches the UI layer');

/* Flappy whale through the built bundle: flap lifts the whale, the run settles. */
const flappySim = prefs.flappy;
const whale = flappySim.createFlappyState(21);
flappySim.startFlappy(whale, { best: 0 });
assert.equal(whale.phase, 'running');
const whaleY = whale.bird.y;
flappySim.flapFlappy(whale);
assert.ok(whale.bird.vy < 0, 'a flap gives the whale upward speed');
for (let i = 0; i < 30; i += 1) flappySim.stepFlappy(whale, 1 / 60);
assert.ok(Number.isFinite(whale.bird.y) && whale.bird.y < whaleY, 'the whale rises after a flap');
assert.ok(Array.isArray(whale.pipes) && Array.isArray(whale.bubbles), 'pipes and bubbles exist in the state');
let flappyGuard = 0;
while (whale.phase === 'running' && flappyGuard < 3600) {
  if (whale.bird.vy > 120) flappySim.flapFlappy(whale);
  flappySim.stepFlappy(whale, 1 / 60);
  flappyGuard += 1;
}
assert.ok(whale.phase === 'over' || whale.phase === 'running', 'the flappy run stays in a valid phase');
assert.ok(Number.isFinite(whale.score), 'flappy score stays finite');
assert.equal(prefs.readFlappyBest(), 0, 'flappy best starts at zero');
prefs.writeFlappyBest(7);
assert.equal(prefs.readFlappyBest(), 7, 'flappy best persists');
prefs.writeFlappyBest(3);
assert.equal(prefs.readFlappyBest(), 7, 'flappy best never regresses');
prefs.writeFlappyBest(0);
planeSim.startPlane(shooter2, { best: 0 });
assert.equal(shooter2.enemyBullets.length, 0, 'restart clears enemy bullets');
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

/* ------------------------------------------------ Gomoku progress memory */
{
  const memory = moduleExports.__test;
  assert.equal(memory.readGomokuGame().history.length, 0, 'a first visit starts from an empty board');

  let inProgress = memory.createGame();
  inProgress = memory.applyMove(inProgress, 112, 1);
  inProgress = memory.applyMove(inProgress, 100, 2);
  memory.writeGomokuSave(inProgress);
  const restored = memory.readGomokuGame();
  assert.deepEqual(restored.history, [112, 100], 'the move list is remembered');
  assert.equal(restored.phase, 'playing');
  assert.equal(restored.turn, 1, 'the restored game is the human turn');
  assert.equal(restored.board[112], 1, 'black stone restored');
  assert.equal(restored.board[100], 2, 'white stone restored');
  assert.equal(restored.lastMove, 100, 'last move marker restored');

  let finished = memory.createGame();
  const script = [
    [0, 1],
    [30, 2],
    [1, 1],
    [31, 2],
    [2, 1],
    [32, 2],
    [3, 1],
    [33, 2],
    [4, 1],
  ];
  for (const [index, player] of script) finished = memory.applyMove(finished, index, player);
  assert.equal(finished.phase, 'won');
  memory.writeGomokuSave(finished);
  const restoredWin = memory.readGomokuGame();
  assert.equal(restoredWin.phase, 'won', 'a finished game is restored as finished');
  assert.ok(Array.isArray(restoredWin.winLine) && restoredWin.winLine.length >= 5, 'winning line restored');

  memory.writeGomokuSave(memory.createGame());
  assert.equal(window.localStorage.getItem(memory.GOMOKU_SAVE_KEY), null, 'a clean board clears the save');

  window.localStorage.setItem(memory.GOMOKU_SAVE_KEY, JSON.stringify({ v: 1, history: [5, 5, 6] }));
  assert.equal(memory.readGomokuGame().history.length, 0, 'an occupied square in the save falls back to a fresh board');
  window.localStorage.setItem(memory.GOMOKU_SAVE_KEY, 'not-json');
  assert.equal(memory.readGomokuGame().history.length, 0, 'broken JSON falls back to a fresh board');
  window.localStorage.removeItem(memory.GOMOKU_SAVE_KEY);
}
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
