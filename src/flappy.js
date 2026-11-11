/**
 * Pure simulation core for the underwater Flappy-Bird clone "鲸鱼飞飞"
 * (Flappy whale) in the DSH "游戏盒子" plugin.
 *
 * Contract (must hold for `build.mjs`, which strips leading `export ` lines and
 * concatenates this file into one browser function scope together with
 * `src/engine.js`, `src/plane.js` and `src/ui.js`):
 *   - self-contained ESM with NO imports, NO DOM/canvas, NO audio, NO timers,
 *     NO async / top-level await and NO `export default`;
 *   - all module-level identifiers are unique: the public `FLAPPY_*` constants,
 *     the exported functions and internals prefixed `mgFlappy`/`flappy`;
 *     never define `React`, `apply`, `inject`, `PLANE_*`, `mgPlane*`, etc.;
 *   - state is a plain JSON-able object (no class instances, no Infinity/NaN);
 *     ids are unique and every entity array is bounded.
 *
 * World is fixed at 360 x 600 logical units (origin top-left, y grows down).
 * The whale's x is fixed, only y changes; the body of the whale is the AABB
 * `FLAPPY_BIRD`, `bird.x`/`bird.y` are the box CENTRE. Simulation is
 * frame-rate independent: `stepFlappy(state, dtSeconds)` clamps dt to <= 0.05 s.
 *
 * The UI owns input, rendering (whale, light rays, seabed, bubbles, coral
 * pipes), audio, HUD/pause overlays and best-score persistence. It consumes
 * `state.lastEvents` after every step; this file never touches the outside.
 */

export const FLAPPY_WORLD = { width: 360, height: 600 };
export const FLAPPY_BIRD = { width: 40, height: 28 };

/**
 * Documented tuning numbers (the UI may read them but must not depend on them).
 *
 *   gravity      downward acceleration in px/s^2
 *   flapVelocity vy set by a flap (negative = upward), px/s
 *   maxFallSpeed terminal fall speed, px/s
 *   pipeWidth    coral column width, px
 *   pipeGap      vertical opening between the two columns, px
 *   pipeSpacing  horizontal distance between pipe-pair centres, px
 *   baseSpeed    scroll speed at score 0, px/s
 *   speedRamp    extra scroll speed per point, px/s
 *   ceilMargin   extra inset below the top edge for the (non-fatal) ceiling
 */
export const FLAPPY_TUNING = {
  gravity: 1500,
  flapVelocity: -420,
  maxFallSpeed: 760,
  pipeWidth: 62,
  pipeGap: 172,
  pipeSpacing: 205,
  baseSpeed: 150,
  speedRamp: 2.2,
  ceilMargin: 0,
};

/* ------------------------------------------------------------------ */
/* Internal constants (flappy/mgFlappy prefix protects bundle scope)   */
/* ------------------------------------------------------------------ */

const flappyMaxDt = 0.05;
const flappyBirdX = FLAPPY_WORLD.width * 0.3;
const flappyBirdStartRatio = 0.45;
const flappyMaxSpeedBonus = 90;
const flappyFirstPipeOffset = 80;
const flappyGapTopMargin = 90;
const flappyGapBottomMargin = 110;
const flappyMaxPipes = 5;
const flappyBubbleCount = 40;
const flappyBubbleMinSize = 2;
const flappyBubbleSizeRange = 5;
const flappyBubbleMinSpeed = 14;
const flappyBubbleSpeedRange = 34;
const flappyBubbleMinDrift = 4;
const flappyBubbleDriftRange = 10;
const flappyBubbleWrapShift = 41.7;
const flappyEventCap = 6;
const flappyAngleDivisor = 820;
const flappyAngleMin = -0.5;
const flappyAngleMax = 0.85;

/* ------------------------------------------------------------------ */
/* Deterministic RNG (mulberry32, state kept as a uint32 inside state) */
/* ------------------------------------------------------------------ */

function mgFlappyRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Push a UI-triggering event, hard-capped so one step stays bounded. */
function mgFlappyPushEvent(state, event) {
  if (state.lastEvents.length < flappyEventCap) state.lastEvents.push(event);
}

/** Render-only pitch in radians: negative noses up, positive noses down. */
function mgFlappyAngleForVy(vy) {
  const normalized = vy / flappyAngleDivisor;
  if (normalized < flappyAngleMin) return flappyAngleMin;
  if (normalized > flappyAngleMax) return flappyAngleMax;
  return normalized;
}

/** Current scroll speed for a score (also mirrored into state.speed). */
function mgFlappySpeedForScore(score) {
  return FLAPPY_TUNING.baseSpeed + Math.min(flappyMaxSpeedBonus, score * FLAPPY_TUNING.speedRamp);
}

