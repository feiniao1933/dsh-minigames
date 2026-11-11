/**
 * Node test suite for the pure underwater Flappy-whale simulation (`src/flappy.js`).
 *
 * Run with:  node test/flappy.test.mjs
 * Plain assertions only (node:assert/strict); exits non-zero on failure.
 *
 * Covers:
 *   1. create / start / reset state shape, JSON-ability, best preservation
 *   2. pause / resume and step no-ops outside the running phase
 *   3. gravity, flap reversal, repeated-flap clamp, ceiling clamp
 *   4. pipes: spawn off-screen right, safe gaps, scroll, cull, bounded count
 *   5. scoring: exactly once when the gap is passed, never before
 *   6. fatal collisions: coral column and seabed, best update, hit/over events
 *   7. determinism for a fixed seed + fixed scripted auto-flap policy
 *   8. 90-second simulated run: finite numbers, bounded arrays, score, timing
 *   9. lastEvents semantics: flap/score/hit/over, cleared each step, capped
 */
import assert from 'node:assert/strict';
import {
  FLAPPY_WORLD,
  FLAPPY_BIRD,
  FLAPPY_TUNING,
  createFlappyState,
  startFlappy,
  pauseFlappy,
  resumeFlappy,
  flapFlappy,
  stepFlappy,
  flappyBestOf,
} from '../src/flappy.js';

const DT = 1 / 60;
const BIRD_HALF_H = FLAPPY_BIRD.height / 2;
const GAP_MIN_Y = FLAPPY_TUNING.pipeGap / 2 + 90;
const GAP_MAX_Y = FLAPPY_WORLD.height - FLAPPY_TUNING.pipeGap / 2 - 110;

let passed = 0;
const failures = [];

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

function checkFiniteDeep(value, label) {
  const bad = [];
  const walk = (node, path) => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) bad.push(path);
      return;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) walk(node[key], `${path}.${key}`);
    }
  };
  walk(value, '$');
  check(bad.length === 0, `${label}: all numbers finite (${bad.slice(0, 6).join(', ')})`);
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

function newRunning(seed = 1) {
  const state = createFlappyState(seed);
  return startFlappy(state);
}

function pinBird(state, y, vy = 0) {
  state.bird.y = y;
  state.bird.vy = vy;
}

/** Push one hand-built pipe pair (bypasses RNG so tests stay focused). */
function putPipe(state, x, gapY) {
  state.pipes.length = 0;
  state.pipes.push({
    id: 999,
    x,
    gapY,
    gapHeight: FLAPPY_TUNING.pipeGap,
    width: FLAPPY_TUNING.pipeWidth,
    height: state.height,
    scored: false,
  });
  return state.pipes[0];
}

/** Next pipe pair whose right edge has not yet passed the whale. */
function nextPipe(state) {
  const birdLeft = state.bird.x - state.bird.width / 2;
  let next = null;
  for (const pipe of state.pipes) {
    if (pipe.x + pipe.width / 2 <= birdLeft) continue;
    if (!next || pipe.x < next) next = pipe;
  }
  return next;
}

/**
 * Step while keeping the whale pinned to the centre of whatever gap currently
 * overlaps it, so pipe mechanics can be observed without dying. Used only by
 * pipe/scoring mechanics tests, never by the physical-policy tests.
 */
function safeStep(state, steps = 1) {
  for (let i = 0; i < steps; i += 1) {
    if (state.phase !== 'running') return;
    const reach = (FLAPPY_TUNING.pipeWidth + state.bird.width) / 2 + 6;
    let inGap = null;
    for (const pipe of state.pipes) {
      if (Math.abs(pipe.x - state.bird.x) < reach) {
        if (!inGap || pipe.x < inGap.x) inGap = pipe;
      }
    }
    pinBird(state, inGap ? inGap.gapY : state.height / 2);
    stepFlappy(state, DT);
  }
}

/**
 * Scripted auto-flap policy: hold the whale near the centre of the next gap
 * (flap whenever it has sunk 18 px below that centre). Deterministic.
 */
