/* Client half of the mini-games bundle.
 *
 * Contributes one right-sidebar tab type ("游戏盒子" / mini games box) through
 * the public two-stage path (`ctx.sidebarRightTabs.register` + a keyed
 * `sidebar.right.pane.tab` body), a Start-page entry capsule through the type's
 * `guide` list, the tab chip title, and a frame-wide victory celebration in the
 * `shell.overlay` seat.
 *
 * The game itself is a 15x15 Gomoku (五子棋) board against the hard AI in
 * `src/engine.js`. All copy goes through the Client locale service; all colours
 * that are not artwork come from `--dsw-alias-*` theme tokens.
 */

import { BOARD_SIZE, EMPTY, BLACK, WHITE, createBoard, isFiveAt, findWinLine, isFull, chooseMove } from './engine.js';

const NS = 'minigames';
const PLUGIN_ID = 'dsh-minigames';
const KIND = 'minigames';
const RECORD_KEY = 'dsh.minigames.record.v1';
const HUMAN = BLACK;
const AI = WHITE;
/** A short think delay so the "AI is thinking" state is readable. */
const AI_MIN_DELAY_MS = 260;
/** How long the victory layer stays up before dismissing itself. */
const CELEBRATION_MS = 7600;

/**
 * Selectable AI strengths. Difficulty is a search budget/depth ladder rather
 * than a different engine: even `easy` still takes its own wins and blocks the
 * opponent's immediate win, it just cannot plan a double threat.
 */
const DIFFICULTIES = {
  easy: { id: 'easy', maxDepth: 2, timeBudgetMs: 160 },
  normal: { id: 'normal', maxDepth: 4, timeBudgetMs: 320 },
  hard: { id: 'hard', maxDepth: 6, timeBudgetMs: 430 },
};
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
const DEFAULT_DIFFICULTY = 'hard';
const DIFFICULTY_KEY = 'dsh.minigames.difficulty.v1';
const SOUND_KEY = 'dsh.minigames.sound.v1';

const DICT = {
  en: {
    'type.label': 'Mini games box',
    'guide.title': 'Mini games box',
    'guide.description': 'Play Gomoku against a hard AI',
    'header.title': 'Mini games box',
    'header.subtitle': 'A quick break, right where you work',
    'launcher.title': 'Open the mini games box',
    'difficulty.label': 'Difficulty',
    'difficulty.easy': 'Easy',
    'difficulty.normal': 'Normal',
    'difficulty.hard': 'Hard',
    'game.gomoku': 'Gomoku',
    'game.gomoku.desc': 'Human vs AI · {difficulty}',
    'game.more': 'More games',
    'game.more.desc': 'Coming soon',
    'status.yourTurn': 'Your move',
    'status.aiThinking': 'AI is thinking…',
    'status.youWin': 'You win!',
    'status.aiWin': 'AI wins',
    'status.draw': 'A draw',
    'hint.rules': 'Five in a row wins. You play black and move first.',
    'move.count': '{n} moves',
    'action.restart': 'New game',
    'action.undo': 'Undo',
    'action.dismiss': 'Keep looking',
    'sound.mute': 'Mute sound',
    'sound.unmute': 'Unmute sound',
    'action.again': 'Play again',
    'record.title': 'Your record',
    'record.win': 'W',
    'record.lose': 'L',
    'record.draw': 'D',
    'result.youWin': 'You win!',
    'result.aiWin': 'AI wins',
    'result.draw': 'A draw',
    'result.meta': '{n} moves · {time}',
    'win.kicker': 'Victory',
    'win.title': 'You win!',
    'win.subtitle': 'Gomoku · {difficulty} AI',
    'win.stats': '{n} moves in {time}',
    'a11y.board': 'Gomoku board, 15 by 15. Use the arrow keys to move and Enter to place.',
    'a11y.cell': 'Row {row}, column {col}',
  },
  zh: {
    'type.label': '游戏盒子',
    'guide.title': '游戏盒子',
    'guide.description': '人机对弈五子棋，挑战困难 AI',
    'header.title': '游戏盒子',
    'header.subtitle': '在右侧面板随时来一局',
    'launcher.title': '打开游戏盒子',
    'difficulty.label': '难度',
    'difficulty.easy': '简单',
    'difficulty.normal': '普通',
    'difficulty.hard': '困难',
    'game.gomoku': '五子棋',
    'game.gomoku.desc': '人机对弈 · {difficulty}',
    'game.more': '更多游戏',
    'game.more.desc': '敬请期待',
    'status.yourTurn': '轮到你落子',
    'status.aiThinking': 'AI 正在思考…',
    'status.youWin': '你赢了！',
    'status.aiWin': 'AI 获胜',
    'status.draw': '平局',
    'hint.rules': '先连成五子者获胜，你执黑先行。',
    'move.count': '第 {n} 手',
    'action.restart': '重新开始',
    'action.undo': '悔棋',
    'action.dismiss': '继续看看',
    'sound.mute': '关闭音效',
    'sound.unmute': '开启音效',
    'action.again': '再来一局',
    'record.title': '本机战绩',
    'record.win': '胜',
    'record.lose': '负',
    'record.draw': '平',
    'result.youWin': '你赢了！',
    'result.aiWin': 'AI 获胜',
    'result.draw': '平局',
    'result.meta': '{n} 手 · {time}',
    'win.kicker': '胜利',
    'win.title': '你赢了！',
    'win.subtitle': '五子棋 · {difficulty}难度',
    'win.stats': '用 {n} 手赢下对局 · {time}',
    'a11y.board': '五子棋棋盘，15 乘 15。使用方向键移动，回车落子。',
    'a11y.cell': '第 {row} 行第 {col} 列',
  },
};

