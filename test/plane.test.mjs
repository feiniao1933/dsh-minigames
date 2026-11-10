/**
 * Node test suite for the pure airplane-shooter simulation (`src/plane.js`).
 *
 * Run with:  node test/plane.test.mjs
 * Plain assertions only (node:assert/strict); exits non-zero on failure.
 *
 * Covers:
 *   1. create / start / reset state shape, JSON-ability, best preservation
 *   2. pause / resume and step no-ops outside the running phase
 *   3. auto-fire: two wing bullets, upward motion, bounded, culled offscreen
 *   4. spawn: descending enemies, valid types, bounded counts
 *   5. collisions: bullet damage/kill/score, player damage + invuln + game over
 *   6. player clamping, extreme/NaN dt clamping, dt frame-rate independence
 *   7. determinism for a fixed seed + fixed input script
 *   8. 60-second simulated run: finite numbers, bounded entities, score, timing
 *   9. lastEvents semantics: shot/hit/explode/damage/over, cleared each step
 */
import assert from 'node:assert/strict';
import {
  PLANE_WORLD,
  PLANE_LIVES,
  PLANE_PLAYER,
  PLANE_ENEMY_TYPES,
  createPlaneState,
  startPlane,
  pausePlane,
  resumePlane,
  stepPlane,
  movePlayerBy,
  setPlayerPosition,
  planeBestOf,
} from '../src/plane.js';

const DT = 1 / 60;
let passed = 0;
const failures = [];
const notes = [];

