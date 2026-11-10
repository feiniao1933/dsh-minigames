/**
 * Pure Gomoku (five-in-a-row) game engine for the DSH "游戏盒子" plugin.
 *
 * This file is deliberately self-contained ESM with NO imports, NO DOM access,
 * NO Node APIs and NO asynchronous code:
 *   - Node tests import it directly (`node test/engine.test.mjs`).
 *   - `build.mjs` strips leading `export ` keywords and concatenates the file
 *     into the browser client bundle, inside the same function scope as
 *     `src/ui.js`. All internal (non-exported) identifiers therefore use the
 *     `mg` prefix so they cannot collide with `ui.js` (or its `React`).
 *
 * Strength model ("困难"): tactical pre-checks (win / block), then iterative
 * deepening alpha-beta negamax with:
 *   - forced-move detection inside the tree (an opponent four is a forced
 *     block that extends the search beyond the nominal depth),
 *   - static evaluation based on run lengths and open ends for both sides
 *     (zero-sum, plus double-threat bonuses),
 *   - move ordering by local attack + defence shape scores,
 *   - candidate generation close to existing stones and a strict time budget.
 */

export const BOARD_SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

/* ------------------------------------------------------------------ */
/* Internal constants (namespaced with `mg` to protect the bundle scope) */
/* ------------------------------------------------------------------ */

const mgN = BOARD_SIZE;
const mgCellCount = mgN * mgN;
const mgWinScore = 100000000;
const mgDefaultTimeBudgetMs = 450;
const mgDefaultMaxDepth = 6;
const mgMaxPly = 32;

/** The four line directions: horizontal, vertical, diagonal, anti-diagonal. */
const mgDX = [1, 0, 1, 1];
const mgDY = [0, 1, 1, -1];

/** Chebyshev-radius-2 neighbourhood offsets used for candidate generation. */
const mgNeighborOffsets = (function () {
  const offsets = [];
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx !== 0 || dy !== 0) offsets.push(dx, dy);
    }
  }
  return offsets;
})();

/** All lines of length >= 5 as flat arrays of board indices (72 lines). */
const mgLines = (function () {
  const lines = [];
  const pushLine = (line) => {
    if (line.length >= 5) lines.push(line);
  };
  for (let y = 0; y < mgN; y += 1) {
    const line = [];
    for (let x = 0; x < mgN; x += 1) line.push(y * mgN + x);
    pushLine(line);
  }
  for (let x = 0; x < mgN; x += 1) {
    const line = [];
    for (let y = 0; y < mgN; y += 1) line.push(y * mgN + x);
    pushLine(line);
  }
  for (let y = 0; y < mgN; y += 1) {
    for (let x = 0; x < mgN; x += 1) {
      if (x === 0 || y === 0) {
        const line = [];
        let cx = x;
        let cy = y;
        while (cx < mgN && cy < mgN) {
          line.push(cy * mgN + cx);
          cx += 1;
          cy += 1;
        }
        pushLine(line);
      }
      if (x === 0 || y === mgN - 1) {
        const line = [];
        let cx = x;
        let cy = y;
        while (cx < mgN && cy >= 0) {
          line.push(cy * mgN + cx);
          cx += 1;
          cy -= 1;
        }
        pushLine(line);
      }
    }
  }
  return lines;
})();

/**
 * Static run values indexed by [run length][open ends].
 * A "run" is a maximal horizontal/vertical/diagonal sequence of one colour.
 * An open end is an EMPTY cell directly beyond the run.
 */
const mgRunScores = [
  [0, 0, 0],
  [0, 1, 4],
  [0, 20, 150],
  [0, 600, 12000],
  [0, 10000, 1000000],
];

/** Move-ordering shape values for "if this colour places at the cell". */
const mgShapeScores = [
  [0, 0, 0],
  [0, 2, 12],
  [0, 60, 600],
  [0, 900, 20000],
  [0, 50000, 1000000],
];