const CSS = `
.mgRoot {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 16px 16px 20px;
  overflow-y: auto;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  --mg-board-face-1: #f5dcb1;
  --mg-board-face-2: #e2b77d;
  --mg-board-line: rgba(104, 68, 28, .52);
  --mg-board-edge: rgba(122, 82, 38, .34);
  --mg-gold: #e8a324;
  --mg-gold-soft: rgba(255, 197, 61, .18);
}
body[data-ds-dark-theme] .mgRoot {
  --mg-board-face-1: #c99c66;
  --mg-board-face-2: #a87b49;
  --mg-board-line: rgba(44, 27, 11, .62);
  --mg-board-edge: rgba(16, 9, 2, .45);
  --mg-gold: #ffd76a;
  --mg-gold-soft: rgba(255, 215, 106, .14);
}
.mgHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.mgHeadText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mgHeadTitle { font-size: 14px; font-weight: 600; letter-spacing: .01em; }
.mgHeadSub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.mgHeadActions { display: flex; align-items: center; gap: 6px; flex: none; }
.mgIconBtn {
  width: 26px; height: 26px; padding: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 7px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
@media (hover: hover) {
  .mgIconBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.mgIconBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mgIconBtn[data-on="false"] { color: var(--dsw-alias-label-tertiary); }
.mgRecord {
  display: inline-flex; align-items: center; gap: 5px; flex: none;
  padding: 4px 9px; border-radius: 999px; font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l1);
}
.mgRecord b { font-weight: 600; font-variant-numeric: tabular-nums; }
.mgRecord b[data-k="w"] { color: var(--dsw-alias-state-success-primary); }
.mgRecord b[data-k="l"] { color: var(--dsw-alias-state-error-primary); }
.mgRecord b[data-k="d"] { color: var(--dsw-alias-label-tertiary); }
.mgRecordSep { color: var(--dsw-alias-border-l2); }
.mgShelf { display: flex; gap: 8px; }
.mgCard {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; text-align: left; font: inherit; color: inherit;
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
}
.mgCard[data-active="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, var(--dsw-alias-bg-layer-1));
}
.mgCardGhost { cursor: default; border-style: dashed; opacity: .78; }
.mgCardIcon {
  width: 27px; height: 27px; flex: none; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent);
}
.mgCardGhost .mgCardIcon { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-layer-2); }
.mgCardText { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mgCardTitle { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgCardDesc { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgDiffRow { display: flex; align-items: center; gap: 8px; }
.mgDiffLabel { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.mgSeg {
  flex: 1 1 0; display: flex; gap: 2px; padding: 2px; border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l1);
}
.mgSegBtn {
  flex: 1 1 0; min-width: 0; height: 24px; border: none; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11.5px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
@media (hover: hover) {
  .mgSegBtn:hover:not([data-active="true"]) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.mgSegBtn[data-active="true"] {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-weight: 500;
}
.mgSegBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mgGame { display: flex; flex-direction: column; gap: 10px; }
.mgStatusRow { display: flex; align-items: center; gap: 8px; min-height: 20px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mgDot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary); }
.mgDot[data-tone="you"] { background: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.mgDot[data-tone="ai"] { background: var(--dsw-alias-label-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); }
.mgDot[data-tone="thinking"] { background: var(--dsw-alias-label-primary); animation: mgDotPulse 1.1s ease-in-out infinite; }
.mgDot[data-tone="win"] { background: var(--mg-gold); box-shadow: 0 0 0 3px var(--mg-gold-soft); }
.mgDot[data-tone="lose"] { background: var(--dsw-alias-state-error-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 15%, transparent); }
.mgDot[data-tone="draw"] { background: var(--dsw-alias-label-tertiary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent); }
.mgStatusText { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mgMoveCount { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
@keyframes mgDotPulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.mgBoardWrap { display: flex; justify-content: center; align-items: flex-start; }
.mgBoard {
  position: relative;
  width: min(100%, 460px, 62vh);
  aspect-ratio: 1 / 1;
  border-radius: 14px;
  background: linear-gradient(155deg, var(--mg-board-face-1), var(--mg-board-face-2));
  border: 1px solid var(--mg-board-edge);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .32), 0 14px 30px -20px rgba(60, 34, 6, .85);
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}
.mgBoard:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary), 0 14px 30px -20px rgba(60, 34, 6, .85); }
.mgBoardSvg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mgGrid {
  position: absolute;
  left: 4.2683%; top: 4.2683%; width: 91.4634%; height: 91.4634%;
  display: flex;
  flex-direction: column;
}
.mgGridRow { display: flex; flex: 1 1 0; min-height: 0; }
.mgHitCell { position: relative; flex: 1 1 0; min-width: 0; border-radius: 50%; cursor: pointer; }
.mgBoard[data-over="true"] .mgHitCell { cursor: default; }
.mgStone { filter: drop-shadow(0 .045px .07px rgba(40, 20, 0, .38)); }
.mgLastMark { fill: var(--dsw-alias-brand-primary); pointer-events: none; }
.mgGhost { opacity: .4; pointer-events: none; }
.mgCursor { fill: none; stroke: var(--dsw-alias-brand-primary); stroke-width: .07; stroke-dasharray: .16 .13; opacity: .9; pointer-events: none; }
.mgWinLine {
  stroke: var(--mg-gold); stroke-width: .1; stroke-linecap: round; opacity: .95; pointer-events: none;
  stroke-dasharray: var(--mg-len, 4); stroke-dashoffset: var(--mg-len, 4);
  animation: mgWinLine 1s ease-out .12s forwards;
}
@keyframes mgWinLine { to { stroke-dashoffset: 0; } }
.mgWinRing {
  fill: none; stroke: var(--mg-gold); stroke-width: .075; pointer-events: none;
  animation: mgWinRing 1.7s ease-in-out infinite;
}
@keyframes mgWinRing { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
.mgResult {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 11px; border-radius: 10px; font-size: 12px;
  border: .5px solid var(--mg-gold-soft);
  background: linear-gradient(90deg, var(--mg-gold-soft), transparent 70%);
  animation: mgResultIn .4s ease-out both;
}
.mgResult[data-result="lose"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent), transparent 70%);
}
.mgResult[data-result="draw"] { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.mgResultIcon { display: flex; flex: none; color: var(--mg-gold); }
.mgResult[data-result="lose"] .mgResultIcon { color: var(--dsw-alias-state-error-primary); }
.mgResult[data-result="draw"] .mgResultIcon { color: var(--dsw-alias-label-tertiary); }
.mgResultTrophy { width: 16px; height: 16px; display: block; }
.mgResultText { font-weight: 500; }
.mgResultMeta { margin-left: auto; flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
@keyframes mgResultIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.mgActions { display: flex; gap: 8px; }
.mgBtn {
  flex: 1 1 0; min-width: 0; height: 34px; border-radius: 9px;
  border: .5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12.5px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: background .15s ease, opacity .15s ease, border-color .15s ease;
}
@media (hover: hover) { .mgBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }
.mgBtn:disabled { opacity: .42; cursor: default; }
.mgBtnPrimary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); font-weight: 500; }
@media (hover: hover) { .mgBtnPrimary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.08); } }
.mgHint { font-size: 11px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.mgTitleIcon { color: var(--dsw-alias-label-tertiary); flex: none; }
.mgLauncher {
  width: 28px; height: 28px; padding: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 7px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
@media (hover: hover) {
  .mgLauncher:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.mgLauncher:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mgLauncher:active { background: var(--dsw-alias-interactive-bg-active); }

/* Frame-wide victory celebration (shell.overlay). */
.mgoLayer {
  position: fixed; inset: 0; z-index: 2000; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.mgoBackdrop {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 50% 44%, rgba(255, 197, 61, .22), transparent 58%),
    rgba(8, 12, 22, .32);
  animation: mgoFadeIn .55s ease both;
}
.mgoRays {
  position: absolute; left: 50%; top: 46%; width: min(150vmin, 1500px); aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, rgba(255, 214, 106, .2) 0deg 5deg, transparent 5deg 18deg);
  -webkit-mask-image: radial-gradient(circle, transparent 14%, #000 26%, transparent 68%);
  mask-image: radial-gradient(circle, transparent 14%, #000 26%, transparent 68%);
  animation: mgoSpin 18s linear infinite;
}
@keyframes mgoSpin { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }
.mgoConfetti {
  position: absolute; top: -14px; border-radius: 2px; opacity: 0;
  animation-name: mgoFall; animation-timing-function: cubic-bezier(.25, .4, .6, 1); animation-fill-mode: both;
  will-change: transform, opacity;
}
@keyframes mgoFall {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 0; }
  6% { opacity: 1; }
  100% { transform: translate3d(var(--mg-drift, 0px), 110vh, 0) rotate(var(--mg-rot, 720deg)); opacity: .85; }
}
.mgoSpark {
  position: absolute; width: 6px; height: 6px; border-radius: 50%; opacity: 0;
  animation: mgoSpark var(--mg-spark-dur, 1.5s) ease-out var(--mg-spark-delay, 0s) both;
  will-change: transform, opacity;
}
@keyframes mgoSpark {
  0% { transform: translate(-50%, -50%) scale(.35); opacity: 1; }
  70% { opacity: .9; }
  100% { transform: translate(calc(-50% + var(--mg-dx, 0px)), calc(-50% + var(--mg-dy, 0px))) scale(.08); opacity: 0; }
}
.mgoCard {
  position: relative; pointer-events: auto;
  width: min(430px, calc(100vw - 40px));
  padding: 26px 26px 22px; border-radius: 20px; text-align: center;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid rgba(255, 197, 61, .5);
  box-shadow:
    0 40px 90px -30px rgba(0, 0, 0, .55),
    0 0 90px -24px rgba(255, 197, 61, .55),
    inset 0 0 0 1px rgba(255, 255, 255, .06);
  animation: mgoPop .8s cubic-bezier(.18, 1.35, .36, 1) both;
}
@keyframes mgoPop {
  0% { opacity: 0; transform: translateY(26px) scale(.84); }
  60% { opacity: 1; }
  100% { opacity: 1; transform: none; }
}
.mgoCardGlow {
  position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 0%, rgba(255, 214, 106, .2), transparent 62%);
}
.mgoMedal { position: relative; width: 92px; height: 92px; margin: 0 auto 14px; display: flex; align-items: center; justify-content: center; }
.mgoMedalHalo {
  position: absolute; inset: -8px; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, rgba(255, 197, 61, .55) 0deg 6deg, transparent 6deg 16deg);
  -webkit-mask-image: radial-gradient(circle, transparent 50%, #000 55%, #000 66%, transparent 73%);
  mask-image: radial-gradient(circle, transparent 50%, #000 55%, #000 66%, transparent 73%);
  animation: mgoSpinOnce 10s linear infinite;
}
@keyframes mgoSpinOnce { to { transform: rotate(360deg); } }
.mgoMedalDisc {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 50% 32%, #fff8e6, #ffe6a8 58%, #f0c164);
  box-shadow: inset 0 -6px 14px rgba(160, 96, 0, .28), 0 12px 26px -12px rgba(255, 170, 0, .85);
}
.mgoTrophy { position: relative; width: 54px; height: 54px; filter: drop-shadow(0 2px 3px rgba(120, 70, 0, .38)); }
.mgoKicker { font-size: 10.5px; letter-spacing: .24em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px; }
.mgoTitle { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 700; letter-spacing: .01em; color: var(--dsw-alias-label-primary); }
.mgoSubtitle { margin-top: 7px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.mgoStats {
  margin-top: 14px; display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 13px; border-radius: 999px; font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: .5px solid var(--dsw-alias-border-l1);
  font-variant-numeric: tabular-nums;
}
.mgoActions { margin-top: 20px; display: flex; gap: 10px; justify-content: center; }
.mgoBtn {
  height: 38px; padding: 0 20px; border-radius: 10px;
  font: inherit; font-size: 13px; cursor: pointer;
  border: .5px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
  transition: background .15s ease, filter .15s ease;
}
.mgoBtnPrimary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); font-weight: 500; }
@media (hover: hover) {
  .mgoBtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
  .mgoBtnPrimary:hover { background: var(--dsw-alias-brand-primary); filter: brightness(1.08); }
}
@media (prefers-reduced-motion: reduce) {
  .mgoRays, .mgoMedalHalo, .mgoConfetti, .mgoSpark, .mgoCard, .mgWinRing, .mgDot[data-tone="thinking"], .mgResult { animation: none !important; }
  .mgWinLine { animation: none !important; stroke-dashoffset: 0 !important; }
}
`;