function check(condition, label) {
  if (condition) passed += 1;
  else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function checkEqual(actual, expected, label) {
  try {
    assert.deepStrictEqual(actual, expected);
    passed += 1;
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL  ${label}\n        ${error.message}`);
  }
}

function closeTo(actual, expected, tolerance, label) {
  check(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label} (got ${actual}, expected ~${expected})`,
  );
}

function section(title) {
  console.log(`\n# ${title}`);
}

function run(sectionTitle, fn) {
  section(sectionTitle);
  try {
    fn();
  } catch (error) {
    failures.push(`${sectionTitle}: unexpected throw`);
    console.log(`  FAIL  ${sectionTitle}: unexpected throw\n        ${error.stack}`);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fresh(seed = 1234) {
  const state = createPlaneState(seed);
  startPlane(state);
  return state;
}

/** Stop auto-fire and auto-spawn so a scenario is fully deterministic. */
function isolate(state) {
  state.spawnTimer = 1e6;
  state.fireTimer = 1e6;
  return state;
}

function addEnemy(state, overrides = {}) {
  const type = overrides.type || 'scout';
  const def = PLANE_ENEMY_TYPES[type];
  const enemy = {
    id: state.nextId,
    type,
    x: state.player.x,
    y: 300,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    vx: 0,
    drift: 0,
    phase: 0,
    ...overrides,
  };
  state.nextId += 1;
  state.enemies.push(enemy);
  return enemy;
}

function addBullet(state, x, y) {
  const bullet = {
    id: state.nextId,
    x,
    y,
    width: 4,
    height: 12,
    vy: -620,
  };
  state.nextId += 1;
  state.bullets.push(bullet);
  return bullet;
}

function hitPlayer(state) {
  state.player.invuln = 0;
  addEnemy(state, { x: state.player.x, y: state.player.y });
  stepPlane(state, DT);
}

function insideWorld(state) {
  const player = state.player;
  return (
    player.x - player.width / 2 >= -1e-9 &&
    player.x + player.width / 2 <= state.width + 1e-9 &&
    player.y - player.height / 2 >= -1e-9 &&
    player.y + player.height / 2 <= state.height + 1e-9
  );
}

function collectNonFiniteNumbers(value, path, out) {
  if (out.length >= 10) return out;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path);
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      collectNonFiniteNumbers(value[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectNonFiniteNumbers(value[key], `${path}.${key}`, out);
    }
  }
  return out;
}

function entityCount(state) {
  return state.bullets.length + state.enemies.length + state.particles.length;
}

function duplicateIds(state) {
  const seen = new Set();
  const ids = [];
  for (const group of [state.bullets, state.enemies, state.particles]) {
    for (const entity of group) ids.push(entity.id);
  }
  const duplicates = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  return duplicates;
}

/* ------------------------------------------------------------------ */
/* 1. create / start / reset                                           */
/* ------------------------------------------------------------------ */
run('create / start / reset', () => {
  const state = createPlaneState(2024);

  checkEqual(state.phase, 'idle', 'create: phase is idle');
  checkEqual(state.width, PLANE_WORLD.width, 'create: world width');
  checkEqual(state.height, PLANE_WORLD.height, 'create: world height');
  checkEqual(state.player.x, 180, 'create: player x centred');
  checkEqual(state.player.y, 520, 'create: player y');
  checkEqual(state.player.width, PLANE_PLAYER.width, 'create: player width');
  checkEqual(state.player.height, PLANE_PLAYER.height, 'create: player height');
  checkEqual(state.player.invuln, 0, 'create: player invulnerable initially');
  checkEqual(state.bullets, [], 'create: no bullets');
  checkEqual(state.enemies, [], 'create: no enemies');
  checkEqual(state.particles, [], 'create: no particles');
  check(state.stars.length === 70, `create: 70 stars (got ${state.stars.length})`);
  checkEqual(state.score, 0, 'create: score 0');
  checkEqual(state.lives, PLANE_LIVES, 'create: lives 3');
  checkEqual(state.best, 0, 'create: best 0');
  checkEqual(state.elapsed, 0, 'create: elapsed 0');
  check(state.spawnTimer > 0 && state.spawnTimer <= 1, 'create: sane spawn timer');
  check(state.fireTimer > 0 && state.fireTimer <= 1, 'create: sane fire timer');
  checkEqual(state.shake, 0, 'create: shake 0');
  checkEqual(state.nextId, 1, 'create: nextId 1');
  check(Number.isFinite(state.rng), 'create: rng is a finite number');
  checkEqual(state.lastEvents, [], 'create: lastEvents empty');
  checkEqual(
    JSON.parse(JSON.stringify(state)),
    state,
    'create: state round-trips through JSON unchanged',
  );

  for (const type of ['scout', 'fighter', 'heavy']) {
    const def = PLANE_ENEMY_TYPES[type];
    check(!!def, `types: ${type} defined`);
    for (const key of ['width', 'height', 'hp', 'score', 'baseSpeed']) {
      check(
        typeof def[key] === 'number' && def[key] > 0,
        `types: ${type}.${key} is a positive number`,
      );
    }
  }
  checkEqual(PLANE_ENEMY_TYPES.scout.hp, 1, 'types: scout hp 1');
  checkEqual(PLANE_ENEMY_TYPES.scout.score, 10, 'types: scout score 10');
  checkEqual(PLANE_ENEMY_TYPES.fighter.hp, 3, 'types: fighter hp 3');
  checkEqual(PLANE_ENEMY_TYPES.fighter.score, 35, 'types: fighter score 35');
  checkEqual(PLANE_ENEMY_TYPES.heavy.hp, 9, 'types: heavy hp 9');
  checkEqual(PLANE_ENEMY_TYPES.heavy.score, 120, 'types: heavy score 120');
  check(
    PLANE_ENEMY_TYPES.scout.baseSpeed > PLANE_ENEMY_TYPES.fighter.baseSpeed &&
      PLANE_ENEMY_TYPES.fighter.baseSpeed > PLANE_ENEMY_TYPES.heavy.baseSpeed,
    'types: speed order scout > fighter > heavy',
  );

  startPlane(state, { best: 50 });
  checkEqual(state.phase, 'running', 'start: phase running');
  checkEqual(state.best, 50, 'start: options.best adopted');
  checkEqual(state.score, 0, 'start: score reset');
  checkEqual(state.lives, PLANE_LIVES, 'start: lives reset');
  checkEqual(state.elapsed, 0, 'start: elapsed reset');

  for (let i = 0; i < 120; i += 1) stepPlane(state, DT);
  check(
    state.bullets.length > 0 || state.enemies.length > 0,
    'start: gameplay creates entities',
  );
  const bestBeforeRestart = state.best;
  startPlane(state);
  checkEqual(state.bullets, [], 'start: bullets cleared on restart');
  checkEqual(state.enemies, [], 'start: enemies cleared on restart');
  checkEqual(state.particles, [], 'start: particles cleared on restart');
  checkEqual(state.score, 0, 'start: score cleared on restart');
  checkEqual(state.lives, PLANE_LIVES, 'start: lives restored on restart');
  checkEqual(state.elapsed, 0, 'start: elapsed cleared on restart');
  checkEqual(state.best, bestBeforeRestart, 'start: best preserved on restart');
  checkEqual(state.stars.length, 70, 'start: stars recreated');

  startPlane(state, { best: 7 });
  checkEqual(state.best, 50, 'start: lower options.best does not lower best');
  startPlane(state, { best: 500 });
  checkEqual(state.best, 500, 'start: higher options.best raises best');
  checkEqual(planeBestOf(state), 500, 'planeBestOf: returns best');
  checkEqual(planeBestOf({}), 0, 'planeBestOf: missing best -> 0');
  checkEqual(planeBestOf(null), 0, 'planeBestOf: null -> 0');

  const unseeded = createPlaneState();
  check(Number.isFinite(unseeded.rng), 'create: unseeded rng is finite');
  checkEqual(JSON.parse(JSON.stringify(unseeded)), unseeded, 'create: unseeded JSON-able');
});

/* ------------------------------------------------------------------ */
/* 2. pause / resume / no-op phases                                    */
/* ------------------------------------------------------------------ */
run('pause / resume / no-op phases', () => {
  const idle = createPlaneState(1);
  const idleSnapshot = JSON.stringify(idle);
  stepPlane(idle, 1);
  checkEqual(JSON.stringify(idle), idleSnapshot, 'idle: step is a no-op');
  resumePlane(idle);
  checkEqual(idle.phase, 'idle', 'idle: resume does not start the game');
  pausePlane(idle);
  checkEqual(idle.phase, 'idle', 'idle: pause keeps idle');

  const state = fresh(2);
  stepPlane(state, DT);
  pausePlane(state);
  checkEqual(state.phase, 'paused', 'pause: phase paused');
  const pausedSnapshot = JSON.stringify(state);
  stepPlane(state, 1);
  checkEqual(JSON.stringify(state), pausedSnapshot, 'paused: step is a no-op');
  resumePlane(state);
  checkEqual(state.phase, 'running', 'resume: phase running');
  const elapsedBefore = state.elapsed;
  stepPlane(state, DT);
  check(state.elapsed > elapsedBefore, 'resume: stepping advances elapsed');
});

/* ------------------------------------------------------------------ */
/* 3. auto-fire                                                        */
/* ------------------------------------------------------------------ */
run('auto-fire', () => {
  const state = fresh(5);
  let guard = 0;
  while (state.bullets.length < 2 && guard < 20) {
    stepPlane(state, DT);
    guard += 1;
  }
  checkEqual(state.bullets.length, 2, 'fire: first volley has exactly two bullets');
  check(state.bullets[0].x !== state.bullets[1].x, 'fire: bullets leave from both wings');
  check(
    Math.abs(Math.abs(state.bullets[0].x - state.bullets[1].x) - 22) < 1e-6,
    'fire: wings are 22 units apart',
  );
  for (const bullet of state.bullets) {
    check(bullet.vy < 0, 'fire: bullets move upwards');
    check(Number.isFinite(bullet.id), 'fire: bullet id finite');
    check(bullet.width > 0 && bullet.height > 0, 'fire: bullet has a box');
  }

  const before = new Map(state.bullets.map((bullet) => [bullet.id, bullet.y]));
  stepPlane(state, DT);
  let movedUp = 0;
  for (const bullet of state.bullets) {
    if (!before.has(bullet.id)) continue;
    if (bullet.y < before.get(bullet.id)) movedUp += 1;
  }
  check(movedUp >= 2, 'fire: existing bullets move up each step');

  // Volley cadence over one second with auto-fire left enabled.
  const cadence = fresh(5);
  let shots = 0;
  for (let i = 0; i < 60; i += 1) {
    stepPlane(cadence, DT);
    shots += cadence.lastEvents.filter((event) => event.type === 'shot').length;
    check(cadence.lastEvents.length <= 8, 'fire: lastEvents bounded per step');
  }
  check(shots >= 5 && shots <= 8, `fire: ~7 volleys per second (got ${shots})`);
  check(cadence.bullets.length <= 80, 'fire: bullet count bounded');
  check(cadence.bullets.length > 0, 'fire: bullets on screen after one second');

  isolate(cadence);
  for (const bullet of cadence.bullets) bullet.y = -1000;
  stepPlane(cadence, DT);
  checkEqual(cadence.bullets, [], 'fire: offscreen bullets are culled');
});

/* ------------------------------------------------------------------ */
/* 4. spawn                                                            */
/* ------------------------------------------------------------------ */
run('spawn', () => {
  const state = fresh(6);
  let guard = 0;
  while (state.enemies.length === 0 && guard < 120) {
    stepPlane(state, DT);
    guard += 1;
  }
  check(state.enemies.length >= 1, 'spawn: enemy appears within ~2 s');
  check(state.elapsed < 2, 'spawn: seeding is sparse but prompt');

  const enemy = state.enemies[0];
  check(['scout', 'fighter', 'heavy'].includes(enemy.type), 'spawn: type is valid');
  const def = PLANE_ENEMY_TYPES[enemy.type];
  checkEqual(enemy.width, def.width, 'spawn: width matches type');
  checkEqual(enemy.height, def.height, 'spawn: height matches type');
  checkEqual(enemy.hp, def.hp, 'spawn: full hp at spawn');
  checkEqual(enemy.maxHp, def.hp, 'spawn: maxHp at spawn');
  check(enemy.y < 0 + enemy.height, 'spawn: enters from above the screen');
  check(Number.isFinite(enemy.x) && Number.isFinite(enemy.y), 'spawn: finite position');
  check(Number.isFinite(enemy.vx) && Number.isFinite(enemy.drift), 'spawn: finite drift');
  check(Number.isFinite(enemy.phase), 'spawn: finite phase');
  const idsBefore = new Set(state.enemies.map((item) => item.id));
  const yBefore = enemy.y;
  for (let i = 0; i < 30; i += 1) stepPlane(state, DT);
  const sameEnemy = state.enemies.find((item) => idsBefore.has(item.id));
  if (sameEnemy) check(sameEnemy.y > yBefore, 'spawn: enemy descends');

  // Long spawned run under god-mode so the player does not end the session.
  const long = fresh(606);
  long.player.invuln = 1e9;
  let maxEnemies = 0;
  for (let i = 0; i < 1800; i += 1) {
    stepPlane(long, DT);
    maxEnemies = Math.max(maxEnemies, long.enemies.length);
    check(long.enemies.length <= 40, 'spawn: enemy count bounded every step');
  }
  const seenTypes = new Set(long.enemies.map((item) => item.type));
  check(seenTypes.size >= 1, 'spawn: at least one type spawned over 30 s');
  for (const type of seenTypes) {
    check(!!PLANE_ENEMY_TYPES[type], `spawn: long run type ${type} valid`);
  }
  check(long.score > 0, 'spawn: long run produces score');
  checkEqual(long.stars.length, 70, 'spawn: star field stays at 70');
  check(maxEnemies > 0, 'spawn: long run saw enemies');
  notes.push(`spawn maxEnemies=${maxEnemies}`);
});

/* ------------------------------------------------------------------ */
/* 5. collisions                                                       */
/* ------------------------------------------------------------------ */
run('collisions', () => {
  // Bullet kills a scout: score, explosion particles, bullet consumed.
  const state = fresh(11);
  isolate(state);
  addEnemy(state, { x: 180, y: 300, type: 'scout' });
  addBullet(state, 180, 300);
  stepPlane(state, DT);
  checkEqual(state.enemies.length, 0, 'kill: scout removed');
  checkEqual(state.bullets.length, 0, 'kill: bullet consumed');
  checkEqual(state.score, 10, 'kill: scout awards 10 points');
  check(state.particles.length > 0, 'kill: explosion particles spawned');
  check(
    state.lastEvents.some((event) => event.type === 'hit'),
    'kill: hit event emitted',
  );
  check(
    state.lastEvents.some((event) => event.type === 'explode' && event.size === 1),
    'kill: explode event size 1 for scout',
  );
  for (const particle of state.particles) {
    check(Number.isFinite(particle.life) && particle.life > 0, 'kill: particle life finite');
    check(Number.isFinite(particle.vx) && Number.isFinite(particle.vy), 'kill: particle velocity finite');
    check(particle.tone >= 0 && particle.tone <= 2, 'kill: particle tone in 0..2');
  }

  // Fighter needs three bullets; one bullet per enemy per step is consumed.
  const fighterState = fresh(12);
  isolate(fighterState);
  const fighter = addEnemy(fighterState, { x: 180, y: 300, type: 'fighter' });
  addBullet(fighterState, fighter.x, fighter.y);
  addBullet(fighterState, fighter.x, fighter.y);
  stepPlane(fighterState, DT);
  checkEqual(fighterState.enemies.length, 1, 'fighter: survives first hit');
  checkEqual(fighter.hp, 2, 'fighter: took exactly one bullet of damage');
  checkEqual(fighterState.bullets.length, 1, 'fighter: only one bullet consumed per enemy');
  checkEqual(fighterState.score, 0, 'fighter: no score while alive');
  for (let hit = 0; hit < 2; hit += 1) {
    const current = fighterState.enemies[0];
    addBullet(fighterState, current.x, current.y);
    stepPlane(fighterState, DT);
  }
  checkEqual(fighterState.enemies.length, 0, 'fighter: destroyed after three hits');
  checkEqual(fighterState.score, 35, 'fighter: awards 35 points');
  check(
    fighterState.lastEvents.some(
      (event) => event.type === 'explode' && event.size === 2,
    ),
    'fighter: explode event size 2',
  );

  // Player collision: one life lost, invulnerability window, shake.
  const playerState = fresh(13);
  isolate(playerState);
  playerState.score = 50;
  addEnemy(playerState, { x: playerState.player.x, y: playerState.player.y });
  stepPlane(playerState, DT);
  checkEqual(playerState.lives, 2, 'player: one life lost on contact');
  check(playerState.player.invuln > 1.3, 'player: invulnerability granted (~1.4 s)');
  check(playerState.shake > 0.9, 'player: shake triggered');
  checkEqual(playerState.enemies.length, 0, 'player: colliding enemy removed');
  check(
    playerState.lastEvents.some((event) => event.type === 'damage'),
    'player: damage event emitted',
  );
  check(
    !playerState.lastEvents.some((event) => event.type === 'over'),
    'player: not over after one hit',
  );
  addEnemy(playerState, { x: playerState.player.x, y: playerState.player.y });
  stepPlane(playerState, DT);
  checkEqual(playerState.lives, 2, 'player: invulnerability blocks immediate second hit');
  check(playerState.shake < 0.95, 'player: shake decays over time');

  hitPlayer(playerState);
  checkEqual(playerState.lives, 1, 'player: second hit after invulnerability - 1 life');
  playerState.score = 50;
  playerState.best = 40;
  hitPlayer(playerState);
  checkEqual(playerState.lives, 0, 'player: lives clamped at 0');
  checkEqual(playerState.phase, 'over', 'player: phase over at 0 lives');
  check(
    playerState.lastEvents.some((event) => event.type === 'over'),
    'player: over event emitted',
  );
  checkEqual(playerState.score, 50, 'player: score frozen at game over');
  checkEqual(playerState.best, 50, 'player: best updated from final score');
  const overSnapshot = JSON.stringify(playerState);
  stepPlane(playerState, 1);
  checkEqual(JSON.stringify(playerState), overSnapshot, 'over: step is a no-op');

  const noBestState = fresh(14);
  isolate(noBestState);
  noBestState.score = 30;
  noBestState.best = 100;
  hitPlayer(noBestState);
  hitPlayer(noBestState);
  hitPlayer(noBestState);
  checkEqual(noBestState.phase, 'over', 'player: game over helper reached');
  checkEqual(noBestState.best, 100, 'player: best not lowered by lower score');

  // Enemies leaving the bottom are removed without penalty.
  const escapeState = fresh(15);
  isolate(escapeState);
  const livesBefore = escapeState.lives;
  const scoreBefore = escapeState.score;
  addEnemy(escapeState, { x: 90, y: escapeState.height + 100 });
  stepPlane(escapeState, DT);
  checkEqual(escapeState.enemies.length, 0, 'escape: enemy leaving bottom removed');
  checkEqual(escapeState.lives, livesBefore, 'escape: no life penalty');
  checkEqual(escapeState.score, scoreBefore, 'escape: no score change');
});

/* ------------------------------------------------------------------ */
/* 6. clamping and dt handling                                         */
/* ------------------------------------------------------------------ */
run('clamping and dt', () => {
  const state = fresh(21);
  movePlayerBy(state, -1e6, -1e6);
  closeTo(state.player.x, PLANE_PLAYER.width / 2, 1e-9, 'clamp: left edge');
  closeTo(state.player.y, PLANE_PLAYER.height / 2, 1e-9, 'clamp: top edge');
  check(insideWorld(state), 'clamp: player box fully inside after huge drag');

  movePlayerBy(state, 1e6, 1e6);
  closeTo(state.player.x, PLANE_WORLD.width - PLANE_PLAYER.width / 2, 1e-9, 'clamp: right edge');
  closeTo(state.player.y, PLANE_WORLD.height - PLANE_PLAYER.height / 2, 1e-9, 'clamp: bottom edge');
  check(insideWorld(state), 'clamp: player box fully inside at bottom-right');

  setPlayerPosition(state, -50, -50);
  check(insideWorld(state), 'clamp: absolute position clamped top-left');
  setPlayerPosition(state, 180, 520);
  checkEqual(state.player.x, 180, 'clamp: valid absolute x preserved');
  checkEqual(state.player.y, 520, 'clamp: valid absolute y preserved');

  const dtState = fresh(22);
  const elapsedBefore = dtState.elapsed;
  stepPlane(dtState, 10);
  closeTo(dtState.elapsed - elapsedBefore, 0.05, 1e-12, 'dt: extreme dt clamped to 0.05');
  const afterExtreme = dtState.elapsed;
  stepPlane(dtState, -5);
  checkEqual(dtState.elapsed, afterExtreme, 'dt: negative dt ignored');
  stepPlane(dtState, NaN);
  checkEqual(dtState.elapsed, afterExtreme, 'dt: NaN dt ignored');
  checkEqual(dtState.bullets.every((bullet) => Number.isFinite(bullet.y)), true, 'dt: no NaN positions');

  // Frame-rate independence: the same elapsed time yields the same bullet travel.
  function bulletTravel(dt, steps) {
    const sim = fresh(23);
    isolate(sim);
    addBullet(sim, 180, 300);
    for (let i = 0; i < steps; i += 1) stepPlane(sim, dt);
    return sim.bullets[0] ? sim.bullets[0].y : null;
  }
  const at60 = bulletTravel(1 / 60, 18);
  const at30 = bulletTravel(1 / 30, 9);
  check(at60 !== null && at30 !== null, 'dt: bullet still on screen for comparison');
  closeTo(at60, at30, 1e-6, 'dt: bullet travel independent of frame rate');
});

/* ------------------------------------------------------------------ */
/* 7. determinism                                                      */
/* ------------------------------------------------------------------ */
run('determinism', () => {
  function scriptedRun(seed) {
    const state = fresh(seed);
    for (let frame = 0; frame < 1800; frame += 1) {
      setPlayerPosition(
        state,
        180 + Math.sin(frame * 0.03) * 120,
        520 + Math.sin(frame * 0.02) * 20,
      );
      stepPlane(state, DT);
    }
    return state;
  }
  const first = scriptedRun(999);
  const second = scriptedRun(999);
  checkEqual(JSON.stringify(second), JSON.stringify(first), 'determinism: identical final state');
  checkEqual(second.score, first.score, 'determinism: identical score');
  checkEqual(second.lives, first.lives, 'determinism: identical lives');
  checkEqual(second.phase, first.phase, 'determinism: identical phase');
  checkEqual(second.bullets.length, first.bullets.length, 'determinism: identical bullets');
  checkEqual(second.enemies.length, first.enemies.length, 'determinism: identical enemies');
  checkEqual(second.particles.length, first.particles.length, 'determinism: identical particles');
  checkEqual(
    second.stars.slice(0, 5).map((star) => [star.x, star.y]),
    first.stars.slice(0, 5).map((star) => [star.x, star.y]),
    'determinism: identical star field',
  );

  const seedA = scriptedRun(1000);
  const seedB = scriptedRun(1001);
  check(
    JSON.stringify(seedA) !== JSON.stringify(seedB),
    'determinism: different seeds produce different runs',
  );
});

/* ------------------------------------------------------------------ */
/* 8. 60-second simulated run (timing + bounds)                        */
/* ------------------------------------------------------------------ */
run('60-second simulated run', () => {
  const state = fresh(7);
  // God-mode so the simulation keeps running for the full minute; this is a
  // performance/robustness harness, not a player-skill test.
  state.player.invuln = 1e9;

  let maxBullets = 0;
  let maxEnemies = 0;
  let maxParticles = 0;
  let maxTotal = 0;
  let maxEvents = 0;
  let eventsSeen = 0;

  const startedAt = process.hrtime.bigint();
  for (let frame = 0; frame < 3600; frame += 1) {
    setPlayerPosition(
      state,
      180 + Math.sin(frame * 0.021) * 110,
      500 + Math.sin(frame * 0.013) * 40,
    );
    stepPlane(state, DT);
    maxBullets = Math.max(maxBullets, state.bullets.length);
    maxEnemies = Math.max(maxEnemies, state.enemies.length);
    maxParticles = Math.max(maxParticles, state.particles.length);
    maxEvents = Math.max(maxEvents, state.lastEvents.length);
    eventsSeen += state.lastEvents.length;
    maxTotal = Math.max(maxTotal, entityCount(state));
    check(entityCount(state) < 400, 'run: total entities stay under 400');
  }
  const wallMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  checkEqual(state.phase, 'running', 'run: still running after 60 s');
  closeTo(state.elapsed, 60, 1e-9, 'run: elapsed time is 60 s');
  check(state.score > 0, 'run: score accumulated');
  check(state.lives > 0, 'run: player survived under god-mode');
  checkEqual(state.stars.length, 70, 'run: star count constant');
  check(maxBullets <= 80, 'run: max bullets bounded');
  check(maxEnemies <= 40, 'run: max enemies bounded');
  check(maxParticles <= 280, 'run: max particles bounded');
  check(maxEvents <= 8, 'run: max events per step bounded');
  check(eventsSeen > 0, 'run: UI events fired during the run');
  checkEqual(duplicateIds(state), [], 'run: entity ids unique');
  const nonFinite = collectNonFiniteNumbers(state, 'state', []);
  checkEqual(nonFinite, [], 'run: every number finite (no NaN/Infinity)');
  check(wallMs < 2000, `run: 60 s simulation under 2 s (took ${wallMs.toFixed(1)} ms)`);

  notes.push(
    `60s run: ${wallMs.toFixed(1)} ms wall, max entities=${maxTotal} ` +
      `(bullets=${maxBullets}, enemies=${maxEnemies}, particles=${maxParticles}), ` +
      `maxEvents/step=${maxEvents}, score=${state.score}`,
  );
});

/* ------------------------------------------------------------------ */
/* 9. lastEvents                                                       */
/* ------------------------------------------------------------------ */
run('lastEvents', () => {
  const quiet = fresh(31);
  quiet.lastEvents.push({ type: 'stale' });
  stepPlane(quiet, DT);
  checkEqual(quiet.lastEvents, [], 'events: cleared at the start of every step');

  const shotState = fresh(32);
  let sawShot = false;
  for (let i = 0; i < 20 && !sawShot; i += 1) {
    stepPlane(shotState, DT);
    sawShot = shotState.lastEvents.some((event) => event.type === 'shot');
  }
  check(sawShot, 'events: shot event fires for auto-fire');

  const killState = fresh(33);
  isolate(killState);
  addEnemy(killState, { x: 180, y: 300 });
  addBullet(killState, 180, 300);
  stepPlane(killState, DT);
  const types = killState.lastEvents.map((event) => event.type);
  check(types.includes('hit'), 'events: hit emitted when a bullet hits');
  check(types.includes('explode'), 'events: explode emitted when an enemy dies');

  const hitState = fresh(34);
  isolate(hitState);
  addEnemy(hitState, { x: hitState.player.x, y: hitState.player.y });
  stepPlane(hitState, DT);
  check(
    hitState.lastEvents.some((event) => event.type === 'damage'),
    'events: damage emitted when the player is hit',
  );

  const overState = fresh(35);
  isolate(overState);
  hitPlayer(overState);
  hitPlayer(overState);
  hitPlayer(overState);
  checkEqual(overState.phase, 'over', 'events: over scenario reached');
  check(
    overState.lastEvents.some((event) => event.type === 'over'),
    'events: over emitted at game over',
  );

  const steady = fresh(36);
  steady.player.invuln = 1e9;
  for (let frame = 0; frame < 600; frame += 1) {
    stepPlane(steady, DT);
    check(steady.lastEvents.length <= 8, 'events: array bounded during play');
    for (const event of steady.lastEvents) {
      check(typeof event.type === 'string', 'events: every entry has a string type');
      check(
        JSON.parse(JSON.stringify(event)) !== null,
        'events: every entry is JSON-able',
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(64));
if (notes.length > 0) {
  for (const note of notes) console.log(`note: ${note}`);
}
if (failures.length > 0) {
  console.log(`\nFAILED: ${failures.length} check(s), ${passed} passed`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: ${passed} checks`);
  process.exitCode = 0;
}