function autoFlap(state) {
  const target = nextPipe(state);
  const aimY = target ? target.gapY : state.height / 2;
  if (state.bird.y > aimY + 18) flapFlappy(state);
}

function runAuto(seed, seconds) {
  const state = newRunning(seed);
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    if (state.phase !== 'running') break;
    autoFlap(state);
    stepFlappy(state, DT);
  }
  return state;
}

/** Fixed-step auto-play that restarts after a death (deterministic). */
function runAutoForSimTime(seed, seconds) {
  const state = newRunning(seed);
  const targetSteps = Math.round(seconds / DT);
  let steps = 0;
  let runs = 1;
  let deaths = 0;
  let bestRunScore = 0;
  let maxPipes = 0;
  let maxEvents = 0;
  let scoreEvents = 0;
  for (; steps < targetSteps; steps += 1) {
    if (state.phase !== 'running') {
      deaths += 1;
      runs += 1;
      startFlappy(state);
      continue;
    }
    autoFlap(state);
    stepFlappy(state, DT);
    bestRunScore = Math.max(bestRunScore, state.score);
    maxPipes = Math.max(maxPipes, state.pipes.length);
    maxEvents = Math.max(maxEvents, state.lastEvents.length);
    for (const event of state.lastEvents) if (event.type === 'score') scoreEvents += 1;
  }
  return { state, steps, runs, deaths, bestRunScore, maxPipes, maxEvents, scoreEvents };
}

/* ------------------------------------------------------------------ */
/* 1. create / start / reset                                           */
/* ------------------------------------------------------------------ */

run('1. create / start / reset keep best and JSON-able state', () => {
  const state = createFlappyState(1234);
  checkEqual(state.phase, 'idle', 'new state is idle');
  checkEqual(state.width, FLAPPY_WORLD.width, 'world width');
  checkEqual(state.height, FLAPPY_WORLD.height, 'world height');
  checkEqual(state.score, 0, 'initial score 0');
  checkEqual(state.best, 0, 'initial best 0');
  checkEqual(state.elapsed, 0, 'initial elapsed 0');
  checkEqual(state.speed, FLAPPY_TUNING.baseSpeed, 'initial speed = baseSpeed');
  checkEqual(state.pipes, [], 'initial pipes empty');
  checkEqual(state.lastEvents, [], 'initial events empty');
  checkEqual(state.nextPipeId, 1, 'initial nextPipeId 1');
  checkEqual(state.bubbles.length, 40, 'decorative bubbles created');
  checkEqual(state.bird.x, FLAPPY_WORLD.width * 0.3, 'bird x fixed at 0.3*width');
  checkEqual(state.bird.width, FLAPPY_BIRD.width, 'bird collision width');
  checkEqual(state.bird.height, FLAPPY_BIRD.height, 'bird collision height');
  checkEqual(state.bird.vy, 0, 'bird starts with zero velocity');
  checkFiniteDeep(state, 'created state');

  const roundTrip = JSON.parse(JSON.stringify(state));
  checkEqual(roundTrip, state, 'state survives JSON round-trip');

  state.score = 5;
  startFlappy(state, { best: 7 });
  checkEqual(state.phase, 'running', 'start -> running');
  checkEqual(state.score, 0, 'start resets score');
  checkEqual(state.best, 7, 'start adopts higher options.best');
  checkEqual(state.elapsed, 0, 'start resets elapsed');
  checkEqual(state.pipes.length, 1, 'start pre-places exactly one pipe pair');
  checkEqual(state.pipes[0].x, FLAPPY_WORLD.width + 80, 'first pair enters at width+80');
  checkEqual(state.nextPipeId, 2, 'start resets and consumes pipe id');
  checkEqual(state.bubbles.length, 40, 'start recreates bubbles');
  checkEqual(state.bird.y, FLAPPY_WORLD.height * 0.45, 'start resets bird y');
  checkEqual(state.bird.vy, 0, 'start resets bird vy');
  checkEqual(state.speed, FLAPPY_TUNING.baseSpeed, 'start resets speed');

  state.best = 9;
  startFlappy(state);
  checkEqual(state.best, 9, 'restart without options preserves best');
  startFlappy(state, { best: 4 });
  checkEqual(state.best, 9, 'lower options.best never lowers best');
  startFlappy(state, { best: 12 });
  checkEqual(state.best, 12, 'higher options.best is adopted');
  checkEqual(flappyBestOf(state), 12, 'flappyBestOf reads best');
  checkEqual(flappyBestOf(null), 0, 'flappyBestOf tolerates null');
});

