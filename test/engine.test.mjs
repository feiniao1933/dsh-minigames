/**
 * Node test suite for the pure Gomoku engine (`src/engine.js`).
 *
 * Run with:  node test/engine.test.mjs
 * Plain assertions only; exits non-zero on the first failing suite run.
 *
 * Covers:
 *   1. win detection in all four directions + findWinLine contents
 *   2. immediate win is taken
 *   3. opponent immediate win is blocked
 *   4. opponent open-four / open-three extension is prevented
 *   5. legal, non-occupied results and no caller-board mutation
 *   6. >= 18 / 20 games vs a greedy win/block/local-heuristic opponent
 *   7. self-play game completes; every move within the 900 ms ceiling
 *   8. 30 random mid-game positions: timing avg / p95 / max within ceiling
 */
import {
  BOARD_SIZE,
  EMPTY,
  BLACK,
  WHITE,
  createBoard,
  isFiveAt,
  findWinLine,
  isFull,
  findImmediateWins,
  evaluate,
  chooseMove,
} from '../src/engine.js';

const N = BOARD_SIZE;
const idx = (x, y) => y * N + x;

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

function section(title) {
  console.log(`\n# ${title}`);
}

function put(board, x, y, value) {
  board[y * N + x] = value;
  return board;
}

function cloneBoard(board) {
  return Int8Array.from(board);
}

function boardsEqual(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** True when placing `player` at an empty `index` would win. */
function winAt(board, index, player) {
  if (board[index] !== EMPTY) return false;
  board[index] = player;
  const won = isFiveAt(board, index, player);
  board[index] = EMPTY;
  return won;
}

/** Would `player` be able to create an open four (two winning cells) next move? */
function hasOpenFourThreat(board, player) {
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] !== EMPTY) continue;
    board[i] = player;
    let winningCells = 0;
    for (let j = 0; j < board.length && winningCells < 2; j += 1) {
      if (board[j] !== EMPTY) continue;
      if (winAt(board, j, player)) winningCells += 1;
    }
    board[i] = EMPTY;
    if (winningCells >= 2) return true;
  }
  return false;
}

function isLegalResult(board, result, player) {
  return (
    result &&
    Number.isInteger(result.index) &&
    result.index >= 0 &&
    result.index < board.length &&
    board[result.index] === EMPTY &&
    typeof result.score === 'number' &&
    typeof result.depth === 'number' &&
    typeof result.nodes === 'number' &&
    typeof result.timeMs === 'number' &&
    typeof result.reason === 'string'
  );
}

/* Deterministic PRNG (mulberry32) so games are reproducible. */
function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 1. Win detection                                                    */
/* ------------------------------------------------------------------ */
section('1. win detection in four directions');

