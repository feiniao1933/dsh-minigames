# dsh-minigames · 游戏盒子

A mini-games box for the DSH Web right sidebar. The first game is **Gomoku
(五子棋)** against the built-in AI in three difficulties; winning triggers a
frame-wide celebration with confetti, fireworks and a trophy card.

## Install

Requires DSH `0.2.2-rc.1` or newer with the Web client (the right-sidebar plugin
seats). Install from the public repository:

```bash
dsh plugin --profile web add 'github:feiniao1933/dsh-minigames'
```

To pin the reviewed revision:

```bash
dsh plugin --profile web add 'github:feiniao1933/dsh-minigames#<commit-sha>'
```

Restart `dsh web` if the running page does not pick the new bundle up. The
plugin's row id is `minigames-box`; it can be disabled again with
`dsh plugin --profile web remove dsh-minigames`.

## Screenshots

The game box in the right sidebar (dark theme): game shelf, difficulty selector,
sound toggle, local tally, board, and the restart/undo controls.

![The mini games box in the DSH right sidebar](screenshots/game-page.png)

A capture of the victory celebration will be added with the next release.
The repository ships no mock-up images.

## Where it lives

The plugin contributes one **right-sidebar tab type** and one **Start-page
capsule**, so it behaves like the rest of the right sidebar rather than floating
above it:

Two ways in, both backed by the same tab type:

- **Composer toolbar (fastest):** click the small board icon at the left of the
  composer tool row (next to the attach controls). It opens the right sidebar and
  the game box in one click, even when the panel is closed.
- **Start page:** open the right sidebar (the panel button in the conversation
  header), then on the **Start** page pick the **游戏盒子 / Mini games box**
  capsule. If the panel is parked on another tab, the "+" control in its tab
  strip reopens the Start page.

The game opens as a tab in the right sidebar: a game shelf at the top (five-in-a-row
active, "more games" placeholder), the board, the status row, and the controls.

Because it is a regular tab type, it can be split, floated or moved between
panes with the sidebar's own controls, and it stays mounted while hidden.

## Playing

- You play **black** and move first; the AI plays white.
- **Difficulty is selectable** in the page (`简单 / 普通 / 困难`, default `困难`)
  and remembered in `localStorage`. It is a search ladder over one engine:
  easy = 2-ply, normal = 4-ply, hard = 6-ply; every level still takes its own
  wins and blocks an immediate loss.
- **Placement sounds** are synthesized with the Web Audio API (a short wooden
  clack, slightly lower for white) — no audio assets. The speaker button in the
  page header mutes them and remembers the choice; a muted game also skips the
  victory chime.
- Click an intersection, or focus the board and use the arrow keys plus Enter.
- **重新开始 / New game** starts over, **悔棋 / Undo** takes back your last move
  and the AI reply. The difficulty switch applies from the AI's next move and
  keeps the current board.
- The win/loss/draw tally is kept per browser in `localStorage`.
- Winning shows the victory layer: falling confetti, three firework bursts, a
  rotating golden halo, the trophy card with move/time stats, and **Play again**.
  It dismisses itself after a few seconds, on **Escape**, or on its own buttons.
  Reduced-motion preferences turn the animation off.

All UI copy is routed through the Client locale service (English and Chinese
dictionaries); every non-artwork colour is a `--dsw-alias-*` theme token, so the
page follows light/dark themes. The board wood, stones, trophy and confetti
palette are artwork colours.

## Implementation

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus the `dsh.client` web declaration. |
| `cordis.patch.yml` | Inserts one Host entry (`minigames-box`). |
| `index.js` | Host half; no Host behaviour, the Client module owns the rendering. |
| `src/engine.js` | Pure Gomoku engine: board helpers, win detection, heuristic eval, negamax + iterative deepening with tactical checks and a time budget. |
| `src/ui.js` | Client half: tab-type registration, Start capsule, tab title, composer-toolbar launcher, difficulty selector, board UI, AI turn loop, placement/victory audio, record + preference persistence, `shell.overlay` celebration. |
| `client.js` | Generated single-file browser bundle (the loader can only serve one file per package). |
| `build.mjs` | Concatenates `src/engine.js` + `src/ui.js` into `client.js` inside one module-loader factory. |
| `locale/*.json` | Plugin title/description shown by Plugin Manager and Settings (8 locales). |
| `icon.svg` | Bundle artwork: a Gomoku board with the winning stone ringed in gold. |

Registration path (public extension seats only):

```js
ctx.sidebarRightTabs.register({ id: 'dsh-minigames', kind: 'minigames', title, guide })
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-minigames' }, GameBoxBody)
ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-minigames' }, GameBoxTitle)
ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-minigames-launcher' }, Launcher)
ctx.slots.register({ name: 'shell.overlay', id: 'dsh-minigames-celebration' }, CelebrationLayer)
```

## Tested

- DSH `0.2.2-rc.1`, macOS, Web client (`dsh web`).
- Engine tests: 156 assertions; UI smoke test: registration + server-rendered
  page + celebration + win/lose/draw/undo state machine.

## Privacy

The plugin makes no network requests and sends nothing anywhere. It stores only
these browser-local preferences in `localStorage`:

- `dsh.minigames.record.v1` – win/loss/draw tally
- `dsh.minigames.difficulty.v1` – selected difficulty
- `dsh.minigames.sound.v1` – sound on/off

## License

MIT © 2026 Poboy. See [LICENSE](LICENSE).

## Development

```bash
node build.mjs                    # rebuild client.js
node build.mjs --test             # bundle with internals exposed, for smoke/ui.smoke.mjs
node test/engine.test.mjs         # engine unit + self-play tests
node smoke/ui.smoke.mjs           # registration + SSR render + game transitions
```

`smoke/ui.smoke.mjs` needs React in a scratch directory (it is a browser
dependency of DSH, not of this package):

```bash
npm install --prefix /tmp/dsh-minigames-testdeps react@18.3.1 react-dom@18.3.1
```