/* ------------------------------------------------------------------ */
/* 2. pause / resume / no-op phases                                    */
/* ------------------------------------------------------------------ */

run('2. pause / resume and step no-ops outside running', () => {
  const state = newRunning(3);
  const elapsed = state.elapsed;
  const birdY = state.bird.y;
  const pipeX = state.pipes[0].x;
  const score = state.score;

  pauseFlappy(state);
  checkEqual(state.phase, 'paused', 'pause -> paused');
  pauseFlappy(state);
  checkEqual(state.phase, 'paused', 'pause is idempotent');
  stepFlappy(state, 0.5);
  checkEqual(state.phase, 'paused', 'step keeps paused phase');
  checkEqual(state.elapsed, elapsed, 'step advances nothing while paused');
  checkEqual(state.bird.y, birdY, 'bird frozen while paused');
  checkEqual(state.pipes[0].x, pipeX, 'pipes frozen while paused');
  checkEqual(state.score, score, 'score frozen while paused');

  resumeFlappy(state);
  checkEqual(state.phase, 'running', 'resume -> running');
  resumeFlappy(state);
  checkEqual(state.phase, 'running', 'resume is idempotent');
  stepFlappy(state, DT);
  check(state.elapsed > elapsed, 'step advances once resumed');

  const idle = createFlappyState(4);
  pauseFlappy(idle);
  resumeFlappy(idle);
  checkEqual(idle.phase, 'idle', 'pause/resume never leave idle');
  const idleY = idle.bird.y;
  stepFlappy(idle, 0.5);
  checkEqual(idle.phase, 'idle', 'idle step is a no-op');
  checkEqual(idle.bird.y, idleY, 'idle bird frozen');
  checkEqual(idle.elapsed, 0, 'idle elapsed frozen');

  const dead = newRunning(5);
  for (let i = 0; i < 400 && dead.phase === 'running'; i += 1) stepFlappy(dead, DT);
  checkEqual(dead.phase, 'over', 'unguarded fall reaches over');
  const deadElapsed = dead.elapsed;
  const deadY = dead.bird.y;
  stepFlappy(dead, 0.5);
  checkEqual(dead.elapsed, deadElapsed, 'over step is a no-op');
  checkEqual(dead.bird.y, deadY, 'over bird frozen');
  pauseFlappy(dead);
  checkEqual(dead.phase, 'over', 'pause does not resurface an over run');
  resumeFlappy(dead);
  checkEqual(dead.phase, 'over', 'resume does not restart an over run');
  flapFlappy(dead);
  checkEqual(dead.bird.vy, 0, 'flap no-op when over');
});

/* ------------------------------------------------------------------ */
/* 3. gravity / flap / ceiling                                         */
/* ------------------------------------------------------------------ */