{
  const directions = [
    { name: 'horizontal', dx: 1, dy: 0 },
    { name: 'vertical', dx: 0, dy: 1 },
    { name: 'diagonal', dx: 1, dy: 1 },
    { name: 'anti-diagonal', dx: 1, dy: -1 },
  ];
  for (const dir of directions) {
    const board = createBoard();
    const startX = dir.dx === 0 ? 7 : 3;
    const startY = dir.dy === 1 ? 3 : dir.dy === -1 ? 10 : 7;
    const cells = [];
    for (let k = 0; k < 5; k += 1) {
      const x = startX + k * dir.dx;
      const y = startY + k * dir.dy;
      board[idx(x, y)] = BLACK;
      cells.push(idx(x, y));
    }
    const middle = cells[2];
    check(isFiveAt(board, middle, BLACK), `${dir.name}: five detected at middle stone`);
    check(!isFiveAt(board, middle, WHITE), `${dir.name}: not five for the other colour`);
    const line = findWinLine(board, middle, BLACK);
    check(Array.isArray(line) && line.length === 5, `${dir.name}: findWinLine returns 5 indices`);
    check(
      Array.isArray(line) && cells.every((cell) => line.includes(cell)),
      `${dir.name}: findWinLine contains every stone of the run`,
    );
    check(findWinLine(board, middle, WHITE) === null, `${dir.name}: findWinLine null for other colour`);
  }

  // Six in a row still wins and is reported as the full run.
  const six = createBoard();
  for (let k = 0; k < 6; k += 1) six[idx(2 + k, 5)] = WHITE;
  check(isFiveAt(six, idx(4, 5), WHITE), 'six in a row: isFiveAt true');
  const sixLine = findWinLine(six, idx(4, 5), WHITE);
  check(Array.isArray(sixLine) && sixLine.length === 6, 'six in a row: findWinLine returns all 6');

  // Four in a row is not a win.
  const four = createBoard();
  for (let k = 0; k < 4; k += 1) four[idx(3 + k, 9)] = BLACK;
  check(!isFiveAt(four, idx(4, 9), BLACK), 'four in a row: not five');
  check(findWinLine(four, idx(4, 9), BLACK) === null, 'four in a row: findWinLine null');

  // isFiveAt on an empty cell is false.
  check(!isFiveAt(createBoard(), idx(7, 7), BLACK), 'empty cell: not five');

  // findImmediateWins detects both closing cells of an open four.
  const openFour = createBoard();
  for (let k = 0; k < 4; k += 1) openFour[idx(5 + k, 7)] = BLACK;
  const closing = findImmediateWins(openFour, BLACK);
  check(
    closing.length === 2 && closing.includes(idx(4, 7)) && closing.includes(idx(9, 7)),
    'findImmediateWins: both ends of an open four',
  );
  check(findImmediateWins(openFour, WHITE).length === 0, 'findImmediateWins: none for the other colour');
}

/* ------------------------------------------------------------------ */
/* 2. Immediate win taken                                              */
/* ------------------------------------------------------------------ */
section('2. chooseMove takes an immediate win');

{
  const board = createBoard();
  for (let k = 0; k < 4; k += 1) put(board, 3 + k, 7, BLACK);
  put(board, 2, 7, WHITE); // left side blocked -> only (7,7) wins
  const before = cloneBoard(board);
  const result = chooseMove(board, BLACK);
  check(isLegalResult(board, result, BLACK), 'immediate win: legal result shape');
  check(winAt(board, result.index, BLACK), 'immediate win: chosen cell wins immediately');
  check(result.index === idx(7, 7), 'immediate win: takes the only winning point');
  check(boardsEqual(board, before), 'immediate win: caller board not mutated');
}

/* ------------------------------------------------------------------ */
/* 3. Opponent immediate win blocked                                   */
/* ------------------------------------------------------------------ */
section('3. chooseMove blocks the opponent immediate win');

{
  // White has a closed four: only (11,7) completes five; black must take it.
  const board = createBoard();
  for (let k = 0; k < 4; k += 1) put(board, 7 + k, 7, WHITE);
  put(board, 6, 7, BLACK);
  put(board, 4, 4, BLACK);
  put(board, 5, 4, BLACK);
  const before = cloneBoard(board);
  const result = chooseMove(board, BLACK);
  check(isLegalResult(board, result, BLACK), 'block: legal result shape');
  check(result.index === idx(11, 7), 'block: plays the opponent winning point');
  check(boardsEqual(board, before), 'block: caller board not mutated');

  // Same situation from the other colour, diagonally.
  const board2 = createBoard();
  for (let k = 0; k < 4; k += 1) put(board2, 3 + k, 3 + k, BLACK);
  put(board2, 2, 2, WHITE);
  const result2 = chooseMove(board2, WHITE);
  check(result2.index === idx(7, 7), 'block: diagonal winning point');
  board2[result2.index] = WHITE;
  check(findImmediateWins(board2, BLACK).length === 0, 'block: opponent no longer has a winning point');
  board2[result2.index] = EMPTY;
}

/* ------------------------------------------------------------------ */
/* 4. Open four / open three extension prevented                       */
/* ------------------------------------------------------------------ */
section('4. chooseMove prevents an opponent open four / open three extension');

