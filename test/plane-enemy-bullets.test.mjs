/**
 * Node tests for the sky-shooter's enemy fire (added in 1.2.0).
 *
 * Run with: node test/plane-enemy-bullets.test.mjs
 * Plain assertions, exits non-zero on failure.
 */
import {
  PLANE_WORLD,
  PLANE_LIVES,
  PLANE_ENEMY_TYPES,
  createPlaneState,
  startPlane,
  stepPlane,
} from '../src/plane.js';

let passed = 0;
const failures = [];

function check(condition, label) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function makeState(seed = 1) {
  const state = createPlaneState(seed);
  startPlane(state, { best: 0 });
  state.spawnTimer = 9999;
  state.fireTimer = 9999;
  state.elapsed = 0;
  state.player.invuln = 0;
  state.enemies.length = 0;
  state.enemyBullets.length = 0;
  state.bullets.length = 0;
  state.particles.length = 0;
  state.lastEvents.length = 0;
  return state;
}

function putEnemy(state, type, x, y, fireTimer) {
  const def = PLANE_ENEMY_TYPES[type];
  state.enemies.push({
    id: state.nextId,
    type,
    x,
    y,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    vx: 0,
    drift: 0,
    phase: 0,
    fireTimer,
  });
  state.nextId += 1;
  return state.enemies[state.enemies.length - 1];
}

/* ------------------------------------------------------------------ */
console.log('\n# state shape and reset');
{
  const state = createPlaneState(3);
  check(Array.isArray(state.enemyBullets) && state.enemyBullets.length === 0, 'new state carries an empty enemyBullets array');
  state.enemyBullets.push({ id: 1, x: 10, y: 10, width: 5, height: 10, vx: 0, vy: 200 });
  startPlane(state, { best: 0 });
  check(state.enemyBullets.length === 0, 'startPlane clears enemy bullets');
}

console.log('\n# scouts never fire');
{
  const state = makeState(5);
  putEnemy(state, 'scout', 180, 120, -1);
  for (let i = 0; i < 120; i += 1) stepPlane(state, 1 / 60);
  check(state.enemyBullets.length === 0, 'scout produces no bullets');
  check(!state.lastEvents.some((event) => event.type === 'enemy-shot'), 'scout emits no enemy-shot event');
}

console.log('\n# fighters fire one aimed shot');
{
  const state = makeState(11);
  const fighter = putEnemy(state, 'fighter', 100, 120, 0.02);
  state.player.x = 320;
  state.player.y = 520;
  stepPlane(state, 0.05);
  check(state.enemyBullets.length === 1, 'fighter fires exactly one bullet');
  const bullet = state.enemyBullets[0];
  check(bullet.vy > 0, 'enemy bullet travels downward');
  check(bullet.vx > 0, 'enemy bullet aims toward the player (right)');
  check(fighter.fireTimer > 1, 'fighter reloads a full interval');
  check(state.lastEvents.some((event) => event.type === 'enemy-shot'), 'enemy-shot event is emitted');

  const mirrored = makeState(11);
  putEnemy(mirrored, 'fighter', 260, 120, 0.02);
  mirrored.player.x = 40;
  stepPlane(mirrored, 0.05);
  check(mirrored.enemyBullets[0].vx < 0, 'aim flips for a player on the left');

  const centred = makeState(11);
  putEnemy(centred, 'fighter', 180, 120, 0.02);
  centred.player.x = 180;
  stepPlane(centred, 0.05);
  check(Math.abs(centred.enemyBullets[0].vx) < 1, 'no horizontal drift when lined up');
}

console.log('\n# heavy planes fire a three-way spread');
{
  const state = makeState(17);
  putEnemy(state, 'heavy', 180, 140, 0.02);
  state.player.x = 180;
  stepPlane(state, 0.05);
  check(state.enemyBullets.length === 3, 'heavy fires three bullets');
  const left = state.enemyBullets[0];
  const middle = state.enemyBullets[1];
  const right = state.enemyBullets[2];
  check(left.vx < 0 && middle.vx === 0 && right.vx > 0, 'spread fans left/centre/right');
  check(left.vy > 0 && middle.vy > 0 && right.vy > 0, 'spread travels downward');
}