run('3. gravity, flap reversal, repeated-flap and ceiling clamps', () => {
  const state = newRunning(6);
  const y0 = state.bird.y;
  stepFlappy(state, 0.02);
  const vy1 = state.bird.vy;
  closeTo(vy1, FLAPPY_TUNING.gravity * 0.02, 1e-6, 'gravity accelerates vy');
  stepFlappy(state, 0.02);
  const vy2 = state.bird.vy;
  closeTo(vy2, FLAPPY_TUNING.gravity * 0.04, 1e-6, 'falling keeps accelerating');
  check(vy2 > vy1, 'vy grows while falling');
  check(state.bird.y > y0, 'bird falls under gravity');
  check(vy2 <= FLAPPY_TUNING.maxFallSpeed, 'fall speed clamped to maxFallSpeed');

  flapFlappy(state);
  checkEqual(state.bird.vy, FLAPPY_TUNING.flapVelocity, 'flap overrides vy immediately');
  check(state.bird.angle < 0, 'flap pitches the whale up (angle < 0)');
  const yBeforeRise = state.bird.y;
  stepFlappy(state, DT);
  check(state.bird.y < yBeforeRise, 'bird rises after a flap');

  for (let i = 0; i < 5; i += 1) flapFlappy(state);
  checkEqual(state.bird.vy, FLAPPY_TUNING.flapVelocity, 'repeated flaps clamp at flapVelocity');
  check(state.bird.y >= BIRD_HALF_H, 'repeated flaps never put the box above the world');

  let minY = state.bird.y;
  let sawCeiling = false;
  /* 80 steps (~1.3 s): enough to reach the top, too short for the first
     pipe pair (x ~240) to reach the whale yet. */
  for (let i = 0; i < 80 && state.phase === 'running'; i += 1) {
    flapFlappy(state);
    stepFlappy(state, DT);
    minY = Math.min(minY, state.bird.y);
    if (state.bird.y <= BIRD_HALF_H + 1e-9) {
      sawCeiling = true;
      check(state.bird.vy >= 0, 'ceiling contact zeroes upward velocity');
    }
  }
  check(sawCeiling, 'ceiling clamp is reached by repeated flaps');
  check(minY >= BIRD_HALF_H - 1e-9, `bird box stays below the top edge (min y ${minY})`);
  checkEqual(state.phase, 'running', 'ceiling is not fatal');

  const fast = newRunning(7);
  fast.bird.vy = FLAPPY_TUNING.maxFallSpeed;
  stepFlappy(fast, 0.05);
  closeTo(fast.bird.vy, FLAPPY_TUNING.maxFallSpeed, 1e-6, 'vy never exceeds maxFallSpeed');

  const clamped = newRunning(8);
  clamped.pipes.length = 0;
  const clampedY = clamped.bird.y;
  stepFlappy(clamped, 10);
  closeTo(clamped.elapsed, 0.05, 1e-9, 'dt is clamped to 0.05 s');
  closeTo(clamped.bird.y - clampedY, FLAPPY_TUNING.gravity * 0.05 * 0.05, 1e-9, 'physics runs with the clamped dt');

  const broken = newRunning(8);
  const brokenElapsed = broken.elapsed;
  stepFlappy(broken, NaN);
  checkEqual(broken.elapsed, brokenElapsed, 'NaN dt is a no-op');
  stepFlappy(broken, -1);
  checkEqual(broken.elapsed, brokenElapsed, 'negative dt is a no-op');
});

/* ------------------------------------------------------------------ */
/* 4. pipes: spawn, gap safety, scroll, cull, bound                    */
/* ------------------------------------------------------------------ */