/** Axis-aligned box overlap, boxes given as left/top/width/height. */
function mgFlappyOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** True when the whale body overlaps the top or bottom coral column. */
function mgFlappyHitsPipe(state, pipe) {
  const bird = state.bird;
  const birdLeft = bird.x - bird.width / 2;
  const birdTop = bird.y - bird.height / 2;
  const pipeLeft = pipe.x - pipe.width / 2;
  const gapTop = pipe.gapY - pipe.gapHeight / 2;
  const gapBottom = pipe.gapY + pipe.gapHeight / 2;
  if (mgFlappyOverlap(birdLeft, birdTop, bird.width, bird.height, pipeLeft, 0, pipe.width, gapTop)) {
    return true;
  }
  return mgFlappyOverlap(
    birdLeft,
    birdTop,
    bird.width,
    bird.height,
    pipeLeft,
    gapBottom,
    pipe.width,
    state.height - gapBottom,
  );
}

/** End the run: one hit (or the seabed) is fatal, then record the best. */
function mgFlappyEndRun(state) {
  state.phase = 'over';
  if (state.score > state.best) state.best = state.score;
  state.bird.vy = 0;
  mgFlappyPushEvent(state, { type: 'hit' });
  mgFlappyPushEvent(state, { type: 'over' });
  return state;
}

/* ------------------------------------------------------------------ */
/* Entity factories                                                    */
/* ------------------------------------------------------------------ */

/** Create one coral pipe pair centred at `x` with a random safe opening. */
function mgFlappySpawnPipe(state, x) {
  if (state.pipes.length >= flappyMaxPipes) return;
  const gap = FLAPPY_TUNING.pipeGap;
  const minGapY = gap / 2 + flappyGapTopMargin;
  const maxGapY = state.height - gap / 2 - flappyGapBottomMargin;
  const gapY = minGapY + mgFlappyRandom(state) * (maxGapY - minGapY);
  state.pipes.push({
    id: state.nextPipeId,
    x,
    gapY,
    gapHeight: gap,
    width: FLAPPY_TUNING.pipeWidth,
    height: state.height,
    scored: false,
  });
  state.nextPipeId += 1;
}

/**
 * Spawn the first pair off-screen right, then keep pipeSpacing between pairs
 * (the arrival delay makes the first gap readable). Always keeps <= 5 pairs.
 */
function mgFlappySpawnDue(state) {
  if (state.pipes.length >= flappyMaxPipes) return;
  if (state.pipes.length === 0) {
    mgFlappySpawnPipe(state, state.width + flappyFirstPipeOffset);
    return;
  }
  const last = state.pipes[state.pipes.length - 1];
  const entryX = state.width + FLAPPY_TUNING.pipeWidth / 2;
  if (last.x <= entryX - FLAPPY_TUNING.pipeSpacing) {
    mgFlappySpawnPipe(state, entryX);
  }
}

/** Deterministic decoration only: rising bubbles, fixed count. */
function mgFlappyResetBubbles(state) {
  state.bubbles.length = 0;
  for (let i = 0; i < flappyBubbleCount; i += 1) {
    state.bubbles.push({
      id: i + 1,
      x: mgFlappyRandom(state) * state.width,
      y: mgFlappyRandom(state) * state.height,
      size: flappyBubbleMinSize + mgFlappyRandom(state) * flappyBubbleSizeRange,
      speed: flappyBubbleMinSpeed + mgFlappyRandom(state) * flappyBubbleSpeedRange,
      drift: flappyBubbleMinDrift + mgFlappyRandom(state) * flappyBubbleDriftRange,
      phase: mgFlappyRandom(state) * Math.PI * 2,
    });
  }
}