console.log('\n# enemies only fire inside the play area');
{
  const below = makeState(19);
  putEnemy(below, 'fighter', 180, PLANE_WORLD.height * 0.9, 0.02);
  stepPlane(below, 0.05);
  check(below.enemyBullets.length === 0, 'enemy near the player line does not fire');

  const above = makeState(19);
  putEnemy(above, 'fighter', 180, 20, 0.02);
  stepPlane(above, 0.05);
  check(above.enemyBullets.length === 1, 'enemy in the upper area fires');
}

console.log('\n# enemy bullets damage the player once');
{
  const state = makeState(23);
  state.player.x = 180;
  state.player.y = 520;
  state.enemyBullets.push({ id: 99, x: 180, y: 520, width: 5, height: 10, vx: 0, vy: 205 });
  stepPlane(state, 0.01);
  check(state.lives === PLANE_LIVES - 1, 'a bullet costs one life');
  check(state.player.invuln > 0, 'the hit grants invulnerability');
  check(state.enemyBullets.length === 0, 'the bullet is consumed on impact');
  check(state.lastEvents.some((event) => event.type === 'damage'), 'damage event is emitted');

  /* A second bullet during invulnerability must not stack damage. */
  state.enemyBullets.push({ id: 100, x: 180, y: 520, width: 5, height: 10, vx: 0, vy: 205 });
  stepPlane(state, 0.01);
  check(state.lives === PLANE_LIVES - 1, 'invulnerability blocks the second hit');
  check(state.enemyBullets.length === 1, 'the blocked bullet is not consumed');
}

console.log('\n# enemy bullets are cleaned up and bounded');
{
  const state = makeState(29);
  state.enemyBullets.push({ id: 1, x: 10, y: 700, width: 5, height: 10, vx: 0, vy: 205 });
  state.enemyBullets.push({ id: 2, x: -40, y: 100, width: 5, height: 10, vx: -100, vy: 205 });
  stepPlane(state, 0.01);
  check(state.enemyBullets.length === 0, 'off-screen enemy bullets are removed');

  const capped = makeState(31);
  for (let i = 0; i < 120; i += 1) {
    capped.enemyBullets.push({ id: 1000 + i, x: 10 - i, y: 10, width: 5, height: 10, vx: 0, vy: 0 });
  }
  putEnemy(capped, 'fighter', 180, 120, 0.02);
  stepPlane(capped, 0.05);
  check(capped.enemyBullets.length <= 120, 'enemy bullet array stays bounded at the cap');
}

console.log('\n# fire rate ramps with elapsed time');
{
  const early = makeState(37);
  early.elapsed = 0;
  putEnemy(early, 'fighter', 180, 120, 0.02);
  stepPlane(early, 0.05);
  const earlyReload = early.enemies[0].fireTimer;

  const late = makeState(37);
  late.elapsed = 100;
  putEnemy(late, 'fighter', 180, 120, 0.02);
  stepPlane(late, 0.05);
  const lateReload = late.enemies[0].fireTimer;
  check(lateReload < earlyReload, 'reload gets shorter as the run goes on');
  check(lateReload > 0.5, 'reload never collapses to zero');
}

console.log('\n# enemy fire can end the run');
{
  const state = makeState(41);
  state.lives = 1;
  state.player.x = 180;
  state.player.y = 520;
  state.score = 240;
  state.enemyBullets.push({ id: 7, x: 180, y: 520, width: 5, height: 10, vx: 0, vy: 205 });
  stepPlane(state, 0.01);
  check(state.phase === 'over', 'a lethal bullet ends the run');
  check(state.best === 240, 'the score becomes the best on the final hit');
}

console.log('\n# a full 60 s run with enemy fire stays healthy');
{
  const state = createPlaneState(43);
  startPlane(state, { best: 0 });
  let maxEnemyBullets = 0;
  for (let i = 0; i < 3600 && state.phase === 'running'; i += 1) {
    stepPlane(state, 1 / 60);
    if (state.enemyBullets.length > maxEnemyBullets) maxEnemyBullets = state.enemyBullets.length;
  }
  check(maxEnemyBullets > 0, 'enemy bullets appear during a real run');
  check(maxEnemyBullets <= 120, 'enemy bullet count stays capped in a real run');
  check(Number.isFinite(state.score), 'score stays finite');
  for (const bullet of state.enemyBullets) {
    check(Number.isFinite(bullet.x) && Number.isFinite(bullet.y), 'every enemy bullet keeps finite coordinates');
  }
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
console.log('PASS: enemy-fire tests');