run('4. pipes spawn off-screen right, scroll, cull and stay bounded', () => {
  const state = newRunning(11);
  const first = state.pipes[0];
  checkEqual(state.pipes.length, 1, 'one pair on start');
  check(first.x > state.width, 'first pair starts right of the world');
  check(first.gapY >= GAP_MIN_Y - 1e-9 && first.gapY <= GAP_MAX_Y + 1e-9, 'first gap is in the safe range');
  checkEqual(first.gapHeight, FLAPPY_TUNING.pipeGap, 'gap height matches tuning');
  checkEqual(first.width, FLAPPY_TUNING.pipeWidth, 'pipe width matches tuning');
  checkEqual(first.scored, false, 'fresh pipe is unscored');

  const x0 = first.x;
  for (let i = 0; i < 120; i += 1) safeStep(state, 1);
  check(first.x < x0, 'pipes scroll left');
  closeTo(first.x, x0 - FLAPPY_TUNING.baseSpeed * 2, 1e-6, 'scroll distance matches baseSpeed after 2 s');
  let spawned = null;
  for (let i = 0; i < 400 && spawned === null; i += 1) {
    safeStep(state, 1);
    if (state.pipes.length > 1) spawned = { x: state.pipes[1].x, id: state.pipes[1].id };
  }
  checkEqual(state.pipes.length, 2, 'second pair spawned after spacing delay');
  check(spawned !== null, 'second pair was observed appearing');
  check(spawned !== null && spawned.x > state.width, 'new pair enters right of the world');
  closeTo(spawned !== null ? spawned.x : -1, state.width + FLAPPY_TUNING.pipeWidth / 2, 5, 'new pair spawns at width+pipeWidth/2');
  check(state.pipes[1].id > state.pipes[0].id, 'new pair gets a fresh id');
  check(state.pipes[1].x > first.x, 'new pair is the rightmost (appended last)');

  let maxPipes = state.pipes.length;
  let maxId = 0;
  const seen = new Set();
  for (let i = 0; i < 600 && state.phase === 'running'; i += 1) {
    safeStep(state, 1);
    maxPipes = Math.max(maxPipes, state.pipes.length);
    check(state.pipes.length <= 5, 'pipe array bounded by 5');
    check(state.bubbles.length <= 40, 'bubble array bounded by 40');
    for (const pipe of state.pipes) {
      seen.add(pipe.id);
      maxId = Math.max(maxId, pipe.id);
      check(pipe.x + pipe.width / 2 >= 0, 'fully off-screen pairs are culled');
      check(pipe.gapY >= GAP_MIN_Y - 1e-9 && pipe.gapY <= GAP_MAX_Y + 1e-9, 'all gaps stay in the safe range');
    }
  }
  checkEqual(state.phase, 'running', 'pipe mechanics test never dies');
  check(maxPipes >= 2, `pairs accumulate on screen (max ${maxPipes})`);
  check(maxId > first.id, 'new pipe ids are allocated');
  check(seen.has(first.id), 'first pair was on screen before being culled');
  check(!state.pipes.some((pipe) => pipe.id === first.id), 'first pair fully culled after 12 s');
  check(state.pipes.length >= 1, 'pipes keep spawning');
  console.log(`  notes: max pipes on screen ${maxPipes}, ids seen ${[...seen].join(',')}`);
});

/* ------------------------------------------------------------------ */
/* 5. scoring: exactly once, only after passing the whale             */
/* ------------------------------------------------------------------ */

run('5. scoring increments exactly once when the gap is passed', () => {
  const state = newRunning(21);
  const pipe = putPipe(state, state.bird.x + 80, 300);
  pinBird(state, 300);
  const birdLeft = state.bird.x - state.bird.width / 2;

  let scoreEvents = 0;
  let wasPassed = false;
  for (let i = 0; i < 90; i += 1) {
    pinBird(state, 300);
    stepFlappy(state, DT);
    const isPassed = pipe.x + pipe.width / 2 < birdLeft;
    check(state.score === (isPassed ? 1 : 0), `score ${state.score} matches passed=${isPassed} (step ${i})`);
    const hasScoreEvent = state.lastEvents.some((event) => event.type === 'score');
    if (isPassed !== wasPassed) {
      check(hasScoreEvent, 'score event fires on the crossing step');
      checkEqual(pipe.scored, true, 'pipe marked scored on crossing');
    } else {
      check(!hasScoreEvent, 'no score event on non-crossing steps');
    }
    if (hasScoreEvent) scoreEvents += 1;
    wasPassed = isPassed;
  }
  check(wasPassed, 'custom pair was actually passed');
  checkEqual(scoreEvents, 1, 'exactly one score event total');
  checkEqual(state.score, 1, 'score incremented exactly once');
  checkEqual(state.phase, 'running', 'scoring is not fatal');
  check(state.pipes.length >= 1, 'spawned pipes still exist alongside scored one');

  const idle = createFlappyState(22);
  checkEqual(idle.score, 0, 'idle score stays 0');
});