{
  // White open three (row 7, x=5..7). If black ignores it, white plays x=4 or
  // x=8 and owns an open four (two winning cells) -> lost. Black must answer.
  const board = createBoard();
  for (let k = 0; k < 3; k += 1) put(board, 5 + k, 7, WHITE);
  put(board, 2, 2, BLACK);
  put(board, 3, 2, BLACK);
  const result = chooseMove(board, BLACK);
  check(isLegalResult(board, result, BLACK), 'open three: legal result shape');
  check(board[result.index] === EMPTY, 'open three: occupies an empty cell');
  board[result.index] = BLACK;
  check(!hasOpenFourThreat(board, WHITE), 'open three: does not allow white an open four');
  board[result.index] = EMPTY;

  // Broken three XX_X (white at 5,6,8 row 7): the gap at 7 would create an
  // open four, so it must be answered.
  const board2 = createBoard();
  put(board2, 5, 7, WHITE);
  put(board2, 6, 7, WHITE);
  put(board2, 8, 7, WHITE);
  put(board2, 2, 11, BLACK);
  put(board2, 3, 11, BLACK);
  const result2 = chooseMove(board2, BLACK);
  check(isLegalResult(board2, result2, BLACK), 'broken three: legal result shape');
  board2[result2.index] = BLACK;
  check(!hasOpenFourThreat(board2, WHITE), 'broken three: does not allow white an open four');
  board2[result2.index] = EMPTY;

  // Already-open four: black is lost but must still take one winning cell.
  const board3 = createBoard();
  for (let k = 0; k < 4; k += 1) put(board3, 5 + k, 9, WHITE);
  put(board3, 3, 3, BLACK);
  const result3 = chooseMove(board3, BLACK);
  check(isLegalResult(board3, result3, BLACK), 'open four defence: legal result shape');
  check(
    result3.index === idx(4, 9) || result3.index === idx(9, 9),
    'open four defence: blocks one of the two winning cells',
  );

  // Offence: from an open three the engine must create an open four (a forced
  // win: two winning points cannot both be blocked).
  const board4 = createBoard();
  for (let k = 0; k < 3; k += 1) put(board4, 5 + k, 7, BLACK);
  put(board4, 2, 2, WHITE);
  put(board4, 2, 3, WHITE);
  const result4 = chooseMove(board4, BLACK);
  check(isLegalResult(board4, result4, BLACK), 'open three attack: legal result shape');
  board4[result4.index] = BLACK;
  check(
    findImmediateWins(board4, BLACK).length >= 2,
    'open three attack: engine creates an open four (two winning points)',
  );
  board4[result4.index] = EMPTY;
}

/* ------------------------------------------------------------------ */
/* 5. Legal moves and no mutation on a range of positions              */
/* ------------------------------------------------------------------ */
section('5. legal results and board immutability across probes');

{
  const rng = makeRng(20240607);
  const positions = [];

  // A handful of structured positions plus random mid-game boards.
  const p1 = createBoard();
  put(p1, 7, 7, BLACK);
  positions.push(p1);
  const p2 = createBoard();
  put(p2, 7, 7, BLACK);
  put(p2, 8, 8, WHITE);
  positions.push(p2);

  for (let g = 0; g < 8; g += 1) {
    const board = createBoard();
    const stones = 4 + Math.floor(rng() * 12);
    for (let s = 0; s < stones; s += 1) {
      const x = 2 + Math.floor(rng() * 11);
      const y = 2 + Math.floor(rng() * 11);
      if (board[idx(x, y)] !== EMPTY) continue;
      const player = s % 2 === 0 ? BLACK : WHITE;
      board[idx(x, y)] = player;
      if (isFiveAt(board, idx(x, y), player)) board[idx(x, y)] = EMPTY;
    }
    positions.push(board);
  }

  for (let p = 0; p < positions.length; p += 1) {
    const board = positions[p];
    for (const player of [BLACK, WHITE]) {
      const before = cloneBoard(board);
      const result = chooseMove(board, player, { timeBudgetMs: 80, maxDepth: 4 });
      check(isLegalResult(board, result, player), `probe ${p} (${player}): legal result shape`);
      check(board[result.index] === EMPTY, `probe ${p} (${player}): chosen cell is empty`);
      check(boardsEqual(board, before), `probe ${p} (${player}): caller board unchanged`);
      check(evaluate(board, player) === -evaluate(board, 3 - player), `probe ${p}: evaluate is zero-sum`);
      check(Number.isFinite(evaluate(board, player)), `probe ${p}: evaluate is finite`);
    }
  }

  // Full board: no legal move, index -1.
  const full = createBoard();
  full.fill(BLACK);
  const fullResult = chooseMove(full, BLACK);
  check(fullResult.index === -1, 'full board: index -1');
  check(fullResult.reason === 'no-move', 'full board: reason no-move');
  check(isFull(full), 'isFull: full board detected');
  check(!isFull(createBoard()), 'isFull: empty board is not full');
}