/* ------------------------------------------------------------------ helpers */

/** Two-digit pad for the duration readout. */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Whole-second duration as `m:ss` (or `h:mm:ss` past the hour). */
function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Per-browser win/loss/draw tally; storage failures leave the game playable. */
function readRecord() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { win: 0, lose: 0, draw: 0 };
    const raw = window.localStorage.getItem(RECORD_KEY);
    if (!raw) return { win: 0, lose: 0, draw: 0 };
    const parsed = JSON.parse(raw);
    const pick = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
    return { win: pick(parsed.win), lose: pick(parsed.lose), draw: pick(parsed.draw) };
  } catch {
    return { win: 0, lose: 0, draw: 0 };
  }
}

/** Persist the tally; a refused write only costs the record, never the game. */
function writeRecord(record) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {
    /* storage disabled or full: keep playing */
  }
}

/** Read the persisted AI strength, falling back to the hardest setting. */
function readDifficulty() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_DIFFICULTY;
    const value = window.localStorage.getItem(DIFFICULTY_KEY);
    return value !== null && value in DIFFICULTIES ? value : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

/** Persist the chosen AI strength; a refused write only loses the preference. */
function writeDifficulty(id) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(DIFFICULTY_KEY, id);
  } catch {
    /* storage disabled */
  }
}

/** Whether placement sounds are on; they default to on. */
function readSound() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Persist the sound preference. */
function writeSound(enabled) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage disabled */
  }
}

/* --------------------------------------------------------------- audio */

/** Lazily created Web Audio context; browsers start it on a user gesture. */
let audioContext = null;

/** Return a running AudioContext, or null where the platform cannot provide one. */
function ensureAudioContext() {
  if (audioContext !== null) {
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioContextClass !== 'function') return null;
  try {
    audioContext = new AudioContextClass();
  } catch {
    return null;
  }
  return audioContext;
}

/**
 * One short wooden "clack" for a stone landing, synthesized in the Web Audio
 * graph: a filtered noise transient plus a low sine body. Black and white
 * differ slightly in pitch so a move reads by ear.
 */
function playStoneSound(player, enabled) {
  if (!enabled) return;
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const black = player !== AI;
  const duration = 0.085;
  const frames = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    const progress = i / frames;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 3.2);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = black ? 2500 : 1900;
  band.Q.value = 1.15;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(black ? 0.5 : 0.42, now + 0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(band);
  band.connect(noiseGain);
  noiseGain.connect(context.destination);
  source.start(now);
  source.stop(now + duration + 0.01);

  const body = context.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(black ? 300 : 235, now);
  body.frequency.exponentialRampToValueAtTime(118, now + 0.08);
  const bodyGain = context.createGain();
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  body.connect(bodyGain);
  bodyGain.connect(context.destination);
  body.start(now);
  body.stop(now + 0.12);
}

/** A short rising three-note chime under the victory celebration. */
function playVictorySound(enabled) {
  if (!enabled) return;
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const notes = [
    { at: 0, frequency: 659.25 },
    { at: 0.12, frequency: 783.99 },
    { at: 0.24, frequency: 1046.5 },
  ];
  for (const note of notes) {
    const start = now + note.at;
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(note.frequency, start);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(start);
    osc.stop(start + 0.34);
  }
}