/* ------------------------------------------------------------------ */
/* 6. fatal collisions: coral column and seabed                       */
/* ------------------------------------------------------------------ */

run('6. pipe hit and seabed contact end the run with hit/over', () => {
  const hitState = newRunning(31);
  hitState.score = 3;
  hitState.lastEvents.push({ type: 'flap' });
  putPipe(hitState, hitState.bird.x, 100);
  stepFlappy(hitState, DT);
  checkEqual(hitState.phase, 'over', 'pipe overlap ends the run');
  checkEqual(hitState.best, 3, 'best updated from score on pipe hit');
  checkEqual(hitState.bird.vy, 0, 'vertical velocity zeroed on death');
  checkEqual(
    hitState.lastEvents.map((event) => event.type),
    ['hit', 'over'],
    'pipe hit emits hit then over (previous events cleared)',
  );

  const afterElapsed = hitState.elapsed;
  stepFlappy(hitState, 0.5);
  checkEqual(hitState.elapsed, afterElapsed, 'over state stops simulating');

  const floorState = newRunning(32);
  floorState.pipes.length = 0;
  floorState.score = 2;
  floorState.best = 0;
  let finalEvents = [];
  for (let i = 0; i < 300 && floorState.phase === 'running'; i += 1) {
    stepFlappy(floorState, DT);
    finalEvents = floorState.lastEvents.slice();
  }
  checkEqual(floorState.phase, 'over', 'seabed contact ends the run');
  checkEqual(floorState.best, 2, 'best updated from score on seabed contact');
  closeTo(floorState.bird.y + floorState.bird.height / 2, FLAPPY_WORLD.height, 1e-9, 'bird box rests on the seabed');
  checkEqual(
    finalEvents.map((event) => event.type),
    ['hit', 'over'],
    'seabed emits hit then over',
  );
  checkFiniteDeep(floorState, 'over state');

  startFlappy(floorState, { best: 2 });
  floorState.score = 1;
  floorState.pipes.length = 0;
  for (let i = 0; i < 300 && floorState.phase === 'running'; i += 1) stepFlappy(floorState, DT);
  checkEqual(floorState.phase, 'over', 'next run can also die');
  checkEqual(floorState.best, 2, 'a lower score never lowers best');

  const clean = newRunning(33);
  clean.pipes.length = 0;
  stepFlappy(clean, 0.05);
  checkEqual(clean.phase, 'running', 'falling briefly without pipes is safe');
});

/* ------------------------------------------------------------------ */
/* 7. determinism                                                      */
/* ------------------------------------------------------------------ */

run('7. same seed + same scripted flaps is deterministic', () => {
  const a = runAuto(777, 15);
  const b = runAuto(777, 15);
  checkEqual(JSON.stringify(a), JSON.stringify(b), 'two identical runs produce identical state');
  checkEqual(a.score, b.score, 'identical scores');
  checkEqual(a.phase, b.phase, 'identical phases');
  checkEqual(a.pipes.map((pipe) => [pipe.id, pipe.x, pipe.gapY, pipe.scored]), b.pipes.map((pipe) => [pipe.id, pipe.x, pipe.gapY, pipe.scored]), 'identical pipe state');

  const c = runAuto(778, 15);
  check(JSON.stringify(a) !== JSON.stringify(c), 'a different seed produces a different run');
});

/* ------------------------------------------------------------------ */
/* 8. 90-second simulated run                                          */
/* ------------------------------------------------------------------ */