/* Scratch buffers reused by the synchronous search (never shared across a
 * chooseMove call, because chooseMove is synchronous and non-reentrant). */
const mgCandStamps = new Int32Array(mgCellCount);
const mgCandBuffers = [];
const mgOrderScoreBuffers = [];
let mgCandCookie = 0;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function mgNowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function mgInBounds(x, y) {
  return x >= 0 && x < mgN && y >= 0 && y < mgN;
}

/**
 * Would placing `player` at `index` (assumed EMPTY) complete five or more?
 * Checks the four directions through `index`.
 */
function mgWouldWin(board, index, player) {
  const x0 = index % mgN;
  const y0 = (index - x0) / mgN;
  for (let d = 0; d < 4; d += 1) {
    const dx = mgDX[d];
    const dy = mgDY[d];
    let count = 1;
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      count += 1;
      x += dx;
      y += dy;
    }
    x = x0 - dx;
    y = y0 - dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      count += 1;
      x -= dx;
      y -= dy;
    }
    if (count >= 5) return true;
  }
  return false;
}

/** Consecutive run length of `player` through an occupied `index`. */
function mgRunLengthThrough(board, index, player) {
  const x0 = index % mgN;
  const y0 = (index - x0) / mgN;
  let best = 0;
  for (let d = 0; d < 4; d += 1) {
    const dx = mgDX[d];
    const dy = mgDY[d];
    let count = 1;
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      count += 1;
      x += dx;
      y += dy;
    }
    x = x0 - dx;
    y = y0 - dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      count += 1;
      x -= dx;
      y -= dy;
    }
    if (count > best) best = count;
  }
  return best;
}

/**
 * Shape score of the colour `player` if it placed a stone at `index`.
 * Counts contiguous stones on both sides plus whether each side stays open.
 */
function mgShapeValueFor(board, index, player) {
  const x0 = index % mgN;
  const y0 = (index - x0) / mgN;
  let sum = 0;
  for (let d = 0; d < 4; d += 1) {
    const dx = mgDX[d];
    const dy = mgDY[d];
    let forward = 0;
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      forward += 1;
      x += dx;
      y += dy;
    }
    const forwardOpen = x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === EMPTY;
    let backward = 0;
    x = x0 - dx;
    y = y0 - dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      backward += 1;
      x -= dx;
      y -= dy;
    }
    const backwardOpen = x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === EMPTY;
    const total = forward + backward + 1;
    const ends = (forwardOpen ? 1 : 0) + (backwardOpen ? 1 : 0);
    if (total >= 5) sum += 100000000;
    else sum += mgShapeScores[total][ends];
  }
  return sum;
}

/** Ordering score: local attacking value plus a slightly heavier defence value. */
function mgMoveOrderScore(board, index, player) {
  const opp = player === BLACK ? WHITE : BLACK;
  return mgShapeValueFor(board, index, player) + mgShapeValueFor(board, index, opp) * 1.05;
}

/* ------------------------------------------------------------------ */
/* Candidate generation / ordering                                     */
/* ------------------------------------------------------------------ */

/** Empty cells within Chebyshev distance 2 of any stone (deduped). */
function mgGenerateCandidates(board, ply) {
  let buffer = mgCandBuffers[ply];
  if (!buffer) {
    buffer = mgCandBuffers[ply] = [];
  }
  buffer.length = 0;
  mgCandCookie = (mgCandCookie + 1) & 0x7fffffff;
  if (mgCandCookie === 0) {
    mgCandStamps.fill(0);
    mgCandCookie = 1;
  }
  const cookie = mgCandCookie;
  for (let y = 0; y < mgN; y += 1) {
    for (let x = 0; x < mgN; x += 1) {
      if (board[y * mgN + x] === EMPTY) continue;
      for (let k = 0; k < mgNeighborOffsets.length; k += 2) {
        const nx = x + mgNeighborOffsets[k];
        const ny = y + mgNeighborOffsets[k + 1];
        if (nx < 0 || nx >= mgN || ny < 0 || ny >= mgN) continue;
        const ni = ny * mgN + nx;
        if (board[ni] !== EMPTY) continue;
        if (mgCandStamps[ni] === cookie) continue;
        mgCandStamps[ni] = cookie;
        buffer.push(ni);
      }
    }
  }
  return buffer;
}

