/**
 * Pure simulation core for the WeChat-style "打飞机" (airplane shooter) game
 * in the DSH "游戏盒子" plugin.
 *
 * Contract (must hold for `build.mjs`, which strips leading `export ` lines and
 * concatenates this file into one browser function scope together with
 * `src/engine.js` and `src/ui.js`):
 *   - self-contained ESM with NO imports, NO DOM/canvas, NO audio, NO timers,
 *     NO async / top-level await and NO `export default`;
 *   - all module-level identifiers are unique: the public exports below plus
 *     internals prefixed `mgPlane`; never define `React`, `apply`, `inject` or
 *     `mg*` names that could collide with engine.js;
 *   - state is a plain JSON-able object (no class instances, no Infinity/NaN);
 *     ids are unique and every entity array is bounded.
 *
 * World is fixed at 360 x 600 logical units (origin top-left, y grows down),
 * positions are box CENTRES and the simulation is frame-rate independent:
 * `stepPlane(state, dtSeconds)` internally clamps dt to <= 0.05 s.
 * The UI owns player input (movePlayerBy / setPlayerPosition), rendering,
 * audio and the HUD and consumes `state.lastEvents` after every step.
 */

export const PLANE_WORLD = { width: 360, height: 600 };
export const PLANE_LIVES = 3;
export const PLANE_PLAYER = { width: 34, height: 42 };

/**
 * Enemy archetypes: scout is common/fast/fragile, fighter medium, heavy slow
 * and tanky but rare (only after ~20 s). `tone` 1..3 drives explosion size.
 */
export const PLANE_ENEMY_TYPES = {
  scout: { width: 26, height: 26, hp: 1, score: 10, baseSpeed: 118, tone: 1 },
  fighter: { width: 32, height: 34, hp: 3, score: 35, baseSpeed: 82, tone: 2 },
  heavy: { width: 48, height: 54, hp: 9, score: 120, baseSpeed: 52, tone: 3 },
};

/* ------------------------------------------------------------------ */
/* Internal tuning constants (mgPlane namespace protects bundle scope) */
/* ------------------------------------------------------------------ */

const mgPlaneMaxDt = 0.05;
const mgPlaneFireInterval = 0.14;
const mgPlaneBulletSpeed = 620;
const mgPlaneBulletWidth = 4;
const mgPlaneBulletHeight = 12;
const mgPlaneGunOffset = 11;
const mgPlaneMaxBullets = 80;
const mgPlaneMaxEnemies = 40;
const mgPlaneMaxParticles = 280;
const mgPlaneStarCount = 70;
const mgPlaneSpawnStart = 0.95;
const mgPlaneSpawnEnd = 0.35;
const mgPlaneSpawnRamp = 100;
const mgPlaneFirstSpawnDelay = 0.55;
const mgPlaneFirstFireDelay = 0.06;
const mgPlaneInvulnTime = 1.4;
const mgPlaneShakeDecay = 2.5;
const mgPlaneHeavyDelay = 20;
const mgPlaneEventCap = 8;
const mgPlanePlayerStartY = 520;

/* ------------------------------------------------------------------ */
/* Deterministic RNG (mulberry32, state kept as a uint32 inside state) */
/* ------------------------------------------------------------------ */

function mgPlaneRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function mgPlaneOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

function mgPlaneClampPlayer(state) {
  const player = state.player;
  const halfW = player.width / 2;
  const halfH = player.height / 2;
  player.x = Math.min(state.width - halfW, Math.max(halfW, player.x));
  player.y = Math.min(state.height - halfH, Math.max(halfH, player.y));
  return state;
}

function mgPlanePushEvent(state, event) {
  if (state.lastEvents.length < mgPlaneEventCap) state.lastEvents.push(event);
}

function mgPlaneSpeedFactor(elapsed) {
  return 1 + Math.min(0.35, elapsed * 0.0028);
}

function mgPlaneSpawnInterval(elapsed) {
  const ramp = Math.min(1, elapsed / mgPlaneSpawnRamp);
  return mgPlaneSpawnStart - (mgPlaneSpawnStart - mgPlaneSpawnEnd) * ramp;
}