/* ------------------------------------------------------------------ */
/* 6. Beats a greedy opponent                                          */
/* ------------------------------------------------------------------ */
section('6. engine vs greedy opponent (wins / blocks / best local point)');

{
  // Greedy local heuristic (shape through the candidate cell), independent of
  // the engine internals so this is a real opponent.
  const shapeScores = [
    [0, 0, 0],
    [0, 2, 12],
    [0, 60, 600],
    [0, 900, 20000],
    [0, 50000, 1000000],
  ];

  function shapeValue(board, index, player) {
    const x0 = index % N;
    const y0 = (index - x0) / N;
    let sum = 0;
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    for (const [dx, dy] of dirs) {
      let forward = 0;
      let x = x0 + dx;
      let y = y0 + dy;
      while (x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === player) {
        forward += 1;
        x += dx;
        y += dy;
      }
      const forwardOpen = x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === EMPTY;
      let backward = 0;
      x = x0 - dx;
      y = y0 - dy;
      while (x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === player) {
        backward += 1;
        x -= dx;
        y -= dy;
      }
      const backwardOpen = x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === EMPTY;
      const total = forward + backward + 1;
      const ends = (forwardOpen ? 1 : 0) + (backwardOpen ? 1 : 0);
      if (total >= 5) sum += 100000000;
      else sum += shapeScores[total][ends];
    }
    return sum;
  }

  function candidateCells(board) {
    const cells = [];
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const i = idx(x, y);
        if (board[i] !== EMPTY) continue;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
            if (board[ny * N + nx] !== EMPTY) {
              near = true;
              break;
            }
          }
        }
        if (near) cells.push(i);
      }
    }
    return cells;
  }

  function greedyMove(board, me, rng) {
    // Greedy per spec: take an immediate win, block an immediate loss, and
    // otherwise play the best local attack heuristic point (no deep defence).
    const wins = findImmediateWins(board, me);
    if (wins.length > 0) return wins[Math.floor(rng() * wins.length)];
    const blocks = findImmediateWins(board, 3 - me);
    if (blocks.length > 0) return blocks[Math.floor(rng() * blocks.length)];
    const candidates = candidateCells(board);
    if (candidates.length === 0) {
      // Empty board: play the centre.
      return idx(7, 7);
    }
    let bestScore = -Infinity;
    let best = [];
    for (const cell of candidates) {
      const score = shapeValue(board, cell, me) + rng() * 1e-6;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [cell];
      } else if (Math.abs(score - bestScore) <= 1e-9) {
        best.push(cell);
      }
    }
    return best[Math.floor(rng() * best.length)];
  }

  const games = 20;
  let engineWins = 0;
  let greedyWins = 0;
  let draws = 0;
  let moveTotal = 0;
  const gameMs = [];

  for (let g = 0; g < games; g += 1) {
    const rng = makeRng(9001 + g * 7919);
    const board = createBoard();
    const engineColor = g % 2 === 0 ? BLACK : WHITE;
    let player = BLACK;
    let winner = 0;
    let moves = 0;
    const started = Date.now();
    while (moves < N * N) {
      let move;
      if (player === engineColor) {
        const result = chooseMove(board, engineColor);
        if (!isLegalResult(board, result, engineColor)) {
          check(false, `greedy game ${g}: engine returned an illegal move`);
          break;
        }
        move = result.index;
      } else {
        move = greedyMove(board, player, rng);
      }
      board[move] = player;
      moves += 1;
      if (isFiveAt(board, move, player)) {
        winner = player;
        break;
      }
      if (isFull(board)) break;
      player = 3 - player;
    }
    gameMs.push(Date.now() - started);
    moveTotal += moves;
    if (winner === engineColor) engineWins += 1;
    else if (winner === 0) draws += 1;
    else greedyWins += 1;
  }

  console.log(
    `  greedy match: engine ${engineWins}W ${greedyWins}L ${draws}D over ${games} games ` +
      `(avg ${(moveTotal / games).toFixed(1)} moves/game, ${(gameMs.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s total)`,
  );
  check(engineWins >= 18, `greedy match: engine wins ${engineWins} of ${games} (need >= 18)`);
}