/** Release the audio context when the plugin unloads. */
function disposeAudio() {
  if (audioContext === null) return;
  try {
    audioContext.close();
  } catch {
    /* already closed */
  }
  audioContext = null;
}

/** Monotonic-ish game identity for the celebration/record one-shot guards. */
let gameCounter = 0;

/** A fresh game: empty board, the human plays black and moves first. */
function createGame() {
  gameCounter += 1;
  return {
    id: gameCounter,
    board: createBoard(),
    turn: HUMAN,
    phase: 'playing',
    winLine: null,
    lastMove: -1,
    history: [],
    startedAt: 0,
    endedAt: 0,
  };
}

/** Apply one stone, returning the next state (win/draw terminal phases included). */
function applyMove(state, index, player) {
  if (state.phase !== 'playing') return state;
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE * BOARD_SIZE) return state;
  if (state.board[index] !== EMPTY) return state;
  const board = state.board.slice();
  board[index] = player;
  const won = isFiveAt(board, index, player);
  const draw = !won && isFull(board);
  const phase = won ? (player === HUMAN ? 'won' : 'lost') : draw ? 'draw' : 'playing';
  return {
    ...state,
    board,
    history: state.history.concat(index),
    lastMove: index,
    winLine: won ? findWinLine(board, index, player) : null,
    phase,
    turn: player === HUMAN ? AI : HUMAN,
    startedAt: state.startedAt || Date.now(),
    endedAt: phase === 'playing' ? 0 : Date.now(),
  };
}

/** Take back the human's last move and the AI reply; only from the human's turn. */
function undoMove(state) {
  if (state.phase !== 'playing' || state.turn !== HUMAN || state.history.length < 2) return state;
  const history = state.history.slice(0, -2);
  const board = state.board.slice();
  for (const index of state.history.slice(-2)) board[index] = EMPTY;
  return {
    ...state,
    board,
    history,
    lastMove: history.length > 0 ? history[history.length - 1] : -1,
    winLine: null,
    turn: HUMAN,
  };
}

/** Last-resort legal move if the search fails: the empty point nearest the centre. */
function emergencyMove(board) {
  let best = -1;
  let bestDistance = Infinity;
  const centre = Math.floor(BOARD_SIZE / 2);
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue;
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const distance = Math.abs(x - centre) + Math.abs(y - centre);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** Elapsed seconds of a finished game, for the result strip. */
function elapsedSeconds(state) {
  if (!state.startedAt) return 0;
  return ((state.endedAt || Date.now()) - state.startedAt) / 1000;
}

/** The two endpoints of a winning line, sorted left-to-right / top-to-bottom. */
function winLineEndpoints(indices) {
  const sorted = indices
    .slice()
    .sort((a, b) => (a % BOARD_SIZE) - (b % BOARD_SIZE) || Math.floor(a / BOARD_SIZE) - Math.floor(b / BOARD_SIZE));
  const toPoint = (index) => ({ x: (index % BOARD_SIZE) + 0.5, y: Math.floor(index / BOARD_SIZE) + 0.5 });
  return { from: toPoint(sorted[0]), to: toPoint(sorted[sorted.length - 1]) };
}

/* -------------------------------------------------- frame-wide celebration */

/**
 * One celebration at a time, shared between the tab body (which triggers it)
 * and the root-scoped `shell.overlay` layer (which draws it). Payload strings
 * are resolved by the caller so the layer needs no locale dependency.
 */
const celebration = (() => {
  let snapshot = { id: 0, payload: null };
  const listeners = new Set();
  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    trigger(payload) {
      snapshot = { id: snapshot.id + 1, payload };
      emit();
    },
    dismiss() {
      if (snapshot.payload === null) return;
      snapshot = { id: snapshot.id + 1, payload: null };
      emit();
    },
  };
})();

/** Deterministic PRNG so a re-render never reshuffles the falling pieces. */
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELEBRATION_PALETTE = ['#ffd76a', '#ffb84d', '#4d6bfe', '#7be0ad', '#ff8fb1', '#b69cff', '#ffffff'];

/** Whether the platform asks for reduced motion (animated layers defer to it). */
function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches === true);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    return undefined;
  }, []);
  return reduced;
}

/** The falling confetti and firework sparks of one celebration. */
function celebrationPieces(seed, reduced) {
  if (reduced) return { confetti: [], sparks: [] };
  const random = seededRandom(seed);
  const confetti = [];
  for (let i = 0; i < 110; i += 1) {
    confetti.push({
      key: `c${i}`,
      left: random() * 100,
      delay: random() * 0.9,
      duration: 2.9 + random() * 2.1,
      drift: (random() * 2 - 1) * 150,
      rotation: (random() * 2 - 1) * 880,
      width: 6 + random() * 5,
      height: 10 + random() * 9,
      color: CELEBRATION_PALETTE[i % CELEBRATION_PALETTE.length],
    });
  }
  const bursts = [
    { x: 22, y: 28 },
    { x: 79, y: 24 },
    { x: 52, y: 58 },
  ];
  const sparks = [];
  bursts.forEach((burst, burstIndex) => {
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2 + random() * 0.2;
      const distance = 90 + random() * 120;
      sparks.push({
        key: `s${burstIndex}-${i}`,
        x: burst.x,
        y: burst.y,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        delay: burstIndex * 0.45 + random() * 0.12,
        duration: 1.2 + random() * 0.6,
        color: CELEBRATION_PALETTE[(i + burstIndex) % CELEBRATION_PALETTE.length],
      });
    }
  });
  return { confetti, sparks };
}

/** Trophy artwork (gold cup with a star), drawn once per celebration. */
function TrophyGlyph({ className }) {
  const gradientId = React.useRef(null);
  if (gradientId.current === null) {
    gradientId.current = `mgTrophy${Math.random().toString(36).slice(2, 8)}`;
  }
  const gold = `url(#${gradientId.current})`;
  return React.createElement(
    'svg',
    { viewBox: '0 0 48 48', className, 'aria-hidden': 'true', focusable: 'false' },
    React.createElement(
      'defs',
      null,
      React.createElement(
        'linearGradient',
        { id: gradientId.current, x1: '0', y1: '0', x2: '0', y2: '1' },
        React.createElement('stop', { offset: '0', stopColor: '#ffe9a8' }),
        React.createElement('stop', { offset: '0.45', stopColor: '#ffc53d' }),
        React.createElement('stop', { offset: '1', stopColor: '#d98f13' }),
      ),
    ),
    React.createElement('path', {
      d: 'M13 7.5h22v8.6c0 6.1-4.9 11-11 11s-11-4.9-11-11V7.5Z',
      fill: gold,
      stroke: '#9a6400',
      strokeWidth: '1.4',
    }),
    React.createElement('rect', { x: '11', y: '5', width: '26', height: '3.8', rx: '1.9', fill: '#ffd76a', stroke: '#9a6400', strokeWidth: '1.2' }),
    React.createElement('path', {
      d: 'M13 10H8.8a5.3 5.3 0 0 0 0 10.6H13',
      fill: 'none',
      stroke: '#e5a420',
      strokeWidth: '2.4',
      strokeLinecap: 'round',
    }),
    React.createElement('path', {
      d: 'M35 10h4.2a5.3 5.3 0 0 1 0 10.6H35',
      fill: 'none',
      stroke: '#e5a420',
      strokeWidth: '2.4',
      strokeLinecap: 'round',
    }),
    React.createElement('path', { d: 'M21.4 27.4h5.2l1.2 5.4h-7.6l1.2-5.4Z', fill: '#e5a420', stroke: '#9a6400', strokeWidth: '1.1' }),
    React.createElement('rect', { x: '15.4', y: '32.6', width: '17.2', height: '3.7', rx: '1.85', fill: '#ffc53d', stroke: '#9a6400', strokeWidth: '1.1' }),
    React.createElement('rect', { x: '18.6', y: '36.4', width: '10.8', height: '2.6', rx: '1.3', fill: '#f0b52c', stroke: '#9a6400', strokeWidth: '1' }),
    React.createElement('path', {
      d: 'M24 11.1l1.5 3.2 3.5.5-2.55 2.45.62 3.45L24 19.1l-3.07 1.6.62-3.45L18.999 14.8l3.5-.5L24 11.1Z',
      fill: '#fff6da',
      stroke: '#9a6400',
      strokeWidth: '0.8',
      strokeLinejoin: 'round',
    }),
  );
}