function mgPlaneResetStars(state) {
  state.stars.length = 0;
  for (let i = 0; i < mgPlaneStarCount; i += 1) {
    state.stars.push({
      x: mgPlaneRandom(state) * state.width,
      y: mgPlaneRandom(state) * state.height,
      speed: 18 + mgPlaneRandom(state) * 72,
      size: mgPlaneRandom(state) < 0.72 ? 1 : 2,
    });
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Entity factories                                                    */
/* ------------------------------------------------------------------ */

function mgPlaneSpawnBullets(state) {
  const player = state.player;
  const y = player.y - player.height / 2 - mgPlaneBulletHeight / 2 - 2;
  const xLeft = player.x - mgPlaneGunOffset;
  const xRight = player.x + mgPlaneGunOffset;
  state.bullets.push({
    id: state.nextId,
    x: xLeft,
    y,
    width: mgPlaneBulletWidth,
    height: mgPlaneBulletHeight,
    vy: -mgPlaneBulletSpeed,
  });
  state.nextId += 1;
  state.bullets.push({
    id: state.nextId,
    x: xRight,
    y,
    width: mgPlaneBulletWidth,
    height: mgPlaneBulletHeight,
    vy: -mgPlaneBulletSpeed,
  });
  state.nextId += 1;
}

function mgPlanePickEnemyType(state) {
  const elapsed = state.elapsed;
  const roll = mgPlaneRandom(state);
  let heavyChance = 0;
  if (elapsed >= mgPlaneHeavyDelay) {
    heavyChance = Math.min(0.16, 0.02 + (elapsed - mgPlaneHeavyDelay) * 0.0014);
  }
  const fighterChance =
    elapsed < 6 ? 0.1 : Math.min(0.4, 0.16 + elapsed * 0.0024);
  if (roll < heavyChance) return 'heavy';
  if (roll < heavyChance + fighterChance) return 'fighter';
  return 'scout';
}

function mgPlaneSpawnEnemy(state) {
  const type = mgPlanePickEnemyType(state);
  const def = PLANE_ENEMY_TYPES[type];
  const margin = def.width / 2 + 6;
  const x = margin + mgPlaneRandom(state) * (state.width - margin * 2);
  let vx = 0;
  let drift = 0;
  if (type === 'fighter') {
    vx = (mgPlaneRandom(state) < 0.5 ? -1 : 1) * (8 + mgPlaneRandom(state) * 14);
    drift = 14 + mgPlaneRandom(state) * 16;
  } else if (type === 'heavy') {
    vx = (mgPlaneRandom(state) < 0.5 ? -1 : 1) * (5 + mgPlaneRandom(state) * 9);
    drift = 7 + mgPlaneRandom(state) * 10;
  }
  state.enemies.push({
    id: state.nextId,
    type,
    x,
    y: -def.height / 2 - 8,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    vx,
    drift,
    phase: mgPlaneRandom(state) * Math.PI * 2,
  });
  state.nextId += 1;
}

/** Spawn impact particles; `size` 1..3 selects count/speed/life and tone. */
function mgPlaneExplode(state, x, y, size) {
  const clampedSize = Math.max(1, Math.min(3, size | 0));
  let count = clampedSize * 6;
  const room = mgPlaneMaxParticles - state.particles.length;
  if (room <= 0) return;
  if (count > room) count = room;
  const baseSpeed = 40 + clampedSize * 30;
  for (let i = 0; i < count; i += 1) {
    const angle = mgPlaneRandom(state) * Math.PI * 2;
    const speed = baseSpeed * (0.4 + mgPlaneRandom(state));
    const life = 0.3 + mgPlaneRandom(state) * 0.35 + clampedSize * 0.04;
    state.particles.push({
      id: state.nextId,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 1 + mgPlaneRandom(state) * 1.8 + (clampedSize - 1) * 0.5,
      tone: clampedSize - 1,
    });
    state.nextId += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function createPlaneState(seed) {
  const seedValue = Number.isFinite(seed)
    ? Math.floor(seed) >>> 0
    : ((Date.now() >>> 0) ^ 0x9e3779b9) >>> 0;
  const state = {
    phase: 'idle',
    width: PLANE_WORLD.width,
    height: PLANE_WORLD.height,
    player: {
      x: PLANE_WORLD.width / 2,
      y: mgPlanePlayerStartY,
      width: PLANE_PLAYER.width,
      height: PLANE_PLAYER.height,
      invuln: 0,
    },
    bullets: [],
    enemies: [],
    particles: [],
    stars: [],
    score: 0,
    best: 0,
    lives: PLANE_LIVES,
    elapsed: 0,
    spawnTimer: mgPlaneFirstSpawnDelay,
    fireTimer: mgPlaneFirstFireDelay,
    shake: 0,
    nextId: 1,
    rng: seedValue,
    lastEvents: [],
  };
  mgPlaneResetStars(state);
  return state;
}

export function startPlane(state, options) {
  const best = options && options.best;
  if (Number.isFinite(best) && best > state.best) state.best = best;
  state.phase = 'running';
  state.score = 0;
  state.lives = PLANE_LIVES;
  state.elapsed = 0;
  state.player.x = state.width / 2;
  state.player.y = mgPlanePlayerStartY;
  state.player.invuln = 0;
  state.bullets.length = 0;
  state.enemies.length = 0;
  state.particles.length = 0;
  state.spawnTimer = mgPlaneFirstSpawnDelay;
  state.fireTimer = mgPlaneFirstFireDelay;
  state.shake = 0;
  state.nextId = 1;
  state.lastEvents.length = 0;
  mgPlaneResetStars(state);
  return state;
}

export function pausePlane(state) {
  if (state.phase === 'running') state.phase = 'paused';
  return state;
}

export function resumePlane(state) {
  if (state.phase === 'paused') state.phase = 'running';
  return state;
}

export function planeBestOf(state) {
  return state && Number.isFinite(state.best) ? state.best : 0;
}

export function movePlayerBy(state, dx, dy) {
  const player = state.player;
  const stepX = Number(dx);
  const stepY = Number(dy);
  if (Number.isFinite(stepX)) player.x += stepX;
  if (Number.isFinite(stepY)) player.y += stepY;
  return mgPlaneClampPlayer(state);
}

export function setPlayerPosition(state, x, y) {
  const player = state.player;
  const nextX = Number(x);
  const nextY = Number(y);
  if (Number.isFinite(nextX)) player.x = nextX;
  if (Number.isFinite(nextY)) player.y = nextY;
  return mgPlaneClampPlayer(state);
}

export function stepPlane(state, dtSeconds) {
  if (!state || state.phase !== 'running') return state;

  state.lastEvents.length = 0;

  let dt = Number(dtSeconds);
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > mgPlaneMaxDt) dt = mgPlaneMaxDt;
  if (dt === 0) return state;

  const player = state.player;
  state.elapsed += dt;

  /* timers ---------------------------------------------------------- */
  player.invuln = player.invuln > 0 ? Math.max(0, player.invuln - dt) : 0;

  state.fireTimer -= dt;
  while (state.fireTimer <= 0) {
    state.fireTimer += mgPlaneFireInterval;
    if (state.bullets.length + 2 <= mgPlaneMaxBullets) {
      mgPlaneSpawnBullets(state);
      mgPlanePushEvent(state, { type: 'shot' });
    }
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    state.spawnTimer += mgPlaneSpawnInterval(state.elapsed);
    if (state.enemies.length < mgPlaneMaxEnemies) mgPlaneSpawnEnemy(state);
  }

  /* bullets --------------------------------------------------------- */
  const bullets = state.bullets;
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    bullet.y += bullet.vy * dt;
    if (bullet.y + bullet.height / 2 < 0) bullets.splice(i, 1);
  }

  /* enemies --------------------------------------------------------- */
  const enemies = state.enemies;
  const speedFactor = mgPlaneSpeedFactor(state.elapsed);
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    const def = PLANE_ENEMY_TYPES[enemy.type] || PLANE_ENEMY_TYPES.scout;
    enemy.y += def.baseSpeed * speedFactor * dt;
    enemy.x +=
      (enemy.vx + Math.sin(state.elapsed * 2.2 + enemy.phase) * enemy.drift) * dt;
    const halfW = enemy.width / 2;
    if (enemy.x < halfW) enemy.x = halfW;
    else if (enemy.x > state.width - halfW) enemy.x = state.width - halfW;
    if (enemy.y - enemy.height / 2 > state.height + 4) enemies.splice(i, 1);
  }

  /* bullets vs enemies: one bullet damages at most one enemy, consumed. */
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    const def = PLANE_ENEMY_TYPES[enemy.type] || PLANE_ENEMY_TYPES.scout;
    for (let j = bullets.length - 1; j >= 0; j -= 1) {
      const bullet = bullets[j];
      if (
        !mgPlaneOverlap(
          bullet.x,
          bullet.y,
          bullet.width,
          bullet.height,
          enemy.x,
          enemy.y,
          enemy.width,
          enemy.height,
        )
      ) {
        continue;
      }
      bullets.splice(j, 1);
      enemy.hp -= 1;
      mgPlanePushEvent(state, { type: 'hit' });
      if (enemy.hp <= 0) {
        const tone = def.tone || 1;
        state.score += def.score;
        mgPlanePushEvent(state, { type: 'explode', size: tone });
        mgPlaneExplode(state, enemy.x, enemy.y, tone);
        enemies.splice(i, 1);
      }
      break;
    }
  }

  /* player vs enemies ----------------------------------------------- */
  if (player.invuln <= 0) {
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (
        !mgPlaneOverlap(
          player.x,
          player.y,
          player.width,
          player.height,
          enemy.x,
          enemy.y,
          enemy.width,
          enemy.height,
        )
      ) {
        continue;
      }
      const def = PLANE_ENEMY_TYPES[enemy.type] || PLANE_ENEMY_TYPES.scout;
      enemies.splice(i, 1);
      mgPlaneExplode(state, enemy.x, enemy.y, def.tone || 1);
      state.lives -= 1;
      state.shake = 1;
      player.invuln = mgPlaneInvulnTime;
      mgPlanePushEvent(state, { type: 'damage' });
      if (state.lives <= 0) {
        state.lives = 0;
        state.phase = 'over';
        if (state.score > state.best) state.best = state.score;
        mgPlanePushEvent(state, { type: 'over' });
      }
      break;
    }
  }

  /* particles ------------------------------------------------------- */
  const particles = state.particles;
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 90 * dt;
  }

  /* stars ----------------------------------------------------------- */
  const stars = state.stars;
  for (let i = 0; i < stars.length; i += 1) {
    const star = stars[i];
    star.y += star.speed * dt;
    if (star.y - star.size > state.height) star.y = -star.size;
  }

  state.shake = state.shake > 0 ? Math.max(0, state.shake - mgPlaneShakeDecay * dt) : 0;

  return state;
}