/* ------------------------------------------------------------------ */
/* 7. Self-play completes, every move within the hard ceiling          */
/* ------------------------------------------------------------------ */
section('7. self-play game completes within the 900 ms per-move ceiling');

{
  const board = createBoard();
  const times = [];
  let player = BLACK;
  let moves = 0;
  let winner = 0;
  while (moves < N * N) {
    const started = Date.now();
    const result = chooseMove(board, player);
    const wallMs = Date.now() - started;
    if (!isLegalResult(board, result, player)) {
      check(false, `self-play: illegal move at ply ${moves}`);
      break;
    }
    if (result.timeMs > 900 || wallMs > 900) {
      check(false, `self-play: move ${moves} took ${Math.max(result.timeMs, wallMs).toFixed(1)}ms (> 900ms)`);
    }
    times.push(wallMs);
    board[result.index] = player;
    moves += 1;
    if (isFiveAt(board, result.index, player)) {
      winner = player;
      break;
    }
    if (isFull(board)) break;
    player = 3 - player;
  }

  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const max = Math.max(...times);
  console.log(
    `  self-play: ${moves} moves, winner ${winner === 0 ? 'draw' : winner === BLACK ? 'black' : 'white'}, ` +
      `avg ${avg.toFixed(1)}ms, max ${max.toFixed(1)}ms`,
  );
  check(winner !== 0 || isFull(board), 'self-play: game reached a terminal position');
  check(moves >= 9, 'self-play: game lasted at least 9 moves');
  check(times.length > 0 && max <= 900, `self-play: max move time ${max.toFixed(1)}ms <= 900ms`);
}

/* ------------------------------------------------------------------ */
/* 8. Performance probe on random mid-game positions                   */
/* ------------------------------------------------------------------ */
section('8. performance probe: 30 random mid-game positions');

{
  const rng = makeRng(424242);
  const times = [];
  let illegal = 0;
  let overCeiling = 0;

  for (let p = 0; p < 30; p += 1) {
    const board = createBoard();
    const stones = 8 + Math.floor(rng() * 9); // 8..16 stones, genuinely mid-game
    let placed = 0;
    let guard = 0;
    while (placed < stones && guard < 500) {
      guard += 1;
      const x = 2 + Math.floor(rng() * 11);
      const y = 2 + Math.floor(rng() * 11);
      const cell = idx(x, y);
      if (board[cell] !== EMPTY) continue;
      const player = placed % 2 === 0 ? BLACK : WHITE;
      // Avoid finishing the game in the probe setup.
      board[cell] = player;
      if (isFiveAt(board, cell, player)) {
        board[cell] = EMPTY;
        continue;
      }
      placed += 1;
    }
    const before = cloneBoard(board);
    const result = chooseMove(board, BLACK);
    const wallMs = Math.max(result.timeMs, 0);
    times.push(wallMs);
    if (!isLegalResult(board, result, BLACK)) illegal += 1;
    if (result.index < 0 || before[result.index] !== EMPTY) illegal += 1;
    if (!boardsEqual(board, before)) illegal += 1;
    if (wallMs > 900) overCeiling += 1;
  }

  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const max = sorted[sorted.length - 1];
  console.log(
    `  perf: n=${times.length}, avg ${avg.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, max ${max.toFixed(1)}ms`,
  );
  check(illegal === 0, `perf: all probes returned legal moves without mutating the board (illegal=${illegal})`);
  check(overCeiling === 0, `perf: no probe exceeded 900ms (over=${overCeiling})`);
  check(avg <= 600, `perf: average ${avg.toFixed(1)}ms is within the 450ms budget plus overhead`);
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */
console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(` - ${failure}`);
  process.exitCode = 1;
}