/** Rise, sway, and wrap from above the top back to below the seabed. */
function mgFlappyStepBubbles(state, dt) {
  const bubbles = state.bubbles;
  for (let i = 0; i < bubbles.length; i += 1) {
    const bubble = bubbles[i];
    bubble.y -= bubble.speed * dt;
    bubble.x += Math.sin(state.elapsed * 0.7 + bubble.phase) * bubble.drift * dt;
    if (bubble.y + bubble.size * 2 < 0) {
      bubble.y = state.height + bubble.size * 2;
      const shifted = bubble.x + flappyBubbleWrapShift + bubble.size;
      bubble.x = shifted % (state.width + bubble.size * 2);
    }
    if (bubble.x < -bubble.size) bubble.x += state.width + bubble.size * 2;
    else if (bubble.x > state.width + bubble.size) bubble.x -= state.width + bubble.size * 2;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function createFlappyState(seed) {
  const seedValue = Number.isFinite(seed)
    ? Math.floor(seed) >>> 0
    : ((Date.now() >>> 0) ^ 0x9e3779b9) >>> 0;
  const state = {
    phase: 'idle',
    width: FLAPPY_WORLD.width,
    height: FLAPPY_WORLD.height,
    bird: {
      x: flappyBirdX,
      y: FLAPPY_WORLD.height * flappyBirdStartRatio,
      width: FLAPPY_BIRD.width,
      height: FLAPPY_BIRD.height,
      vy: 0,
      angle: 0,
    },
    pipes: [],
    bubbles: [],
    score: 0,
    best: 0,
    elapsed: 0,
    speed: FLAPPY_TUNING.baseSpeed,
    nextPipeId: 1,
    rng: seedValue,
    lastEvents: [],
  };
  mgFlappyResetBubbles(state);
  return state;
}

/**
 * Reset the run and go. Mutates and returns `state`; keeps the best score
 * (a higher `options.best` is adopted too, like the plane game).
 */
export function startFlappy(state, options) {
  const best = options && options.best;
  if (Number.isFinite(best) && best > state.best) state.best = best;
  state.phase = 'running';
  state.score = 0;
  state.elapsed = 0;
  state.speed = FLAPPY_TUNING.baseSpeed;
  state.nextPipeId = 1;
  state.pipes.length = 0;
  state.lastEvents.length = 0;
  const bird = state.bird;
  bird.x = flappyBirdX;
  bird.y = state.height * flappyBirdStartRatio;
  bird.vy = 0;
  bird.angle = 0;
  mgFlappyResetBubbles(state);
  mgFlappySpawnPipe(state, state.width + flappyFirstPipeOffset);
  return state;
}

export function pauseFlappy(state) {
  if (state.phase === 'running') state.phase = 'paused';
  return state;
}

export function resumeFlappy(state) {
  if (state.phase === 'paused') state.phase = 'running';
  return state;
}

/** Flap: instant upward velocity. Only meaningful while running. */
export function flapFlappy(state) {
  if (state.phase !== 'running') return state;
  state.bird.vy = FLAPPY_TUNING.flapVelocity;
  state.bird.angle = mgFlappyAngleForVy(state.bird.vy);
  mgFlappyPushEvent(state, { type: 'flap' });
  return state;
}

export function flappyBestOf(state) {
  return state && Number.isFinite(state.best) ? state.best : 0;
}

/** Advance the simulation. No-op unless phase==='running'. */
export function stepFlappy(state, dtSeconds) {
  if (!state || state.phase !== 'running') return state;

  state.lastEvents.length = 0;

  let dt = Number(dtSeconds);
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > flappyMaxDt) dt = flappyMaxDt;
  if (dt === 0) return state;

  const bird = state.bird;
  state.elapsed += dt;
  state.speed = mgFlappySpeedForScore(state.score);

  /* whale physics --------------------------------------------------- */
  bird.vy = Math.min(FLAPPY_TUNING.maxFallSpeed, bird.vy + FLAPPY_TUNING.gravity * dt);
  bird.y += bird.vy * dt;
  bird.angle = mgFlappyAngleForVy(bird.vy);

  /* non-fatal ceiling: keep the whole box inside the top of the world */
  const ceilingY = bird.height / 2 + FLAPPY_TUNING.ceilMargin;
  if (bird.y < ceilingY) {
    bird.y = ceilingY;
    if (bird.vy < 0) bird.vy = 0;
    bird.angle = mgFlappyAngleForVy(bird.vy);
  }

  /* pipes: spawn off-screen right, scroll left, cull off-screen left --- */
  mgFlappySpawnDue(state);
  const pipes = state.pipes;
  const dx = state.speed * dt;
  for (let i = 0; i < pipes.length; i += 1) pipes[i].x -= dx;
  for (let i = pipes.length - 1; i >= 0; i -= 1) {
    if (pipes[i].x + pipes[i].width / 2 < 0) pipes.splice(i, 1);
  }

  /* scoring: the pair's right edge passed the whale's left edge ----- */
  const birdLeft = bird.x - bird.width / 2;
  for (let i = 0; i < pipes.length; i += 1) {
    const pipe = pipes[i];
    if (!pipe.scored && pipe.x + pipe.width / 2 < birdLeft) {
      pipe.scored = true;
      state.score += 1;
      mgFlappyPushEvent(state, { type: 'score' });
    }
  }

  /* fatal collisions: either coral column, then the seabed ---------- */
  for (let i = 0; i < pipes.length; i += 1) {
    if (mgFlappyHitsPipe(state, pipes[i])) return mgFlappyEndRun(state);
  }
  if (bird.y + bird.height / 2 >= state.height) {
    bird.y = state.height - bird.height / 2;
    return mgFlappyEndRun(state);
  }

  /* decoration + exposed derived values ----------------------------- */
  mgFlappyStepBubbles(state, dt);
  state.speed = mgFlappySpeedForScore(state.score);
  return state;
}