/** Frame-wide celebration layer: backdrop, rays, confetti, fireworks, medal card. */
function CelebrationLayer() {
  const snapshot = React.useSyncExternalStore(celebration.subscribe, celebration.getSnapshot, celebration.getSnapshot);
  const reduced = useReducedMotion();
  const payload = snapshot.payload;
  const pieces = React.useMemo(() => celebrationPieces(snapshot.id * 7919 + 17, reduced), [snapshot.id, reduced]);

  React.useEffect(() => {
    if (payload === null) return undefined;
    const timer = window.setTimeout(() => celebration.dismiss(), CELEBRATION_MS);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') celebration.dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [snapshot.id, payload]);

  if (payload === null) return null;

  const children = [
    React.createElement('div', { key: 'backdrop', className: 'mgoBackdrop' }),
    React.createElement('div', { key: 'rays', className: 'mgoRays' }),
  ];
  for (const piece of pieces.confetti) {
    children.push(
      React.createElement('div', {
        key: piece.key,
        className: 'mgoConfetti',
        style: {
          left: `${piece.left}%`,
          width: `${piece.width}px`,
          height: `${piece.height}px`,
          background: piece.color,
          animationDelay: `${piece.delay}s`,
          animationDuration: `${piece.duration}s`,
          '--mg-drift': `${piece.drift}px`,
          '--mg-rot': `${piece.rotation}deg`,
        },
      }),
    );
  }
  for (const spark of pieces.sparks) {
    children.push(
      React.createElement('div', {
        key: spark.key,
        className: 'mgoSpark',
        style: {
          left: `${spark.x}%`,
          top: `${spark.y}%`,
          background: spark.color,
          '--mg-dx': `${spark.dx}px`,
          '--mg-dy': `${spark.dy}px`,
          '--mg-spark-delay': `${spark.delay}s`,
          '--mg-spark-dur': `${spark.duration}s`,
        },
      }),
    );
  }
  children.push(
    React.createElement(
      'div',
      {
        key: 'card',
        className: 'mgoCard',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': payload.title,
        style: { pointerEvents: 'auto' },
      },
      React.createElement('div', { className: 'mgoCardGlow', 'aria-hidden': 'true' }),
      React.createElement(
        'div',
        { className: 'mgoMedal', 'aria-hidden': 'true' },
        React.createElement('div', { className: 'mgoMedalHalo' }),
        React.createElement('div', { className: 'mgoMedalDisc' }),
        React.createElement(TrophyGlyph, { className: 'mgoTrophy' }),
      ),
      React.createElement('div', { className: 'mgoKicker' }, payload.kicker),
      React.createElement('h2', { className: 'mgoTitle' }, payload.title),
      React.createElement('div', { className: 'mgoSubtitle' }, payload.subtitle),
      React.createElement('div', { className: 'mgoStats' }, payload.stats),
      React.createElement(
        'div',
        { className: 'mgoActions' },
        React.createElement('button', { type: 'button', className: 'mgoBtn mgoBtnPrimary', onClick: payload.onAgain }, payload.again),
        React.createElement('button', { type: 'button', className: 'mgoBtn', onClick: () => celebration.dismiss() }, payload.dismiss),
      ),
    ),
  );

  return React.createElement('div', { className: 'mgoLayer', style: { pointerEvents: 'none' } }, ...children);
}

/* ------------------------------------------------------------- board glyphs */

/** The tab chip / guide capsule glyph: a board with a centre stone. */
function GameBoxGlyph({ size = 16, className }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', className },
    React.createElement('rect', { x: '2', y: '2', width: '12', height: '12', rx: '3', stroke: 'currentColor', strokeWidth: '1.2' }),
    React.createElement('path', { d: 'M6 2.4v11.2M10 2.4v11.2M2.4 6h11.2M2.4 10h11.2', stroke: 'currentColor', strokeOpacity: '0.42', strokeWidth: '1' }),
    React.createElement('circle', { cx: '8', cy: '8', r: '1.75', fill: 'currentColor' }),
  );
}

/** Speaker glyph for the sound toggle, with a slash when muted. */
function SoundGlyph({ on }) {
  return React.createElement(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', { d: 'M3 6.1h2.4L8.7 3.4v9.2L5.4 9.9H3V6.1Z', fill: 'currentColor', fillOpacity: '0.85' }),
    on
      ? React.createElement('path', {
          d: 'M10.7 5.9a3 3 0 0 1 0 4.2M12.5 4.3a5.4 5.4 0 0 1 0 7.4',
          stroke: 'currentColor',
          strokeWidth: '1.25',
          strokeLinecap: 'round',
        })
      : React.createElement('path', {
          d: 'M10.9 6.2l3.3 3.6M14.2 6.2l-3.3 3.6',
          stroke: 'currentColor',
          strokeWidth: '1.25',
          strokeLinecap: 'round',
        }),
  );
}

/** Title row of the tab chip: glyph followed by the captured tab title. */
function GameBoxTitle(props) {
  const info = props.useTabInfo();
  const label = typeof props.t === 'function' ? props.t('type.label') : info.tab.title;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(GameBoxGlyph, { className: 'mgTitleIcon' }),
    label,
  );
}

/* --------------------------------------------------------------- the board */