run('8. 90 s at 1/60 dt with auto-flap: finite, bounded, fast', () => {
  const wallStart = performance.now();
  const result = runAutoForSimTime(2024, 90);
  const wallMs = performance.now() - wallStart;
  const state = result.state;

  checkFiniteDeep(state, '90 s state');
  checkEqual(result.steps, Math.round(90 / DT), '90 s of 1/60 steps simulated');
  closeTo((result.steps * DT), 90, 1e-9, 'simulated time totals 90 s');
  check(result.bestRunScore >= 5, `best run score is >= 5 (got ${result.bestRunScore})`);
  check(result.scoreEvents >= 5, `score events accumulate across runs (got ${result.scoreEvents})`);
  check(result.maxPipes <= 5, `at most 5 pipe pairs on screen (max ${result.maxPipes})`);
  checkEqual(state.bubbles.length, 40, 'bubble count stays bounded');
  check(result.maxEvents <= 6, `at most 6 events per step (max ${result.maxEvents})`);
  check(wallMs < 2000, `90 s simulation wall time under 2 s (got ${wallMs.toFixed(1)} ms)`);
  console.log(
    `  notes: 90 s auto-play -> ${result.runs} run(s), ${result.deaths} death(s), best score ${result.bestRunScore}, ` +
      `final score ${state.score}, ${result.scoreEvents} score events, maxPipes=${result.maxPipes}, ` +
      `maxEvents/step=${result.maxEvents}, wall=${wallMs.toFixed(1)}ms`,
  );
});

/* ------------------------------------------------------------------ */
/* 9. lastEvents semantics                                             */
/* ------------------------------------------------------------------ */

run('9. lastEvents: flap/score/hit/over, cleared each step, capped', () => {
  const state = newRunning(9);
  checkEqual(state.lastEvents, [], 'no events right after start');

  flapFlappy(state);
  checkEqual(state.lastEvents, [{ type: 'flap' }], 'flap pushes a flap event');
  check(state.bird.vy < 0, 'flap event pairs with upward velocity');
  stepFlappy(state, 0);
  checkEqual(state.lastEvents, [], 'dt=0 step clears lastEvents');

  pauseFlappy(state);
  state.lastEvents.length = 0;
  flapFlappy(state);
  checkEqual(state.lastEvents, [], 'paused flap emits no event');
  resumeFlappy(state);

  for (let i = 0; i < 8; i += 1) flapFlappy(state);
  check(state.lastEvents.length <= 6, 'event queue is capped at 6');
  stepFlappy(state, 0);
  checkEqual(state.lastEvents, [], 'step clears the previous event queue');

  const scoring = newRunning(10);
  const pipe = putPipe(scoring, scoring.bird.x + 80, 300);
  pinBird(scoring, 300);
  const birdLeft = scoring.bird.x - scoring.bird.width / 2;
  let sawScore = false;
  for (let i = 0; i < 90 && !sawScore; i += 1) {
    pinBird(scoring, 300);
    stepFlappy(scoring, DT);
    for (const event of scoring.lastEvents) {
      check(typeof event.type === 'string', 'events are plain objects with a type');
      if (event.type === 'score') sawScore = true;
    }
    if (pipe.x + pipe.width / 2 >= birdLeft) {
      check(!scoring.lastEvents.some((event) => event.type === 'score'), 'no score event before passing');
    }
  }
  check(sawScore, 'score event appears when the gap is passed');

  const dying = newRunning(12);
  putPipe(dying, dying.bird.x, 80);
  dying.lastEvents.push({ type: 'flap' });
  stepFlappy(dying, DT);
  checkEqual(
    dying.lastEvents.map((event) => event.type),
    ['hit', 'over'],
    'hit/over emitted in order and old events cleared',
  );

  const fresh = newRunning(13);
  stepFlappy(fresh, DT);
  checkEqual(
    fresh.lastEvents.filter((event) => event.type === 'score').length,
    0,
    'step without a crossing emits no score event',
  );
  check(fresh.lastEvents.every((event) => event.type === 'flap'), 'ordinary steps emit no hit/over');
});

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

console.log(`\n${'-'.repeat(64)}`);
if (failures.length === 0) {
  console.log(`PASS: ${passed} checks passed, 0 failed`);
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${passed} checks passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