function mgOrderScoreBuffer(ply) {
  let buffer = mgOrderScoreBuffers[ply];
  if (!buffer) {
    buffer = mgOrderScoreBuffers[ply] = new Float64Array(mgCellCount);
  }
  return buffer;
}

/**
 * Partially order `candidates` by descending ordering score, keeping only the
 * best `limit` moves in the first slots; returns the number of usable moves.
 */
function mgOrderMoves(board, candidates, scores, player, limit) {
  const count = candidates.length;
  for (let i = 0; i < count; i += 1) {
    scores[i] = mgMoveOrderScore(board, candidates[i], player);
  }
  const keep = Math.min(limit, count);
  for (let i = 0; i < keep; i += 1) {
    let best = i;
    for (let j = i + 1; j < count; j += 1) {
      if (scores[j] > scores[best]) best = j;
    }
    if (best !== i) {
      const move = candidates[i];
      candidates[i] = candidates[best];
      candidates[best] = move;
      const score = scores[i];
      scores[i] = scores[best];
      scores[best] = score;
    }
  }
  return keep;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Negamax node. Terminal tactical situations are handled before the nominal
 * depth check so that forced blocks and immediate wins are always seen:
 *   - the side to move wins immediately  -> +WIN,
 *   - the opponent has two winning cells -> lost,
 *   - the opponent has one winning cell  -> forced block (search extends).
 */
function mgNegamax(state, player, depth, alpha, beta, ply) {
  state.nodes += 1;
  if ((state.nodes & 31) === 0 && mgNowMs() >= state.deadline) {
    state.timedOut = true;
    return 0;
  }
  if (ply >= mgMaxPly) return evaluate(state.board, player);
  const board = state.board;
  const opp = player === BLACK ? WHITE : BLACK;
  const candidates = mgGenerateCandidates(board, ply);
  const count = candidates.length;
  if (count === 0) return evaluate(board, player);

  let myWin = -1;
  let oppWinCount = 0;
  let oppWinFirst = -1;
  for (let i = 0; i < count; i += 1) {
    const cell = candidates[i];
    if (mgWouldWin(board, cell, player)) {
      myWin = cell;
      break;
    }
    if (mgWouldWin(board, cell, opp)) {
      oppWinCount += 1;
      if (oppWinCount === 1) oppWinFirst = cell;
    }
  }
  if (myWin >= 0) return mgWinScore - ply;
  if (oppWinCount >= 2) return -(mgWinScore - ply - 1);

  if (oppWinCount === 1) {
    // Only the block can avoid an immediate loss.
    const move = oppWinFirst;
    board[move] = player;
    let score;
    if (mgWouldWin(board, move, player)) score = mgWinScore - ply;
    else score = -mgNegamax(state, opp, depth - 1, -beta, -alpha, ply + 1);
    board[move] = EMPTY;
    return score;
  }

  if (depth <= 0) return evaluate(board, player);

  const width = depth >= 4 ? 10 : depth >= 2 ? 12 : 14;
  const moveCount = mgOrderMoves(board, candidates, mgOrderScoreBuffer(ply), player, width);
  let best = -mgWinScore * 2;
  let alphaLocal = alpha;
  for (let i = 0; i < moveCount; i += 1) {
    const move = candidates[i];
    board[move] = player;
    let score;
    if (mgWouldWin(board, move, player)) score = mgWinScore - ply;
    else score = -mgNegamax(state, opp, depth - 1, -beta, -alphaLocal, ply + 1);
    board[move] = EMPTY;
    if (state.timedOut) return 0;
    if (score > best) best = score;
    if (score > alphaLocal) alphaLocal = score;
    if (alphaLocal >= beta) break;
  }
  return best;
}

/** Root alpha-beta search for one iterative-deepening iteration. */
function mgSearchRoot(state, depth, previousBest) {
  const board = state.board;
  const player = state.ai;
  const opp = player === BLACK ? WHITE : BLACK;
  const candidates = mgGenerateCandidates(board, 0);
  const count = candidates.length;
  if (count === 0) return { index: -1, score: 0 };

  let myWin = -1;
  let oppWinCount = 0;
  let oppWinFirst = -1;
  for (let i = 0; i < count; i += 1) {
    const cell = candidates[i];
    if (mgWouldWin(board, cell, player)) {
      myWin = cell;
      break;
    }
    if (mgWouldWin(board, cell, opp)) {
      oppWinCount += 1;
      if (oppWinCount === 1) oppWinFirst = cell;
    }
  }
  if (myWin >= 0) return { index: myWin, score: mgWinScore };

  let forced = -1;
  if (oppWinCount >= 1) forced = oppWinFirst;
  let moveCount;
  if (forced >= 0) {
    candidates.length = 0;
    candidates.push(forced);
    moveCount = 1;
  } else {
    moveCount = mgOrderMoves(board, candidates, mgOrderScoreBuffer(0), player, 18);
    if (previousBest >= 0) {
      for (let i = 1; i < moveCount; i += 1) {
        if (candidates[i] === previousBest) {
          const first = candidates[0];
          candidates[0] = candidates[i];
          candidates[i] = first;
          break;
        }
      }
    }
  }

  let best = -1;
  let bestScore = -mgWinScore * 2;
  let alpha = -mgWinScore * 2;
  const beta = mgWinScore * 2;
  for (let i = 0; i < moveCount; i += 1) {
    const move = candidates[i];
    board[move] = player;
    let score;
    if (mgWouldWin(board, move, player)) score = mgWinScore;
    else score = -mgNegamax(state, opp, depth - 1, -beta, -alpha, 1);
    board[move] = EMPTY;
    if (state.timedOut) return null;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
    if (score > alpha) alpha = score;
  }
  return { index: best, score: bestScore };
}

/* ------------------------------------------------------------------ */
/* VCF (victory by continuous fours) forcing search                    */
/* ------------------------------------------------------------------ */

/* Dedicated candidate-buffer slots so VCF recursion cannot clobber search
 * buffers (search uses plies 0..mgMaxPly). */
const mgVcfBufferBase = 64;
const mgVcfWinBuf = [0, 0];
const mgVcfOppBuf = [0, 0];

/**
 * Empty cells where `player` would win immediately, restricted to cells whose
 * completing five must contain the stone just placed at `move`. That makes the
 * scan local (at most 4 cells in each direction), which keeps the VCF search
 * cheap. `out` receives up to two winning cells; returns their count.
 */
function mgWinningPointsAfter(board, move, player, out) {
  const x0 = move % mgN;
  const y0 = (move - x0) / mgN;
  let count = 0;
  for (let d = 0; d < 4; d += 1) {
    const dx = mgDX[d];
    const dy = mgDY[d];
    for (let sign = -1; sign <= 1; sign += 2) {
      for (let k = 1; k <= 4; k += 1) {
        const x = x0 + sign * k * dx;
        const y = y0 + sign * k * dy;
        if (x < 0 || x >= mgN || y < 0 || y >= mgN) break;
        const cell = y * mgN + x;
        if (board[cell] !== EMPTY) continue;
        if (mgWouldWin(board, cell, player)) {
          out[count] = cell;
          count += 1;
          if (count >= 2) return count;
        }
      }
    }
  }
  return count;
}

/**
 * Victory-by-continuous-fours search: try every move that creates a four,
 * assume the opponent blocks its single winning point, and recurse. A move
 * creating two winning points (open four / double four) is an immediate forced
 * win. Returns a winning root move, or -1.
 *
 * Preconditions (maintained by the caller): the side to move has no immediate
 * five, and the opponent has no immediate five either.
 */
function mgVcf(state, me, depth, ply) {
  if (depth <= 0) return -1;
  state.nodes += 1;
  state.vcfNodes += 1;
  if ((state.nodes & 15) === 0 && mgNowMs() >= state.vcfDeadline) {
    state.vcfTimedOut = true;
    return -1;
  }
  if (state.vcfNodes > 2500) {
    state.vcfTimedOut = true;
    return -1;
  }
  const board = state.board;
  const opp = me === BLACK ? WHITE : BLACK;
  const candidates = mgGenerateCandidates(board, mgVcfBufferBase + ply);
  const count = candidates.length;
  const attacks = [];
  const attackPoints = [];

  for (let i = 0; i < count; i += 1) {
    const move = candidates[i];
    board[move] = me;
    if (mgWouldWin(board, move, me)) {
      board[move] = EMPTY;
      return move;
    }
    const winningPoints = mgWinningPointsAfter(board, move, me, mgVcfWinBuf);
    board[move] = EMPTY;
    if (winningPoints >= 2) return move;
    if (winningPoints === 1) {
      attacks.push(move);
      attackPoints.push(mgVcfWinBuf[0]);
    }
  }
  if (attacks.length === 0) return -1;

  // Search the most promising four threats first.
  const order = [];
  for (let i = 0; i < attacks.length; i += 1) order.push(i);
  for (let i = 0; i < order.length; i += 1) {
    order[i] = { index: order[i], score: mgMoveOrderScore(board, attacks[order[i]], me) };
  }
  order.sort((a, b) => b.score - a.score || a.index - b.index);
  const branchLimit = Math.min(attacks.length, depth >= 6 ? 10 : 14);

  for (let i = 0; i < branchLimit; i += 1) {
    const attack = attacks[order[i].index];
    const block = attackPoints[order[i].index];
    board[attack] = me;
    board[block] = opp;
    let opponentThreat = 0;
    // The forced block may itself complete five for the opponent, or give the
    // opponent a four threat; either way this four chain cannot continue.
    if (isFiveAt(board, block, opp)) {
      opponentThreat = 1;
    } else {
      opponentThreat = mgWinningPointsAfter(board, block, opp, mgVcfOppBuf);
    }
    let result = -1;
    if (opponentThreat === 0) result = mgVcf(state, me, depth - 1, ply + 1);
    board[block] = EMPTY;
    board[attack] = EMPTY;
    if (state.vcfTimedOut) return -1;
    if (result >= 0) return attack;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Create an empty 15x15 board (index = y * 15 + x). */
export function createBoard() {
  return new Int8Array(mgCellCount);
}

/** True when the stone at `index` belongs to a run of >= 5 of `player`. */
export function isFiveAt(board, index, player) {
  if (!Number.isInteger(index) || index < 0 || index >= mgCellCount) return false;
  if (board[index] !== player) return false;
  return mgRunLengthThrough(board, index, player) >= 5;
}

/**
 * Indices of the winning run (>= 5 stones of `player`) through `index`, or
 * null when `index` is not part of a five. The run is returned left-to-right
 * in whichever of the four directions produced the win.
 */
export function findWinLine(board, index, player) {
  if (!Number.isInteger(index) || index < 0 || index >= mgCellCount) return null;
  if (board[index] !== player) return null;
  const x0 = index % mgN;
  const y0 = (index - x0) / mgN;
  for (let d = 0; d < 4; d += 1) {
    const dx = mgDX[d];
    const dy = mgDY[d];
    let backward = 0;
    let x = x0 - dx;
    let y = y0 - dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      backward += 1;
      x -= dx;
      y -= dy;
    }
    let forward = 0;
    x = x0 + dx;
    y = y0 + dy;
    while (x >= 0 && x < mgN && y >= 0 && y < mgN && board[y * mgN + x] === player) {
      forward += 1;
      x += dx;
      y += dy;
    }
    const length = backward + 1 + forward;
    if (length >= 5) {
      const line = [];
      const startX = x0 - backward * dx;
      const startY = y0 - backward * dy;
      for (let k = 0; k < length; k += 1) {
        line.push((startY + k * dy) * mgN + (startX + k * dx));
      }
      return line;
    }
  }
  return null;
}

/** True when every cell of the board is occupied. */
export function isFull(board) {
  for (let i = 0; i < mgCellCount; i += 1) {
    if (board[i] === EMPTY) return false;
  }
  return true;
}

/**
 * Empty cells where `player` would complete five immediately.
 * A winning cell is necessarily adjacent to one of the player's stones, but we
 * scan all empties for clarity (the function is called a handful of times per
 * move, never inside the hot search loop).
 */
export function findImmediateWins(board, player) {
  const wins = [];
  for (let index = 0; index < mgCellCount; index += 1) {
    if (board[index] !== EMPTY) continue;
    if (mgWouldWin(board, index, player)) wins.push(index);
  }
  return wins;
}

/**
 * Static heuristic evaluation from `player`'s point of view.
 *
 * Positive is good for `player`; the function is zero-sum, i.e.
 * evaluate(board, p) === -evaluate(board, 3 - p). Run lengths are scored by
 * open ends (an open four is effectively a forced win) and a side with
 * multiple open threats (double four, four + three, double three) gets an
 * extra bonus. Board-wide line scan, O(225).
 */
export function evaluate(board, player) {
  const opp = 3 - player;
  let myScore = 0;
  let theirScore = 0;
  let myFours = 0;
  let myThrees = 0;
  let theirFours = 0;
  let theirThrees = 0;
  for (let li = 0; li < mgLines.length; li += 1) {
    const line = mgLines[li];
    const lineLength = line.length;
    let i = 0;
    while (i < lineLength) {
      const value = board[line[i]];
      if (value === EMPTY) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < lineLength && board[line[j]] === value) j += 1;
      const runLength = j - i;
      const ends =
        (i > 0 && board[line[i - 1]] === EMPTY ? 1 : 0) +
        (j < lineLength && board[line[j]] === EMPTY ? 1 : 0);
      const runScore = runLength >= 5 ? 10000000 : mgRunScores[runLength][ends];
      if (value === player) {
        myScore += runScore;
        if (runLength === 4 && ends === 2) myFours += 1;
        else if (runLength === 3 && ends === 2) myThrees += 1;
      } else if (value === opp) {
        theirScore += runScore;
        if (runLength === 4 && ends === 2) theirFours += 1;
        else if (runLength === 3 && ends === 2) theirThrees += 1;
      }
      i = j;
    }
  }
  if (myFours >= 2) myScore += 4000000;
  else if (myFours >= 1 && myThrees >= 1) myScore += 1500000;
  else if (myThrees >= 2) myScore += 250000;
  if (theirFours >= 2) theirScore += 4000000;
  else if (theirFours >= 1 && theirThrees >= 1) theirScore += 1500000;
  else if (theirThrees >= 2) theirScore += 250000;
  return myScore - theirScore;
}

/**
 * Choose the AI move. Synchronous and budgeted; the caller's board is never
 * mutated (the search runs on an internal copy).
 *
 * options: { timeBudgetMs?: number (default 450), maxDepth?: number (default 6) }
 * Returns: { index, score, depth, nodes, timeMs, reason }.
 * `index` is -1 only when no legal move exists.
 */
export function chooseMove(board, aiPlayer, options) {
  const opts = options || {};
  const timeBudgetMs =
    typeof opts.timeBudgetMs === 'number' && opts.timeBudgetMs > 0
      ? opts.timeBudgetMs
      : mgDefaultTimeBudgetMs;
  const configuredDepth =
    typeof opts.maxDepth === 'number' && opts.maxDepth > 0 ? Math.floor(opts.maxDepth) : mgDefaultMaxDepth;
  const maxDepth = Math.min(configuredDepth, mgMaxPly - 2);
  const start = mgNowMs();
  const working = new Int8Array(board);
  const opp = aiPlayer === BLACK ? WHITE : BLACK;

  let stoneCount = 0;
  for (let i = 0; i < mgCellCount; i += 1) {
    if (working[i] !== EMPTY) stoneCount += 1;
  }
  if (stoneCount === 0) {
    return { index: (mgCellCount - 1) >> 1, score: 0, depth: 0, nodes: 0, timeMs: mgNowMs() - start, reason: 'opening' };
  }
  if (stoneCount >= mgCellCount) {
    return { index: -1, score: 0, depth: 0, nodes: 0, timeMs: mgNowMs() - start, reason: 'no-move' };
  }

  // Tactical pre-checks outside the tree: win now, or a forced block.
  const wins = findImmediateWins(working, aiPlayer);
  if (wins.length > 0) {
    return { index: wins[0], score: mgWinScore, depth: 1, nodes: 0, timeMs: mgNowMs() - start, reason: 'immediate-win' };
  }
  const opponentWins = findImmediateWins(working, opp);
  if (opponentWins.length === 1) {
    return { index: opponentWins[0], score: 0, depth: 1, nodes: 0, timeMs: mgNowMs() - start, reason: 'block-immediate' };
  }
  if (opponentWins.length >= 2) {
    return { index: opponentWins[0], score: -mgWinScore, depth: 1, nodes: 0, timeMs: mgNowMs() - start, reason: 'forced-block' };
  }

  const state = {
    board: working,
    ai: aiPlayer,
    deadline: start + timeBudgetMs,
    vcfDeadline: start + Math.max(20, timeBudgetMs * 0.35),
    vcfTimedOut: false,
    vcfNodes: 0,
    nodes: 0,
    timedOut: false,
  };

  // Forcing-search tactics before the full search: a VCF chain either proves a
  // forced win quickly (four threats force the opponent's replies) or gives up
  // after a small time slice.
  const vcfMove = mgVcf(state, aiPlayer, 10, 0);
  if (vcfMove >= 0) {
    return {
      index: vcfMove,
      score: mgWinScore,
      depth: 1,
      nodes: state.nodes,
      timeMs: mgNowMs() - start,
      reason: 'vcf',
    };
  }

  let bestIndex = -1;
  let bestScore = 0;
  let completedDepth = 0;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const result = mgSearchRoot(state, depth, bestIndex);
    if (state.timedOut || !result) break;
    if (result.index < 0) break;
    bestIndex = result.index;
    bestScore = result.score;
    completedDepth = depth;
    if (result.score >= mgWinScore - 2 * mgMaxPly) break;
    if (result.score <= -mgWinScore + 2 * mgMaxPly) break;
    if (mgNowMs() >= state.deadline) break;
  }

  if (bestIndex < 0) {
    // Budget exhausted before the first iteration finished: fall back to the
    // best locally ordered point (still deterministic).
    const candidates = mgGenerateCandidates(working, 0);
    if (candidates.length > 0) {
      mgOrderMoves(working, candidates, mgOrderScoreBuffer(0), aiPlayer, 1);
      bestIndex = candidates[0];
      bestScore = evaluate(working, aiPlayer);
    } else {
      for (let i = 0; i < mgCellCount; i += 1) {
        if (working[i] === EMPTY) {
          bestIndex = i;
          break;
        }
      }
    }
  }

  return {
    index: bestIndex,
    score: bestScore,
    depth: completedDepth,
    nodes: state.nodes,
    timeMs: mgNowMs() - start,
    reason: 'search',
  };
}