/** One rendered board: lines, star points, stones, ghost, cursor and win line. */
function Board(props) {
  const { board, t, winLine, lastMove, hover, cursor, keyboardMode, disabled, onHover, onPick } = props;
  const gradientId = React.useRef(null);
  if (gradientId.current === null) {
    gradientId.current = `mgStone${Math.random().toString(36).slice(2, 8)}`;
  }
  const blackId = `${gradientId.current}Black`;
  const whiteId = `${gradientId.current}White`;

  const stones = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === EMPTY) continue;
    stones.push(index);
  }
  const ghostIndex =
    !disabled && hover >= 0 && hover < board.length && board[hover] === EMPTY && !keyboardMode ? hover : -1;
  const cursorIndex = keyboardMode && !disabled ? cursor : -1;
  const winning = new Set(winLine ?? []);
  const endpoints = winLine ? winLineEndpoints(winLine) : null;
  const lineLength = endpoints
    ? Math.hypot(endpoints.to.x - endpoints.from.x, endpoints.to.y - endpoints.from.y)
    : 0;
  const rows = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const rowCells = [];
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const index = y * BOARD_SIZE + x;
      rowCells.push(
        React.createElement('div', {
          key: index,
          className: 'mgHitCell',
          role: 'gridcell',
          'aria-rowindex': y + 1,
          'aria-colindex': x + 1,
          'aria-label': t('a11y.cell', { row: y + 1, col: x + 1 }),
          onClick: () => onPick(index),
          onMouseEnter: () => onHover(index),
          onMouseLeave: () => onHover(-1),
        }),
      );
    }
    rows.push(React.createElement('div', { key: y, className: 'mgGridRow', role: 'row', 'aria-rowindex': y + 1 }, rowCells));
  }

  return React.createElement(
    'div',
    {
      className: 'mgBoard',
      'data-over': disabled ? 'true' : 'false',
      role: 'grid',
      tabIndex: 0,
      'aria-label': t('a11y.board'),
      'aria-rowcount': BOARD_SIZE,
      'aria-colcount': BOARD_SIZE,
      onKeyDown: props.onKeyDown,
      onMouseLeave: () => onHover(-1),
    },
    React.createElement(
      'svg',
      { className: 'mgBoardSvg', viewBox: '-0.7 -0.7 16.4 16.4', 'aria-hidden': 'true', focusable: 'false' },
      React.createElement(
        'defs',
        null,
        React.createElement(
          'radialGradient',
          { id: blackId, cx: '0.36', cy: '0.28', r: '0.85' },
          React.createElement('stop', { offset: '0', stopColor: '#7d7d7d' }),
          React.createElement('stop', { offset: '0.35', stopColor: '#2b2b2b' }),
          React.createElement('stop', { offset: '1', stopColor: '#040404' }),
        ),
        React.createElement(
          'radialGradient',
          { id: whiteId, cx: '0.36', cy: '0.28', r: '0.85' },
          React.createElement('stop', { offset: '0', stopColor: '#ffffff' }),
          React.createElement('stop', { offset: '0.62', stopColor: '#f2f0ec' }),
          React.createElement('stop', { offset: '1', stopColor: '#cec8bf' }),
        ),
      ),
      Array.from({ length: BOARD_SIZE }, (_, row) =>
        React.createElement('line', {
          key: `h${row}`,
          x1: '0.5',
          y1: row + 0.5,
          x2: '14.5',
          y2: row + 0.5,
          stroke: 'var(--mg-board-line)',
          strokeWidth: '0.045',
        }),
      ),
      Array.from({ length: BOARD_SIZE }, (_, column) =>
        React.createElement('line', {
          key: `v${column}`,
          x1: column + 0.5,
          y1: '0.5',
          x2: column + 0.5,
          y2: '14.5',
          stroke: 'var(--mg-board-line)',
          strokeWidth: '0.045',
        }),
      ),
      React.createElement(
        'g',
        { fill: 'var(--mg-board-line)' },
        [
          [3.5, 3.5],
          [11.5, 3.5],
          [7.5, 7.5],
          [3.5, 11.5],
          [11.5, 11.5],
        ].map(([x, y], position) =>
          React.createElement('circle', { key: `s${position}`, cx: x, cy: y, r: '0.11' }),
        ),
      ),
      stones.length > 0 &&
        React.createElement(
          'g',
          null,
          stones.map((index) => {
            const x = (index % BOARD_SIZE) + 0.5;
            const y = Math.floor(index / BOARD_SIZE) + 0.5;
            const black = board[index] === HUMAN;
            return React.createElement('circle', {
              key: `stone${index}`,
              className: 'mgStone',
              cx: x,
              cy: y,
              r: '0.44',
              fill: `url(#${black ? blackId : whiteId})`,
              stroke: black ? 'rgba(0,0,0,0.35)' : 'rgba(120,112,100,0.55)',
              strokeWidth: '0.02',
            });
          }),
        ),
      ghostIndex >= 0 &&
        React.createElement('circle', {
          key: 'ghost',
          className: 'mgGhost',
          cx: (ghostIndex % BOARD_SIZE) + 0.5,
          cy: Math.floor(ghostIndex / BOARD_SIZE) + 0.5,
          r: '0.44',
          fill: `url(#${blackId})`,
        }),
      lastMove >= 0 &&
        !winLine &&
        React.createElement('circle', {
          key: 'last',
          className: 'mgLastMark',
          cx: (lastMove % BOARD_SIZE) + 0.5,
          cy: Math.floor(lastMove / BOARD_SIZE) + 0.5,
          r: '0.13',
        }),
      cursorIndex >= 0 &&
        React.createElement('circle', {
          key: 'cursor',
          className: 'mgCursor',
          cx: (cursorIndex % BOARD_SIZE) + 0.5,
          cy: Math.floor(cursorIndex / BOARD_SIZE) + 0.5,
          r: '0.4',
        }),
      endpoints &&
        React.createElement('line', {
          key: 'winline',
          className: 'mgWinLine',
          x1: endpoints.from.x,
          y1: endpoints.from.y,
          x2: endpoints.to.x,
          y2: endpoints.to.y,
          style: { '--mg-len': lineLength },
        }),
      winning.size > 0 &&
        Array.from(winning).map((index, position) =>
          React.createElement('circle', {
            key: `ring${index}`,
            className: 'mgWinRing',
            cx: (index % BOARD_SIZE) + 0.5,
            cy: Math.floor(index / BOARD_SIZE) + 0.5,
            r: '0.5',
            style: { animationDelay: `${position * 70}ms` },
          }),
        ),
    ),
    React.createElement('div', { className: 'mgGrid' }, rows),
  );
}

/* ------------------------------------------------------------ the game page */

/** The right-sidebar tab body: game shelf, board, status, result and actions. */
function GameBoxBody(props) {
  const { t } = props;
  const [state, setState] = React.useState(createGame);
  const [record, setRecord] = React.useState(readRecord);
  const [difficulty, setDifficulty] = React.useState(readDifficulty);
  const [soundOn, setSoundOn] = React.useState(readSound);
  const soundRef = React.useRef(soundOn);
  const difficultyRef = React.useRef(difficulty);
  const [hover, setHover] = React.useState(-1);
  const [cursor, setCursor] = React.useState(112);
  const [keyboardMode, setKeyboardMode] = React.useState(false);
  const aliveRef = React.useRef(true);
  const recordedRef = React.useRef('');

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* Persist the tally outside the state updater so the reducer stays pure. */
  React.useEffect(() => {
    writeRecord(record);
  }, [record]);

  React.useEffect(() => {
    soundRef.current = soundOn;
    writeSound(soundOn);
  }, [soundOn]);

  React.useEffect(() => {
    difficultyRef.current = difficulty;
    writeDifficulty(difficulty);
  }, [difficulty]);

  /* The AI takes its turn shortly after the human's stone lands. The extra
   * delay keeps the "thinking" state readable; the engine itself is synchronous
   * and bounded by its time budget. */
  React.useEffect(() => {
    if (state.phase !== 'playing' || state.turn !== AI) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || !aliveRef.current) return;
      let moveIndex = -1;
      try {
        const level = DIFFICULTIES[difficultyRef.current] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
        const result = chooseMove(state.board, AI, { timeBudgetMs: level.timeBudgetMs, maxDepth: level.maxDepth });
        if (result && Number.isInteger(result.index)) moveIndex = result.index;
      } catch (error) {
        if (typeof console !== 'undefined') console.error('minigames: AI search failed', error);
      }
      /* A failed search must never leave the board waiting forever: fall back to
       * a legal point so the turn always resolves. */
      if (moveIndex < 0 || moveIndex >= state.board.length || state.board[moveIndex] !== EMPTY) {
        moveIndex = emergencyMove(state.board);
      }
      if (cancelled || moveIndex < 0) return;
      playStoneSound(AI, soundRef.current);
      setState((current) => {
        if (current.phase !== 'playing' || current.turn !== AI) return current;
        if (current.history.length !== state.history.length) return current;
        return applyMove(current, moveIndex, AI);
      });
    }, AI_MIN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.phase, state.turn, state.history.length]);

  /* One-shot per finished game: tally it, and celebrate a human victory. */
  React.useEffect(() => {
    if (state.phase === 'playing') return;
    const marker = `${state.id}:${state.phase}`;
    if (recordedRef.current === marker) return;
    recordedRef.current = marker;
    const key = state.phase === 'won' ? 'win' : state.phase === 'lost' ? 'lose' : 'draw';
    setRecord((current) => ({ ...current, [key]: current[key] + 1 }));
    if (state.phase !== 'won') return;
    playVictorySound(soundRef.current);
    celebration.trigger({
      kicker: t('win.kicker'),
      title: t('win.title'),
      subtitle: t('win.subtitle', { difficulty: t(`difficulty.${difficultyRef.current}`) }),
      stats: t('win.stats', {
        n: state.history.length,
        time: formatDuration(elapsedSeconds(state)),
      }),
      again: t('action.again'),
      dismiss: t('action.dismiss'),
      onAgain: () => {
        celebration.dismiss();
        if (aliveRef.current) setState(createGame());
      },
    });
  }, [state.phase, state.id]);

  const playing = state.phase === 'playing';
  const humanTurn = playing && state.turn === HUMAN;
  const canUndo = humanTurn && state.history.length >= 2;
  const difficultyLabel = t(`difficulty.${difficulty}`);

  const restart = React.useCallback(() => {
    celebration.dismiss();
    setHover(-1);
    setKeyboardMode(false);
    setState(createGame());
  }, []);

  const undo = React.useCallback(() => {
    setHover(-1);
    setState((current) => undoMove(current));
  }, []);

  const place = React.useCallback(
    (index) => {
      if (!humanTurn) return;
      setHover(-1);
      setKeyboardMode(false);
      playStoneSound(HUMAN, soundRef.current);
      setState((current) => applyMove(current, index, HUMAN));
    },
    [humanTurn],
  );

  const chooseDifficulty = React.useCallback((id) => {
    if (id in DIFFICULTIES) setDifficulty(id);
  }, []);

  const toggleSound = React.useCallback(() => {
    const next = !soundRef.current;
    setSoundOn(next);
    if (next) playStoneSound(HUMAN, true);
  }, []);

  const handleHover = React.useCallback((index) => {
    setHover(index);
    if (index >= 0) setKeyboardMode(false);
  }, []);

  const onKeyDown = React.useCallback(
    (event) => {
      const key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Enter' && key !== ' ') {
        return;
      }
      event.preventDefault();
      const x = cursor % BOARD_SIZE;
      const y = Math.floor(cursor / BOARD_SIZE);
      if (key === 'Enter' || key === ' ') {
        place(cursor);
        return;
      }
      setKeyboardMode(true);
      let nextX = x;
      let nextY = y;
      if (key === 'ArrowLeft') nextX = Math.max(0, x - 1);
      if (key === 'ArrowRight') nextX = Math.min(BOARD_SIZE - 1, x + 1);
      if (key === 'ArrowUp') nextY = Math.max(0, y - 1);
      if (key === 'ArrowDown') nextY = Math.min(BOARD_SIZE - 1, y + 1);
      setCursor(nextY * BOARD_SIZE + nextX);
    },
    [cursor, place],
  );

  let statusTone = 'you';
  let statusText = t('status.yourTurn');
  if (state.phase === 'won') {
    statusTone = 'win';
    statusText = t('status.youWin');
  } else if (state.phase === 'lost') {
    statusTone = 'lose';
    statusText = t('status.aiWin');
  } else if (state.phase === 'draw') {
    statusTone = 'draw';
    statusText = t('status.draw');
  } else if (state.turn === AI) {
    statusTone = 'thinking';
    statusText = t('status.aiThinking');
  }

  const resultMeta = t('result.meta', {
    n: state.history.length,
    time: formatDuration(elapsedSeconds(state)),
  });

  return React.createElement(
    'div',
    { className: 'mgRoot' },
    React.createElement(
      'div',
      { className: 'mgHead' },
      React.createElement(
        'div',
        { className: 'mgHeadText' },
        React.createElement('div', { className: 'mgHeadTitle' }, t('header.title')),
        React.createElement('div', { className: 'mgHeadSub' }, t('header.subtitle')),
      ),
      React.createElement(
        'div',
        { className: 'mgHeadActions' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mgIconBtn',
            'data-on': soundOn ? 'true' : 'false',
            'aria-pressed': soundOn,
            title: soundOn ? t('sound.mute') : t('sound.unmute'),
            'aria-label': soundOn ? t('sound.mute') : t('sound.unmute'),
            onClick: toggleSound,
          },
          React.createElement(SoundGlyph, { on: soundOn }),
        ),
        React.createElement(
          'div',
          {
            className: 'mgRecord',
            title: t('record.title'),
            'aria-label': `${t('record.title')}: ${t('record.win')} ${record.win}, ${t('record.lose')} ${record.lose}, ${t('record.draw')} ${record.draw}`,
          },
          React.createElement('b', { 'data-k': 'w' }, record.win),
          React.createElement('span', { className: 'mgRecordSep' }, '/'),
          React.createElement('b', { 'data-k': 'l' }, record.lose),
          React.createElement('span', { className: 'mgRecordSep' }, '/'),
          React.createElement('b', { 'data-k': 'd' }, record.draw),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'mgShelf' },
      React.createElement(
        'div',
        { className: 'mgCard', 'data-active': 'true', 'aria-current': 'true', 'aria-label': t('game.gomoku') },
        React.createElement('span', { className: 'mgCardIcon' }, React.createElement(GameBoxGlyph, { size: 17 })),
        React.createElement(
          'span',
          { className: 'mgCardText' },
          React.createElement('span', { className: 'mgCardTitle' }, t('game.gomoku')),
          React.createElement('span', { className: 'mgCardDesc' }, t('game.gomoku.desc', { difficulty: difficultyLabel })),
        ),
      ),
      React.createElement(
        'div',
        { className: 'mgCard mgCardGhost', 'aria-disabled': 'true' },
        React.createElement(
          'span',
          { className: 'mgCardIcon' },
          React.createElement(
            'svg',
            { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
            React.createElement('path', { d: 'M8 3.2v9.6M3.2 8h9.6', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
          ),
        ),
        React.createElement(
          'span',
          { className: 'mgCardText' },
          React.createElement('span', { className: 'mgCardTitle' }, t('game.more')),
          React.createElement('span', { className: 'mgCardDesc' }, t('game.more.desc')),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'mgDiffRow' },
      React.createElement('span', { className: 'mgDiffLabel' }, t('difficulty.label')),
      React.createElement(
        'div',
        { className: 'mgSeg', role: 'group', 'aria-label': t('difficulty.label') },
        DIFFICULTY_ORDER.map((id) =>
          React.createElement(
            'button',
            {
              key: id,
              type: 'button',
              className: 'mgSegBtn',
              'data-active': difficulty === id ? 'true' : 'false',
              'aria-pressed': difficulty === id,
              onClick: () => chooseDifficulty(id),
            },
            t(`difficulty.${id}`),
          ),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'mgGame' },
      React.createElement(
        'div',
        { className: 'mgStatusRow', role: 'status', 'aria-live': 'polite' },
        React.createElement('span', { className: 'mgDot', 'data-tone': statusTone, 'aria-hidden': 'true' }),
        React.createElement('span', { className: 'mgStatusText' }, statusText),
        React.createElement('span', { className: 'mgMoveCount' }, t('move.count', { n: state.history.length })),
      ),
      React.createElement(
        'div',
        { className: 'mgBoardWrap' },
        React.createElement(Board, {
          board: state.board,
          t,
          winLine: state.winLine,
          lastMove: state.lastMove,
          hover,
          cursor,
          keyboardMode,
          disabled: !humanTurn,
          onHover: handleHover,
          onPick: place,
          onKeyDown,
        }),
      ),
      state.phase !== 'playing' &&
        React.createElement(
          'div',
          {
            className: 'mgResult',
            'data-result': state.phase === 'won' ? 'win' : state.phase === 'draw' ? 'draw' : 'lose',
            role: 'status',
            'aria-live': 'polite',
          },
          React.createElement(
            'span',
            { className: 'mgResultIcon', 'aria-hidden': 'true' },
            state.phase === 'won'
              ? React.createElement(TrophyGlyph, { className: 'mgResultTrophy' })
              : React.createElement(
                  'svg',
                  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
                  React.createElement('circle', { cx: 8, cy: 8, r: 6, stroke: 'currentColor', strokeWidth: '1.3' }),
                  state.phase === 'draw'
                    ? React.createElement('path', { d: 'M5 8h6', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' })
                    : React.createElement('path', { d: 'M6 6l4 4M10 6l-4 4', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
                ),
          ),
          React.createElement(
            'span',
            { className: 'mgResultText' },
            state.phase === 'won' ? t('result.youWin') : state.phase === 'draw' ? t('result.draw') : t('result.aiWin'),
          ),
          React.createElement('span', { className: 'mgResultMeta' }, resultMeta),
        ),
      React.createElement(
        'div',
        { className: 'mgActions' },
        React.createElement('button', { type: 'button', className: 'mgBtn mgBtnPrimary', onClick: restart }, t('action.restart')),
        React.createElement('button', { type: 'button', className: 'mgBtn', onClick: undo, disabled: !canUndo }, t('action.undo')),
      ),
      React.createElement('div', { className: 'mgHint' }, t('hint.rules')),
    ),
  );
}

/* ------------------------------------------------------------- registration */

/** Static face of the tab type: identity, chip title and the Start-page capsule. */
function tabDefinition(t) {
  return {
    id: PLUGIN_ID,
    kind: KIND,
    multiple: false,
    keepMounted: true,
    title: () => t('type.label'),
    guide: [
      {
        id: 'gomoku',
        order: 40,
        title: () => t('guide.title'),
        description: () => t('guide.description'),
        icon: GameBoxGlyph,
      },
    ],
  };
}

/**
 * Composer-toolbar launcher: one click opens the game box in the right sidebar,
 * even when the panel is closed or parked on another tab. This is the reliable
 * entry point; the Start-page capsule remains the discoverable one.
 */
function createLauncher(ctx) {
  return function MiniGamesLauncher(props) {
    const t = props.t;
    const label = typeof t === 'function' ? t('launcher.title') : 'Mini games box';
    const open = () => {
      try {
        ctx.sidebarRight.openTab(KIND);
      } catch (error) {
        if (typeof console !== 'undefined') console.error('minigames: cannot open the game box', error);
      }
    };
    return React.createElement(
      'button',
      {
        type: 'button',
        className: 'mgLauncher',
        title: label,
        'aria-label': label,
        onClick: open,
      },
      React.createElement(GameBoxGlyph, { size: 17 }),
    );
  };
}

/** Insert the plugin stylesheet once per Client run, keyed for reload cleanup. */
function injectStyles() {
  const key = 'minigames-styles';
  if (typeof document === 'undefined') return () => {};
  document.querySelectorAll(`style[data-plugin-css="${key}"]`).forEach((element) => element.remove());
  const style = document.createElement('style');
  style.dataset.plugin = PLUGIN_ID;
  style.dataset.pluginCss = key;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];

/** Client plugin body: dictionaries, styles, tab type, body/title, celebration. */
function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, DICT), 'minigames: dictionaries');
  ctx.effect(() => injectStyles(), 'minigames: styles');
  ctx.effect(() => ctx.sidebarRightTabs.register(tabDefinition(t)), 'minigames: gomoku tab type');
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: NS }, GameBoxBody),
      ),
    'minigames: gomoku tab body',
  );
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PLUGIN_ID, locale: NS }, GameBoxTitle),
      ),
    'minigames: gomoku tab title',
  );
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: `${PLUGIN_ID}-celebration`, order: 80 }, CelebrationLayer),
      ),
    'minigames: victory celebration',
  );
  ctx.effect(() => () => disposeAudio(), 'minigames: audio cleanup');
  const MiniGamesLauncher = createLauncher(ctx);
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: `${PLUGIN_ID}-launcher`,
            order: 20,
            locale: NS,
            label: () => t('launcher.title'),
          },
          MiniGamesLauncher,
        ),
      ),
    'minigames: composer launcher',
  );
}

/* Test-only access to the pieces a Node smoke test exercises; harmless in the
 * browser and never referenced by the plugin lifecycle. */
const __mgTestExports = {
  celebration,
  createGame,
  applyMove,
  undoMove,
  elapsedSeconds,
  emergencyMove,
  tabDefinition,
  createLauncher,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  readDifficulty,
  readSound,
  writeDifficulty,
  writeSound,
  GameBoxBody,
  GameBoxTitle,
  CelebrationLayer,
  Board,
  initialRecord: readRecord,
};
