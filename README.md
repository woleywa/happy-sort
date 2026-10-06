# Happy Sort

A colour-sorting puzzle in the style of "Magic Sort" / water-sort games.

Tap a bottle to pick it up, then tap another to pour. You can pour onto the
same colour or into an empty bottle. Sort every colour into its own bottle to
win.

## Features

- Bottles hold 4 layers. Every matching layer on top pours at once, as many as fit.
- Canvas renderer with real liquid physics: the liquid stays level in a tilted bottle, the bottle tips
  further as it empties, a stream pours into the target and splashes, and the liquid wobbles.
- Several pours can run at once, including two bottles filling the same one from both sides. A pour
  that depends on another one waits for it, then starts by itself.
- Finished bottles get a cork and sparkles. Winning brings confetti and a coin count-up.
- Sounds are modelled in Web Audio rather than beeped: glass clinks, water bubbles that rise in pitch
  as the bottle fills, a cork, bell chimes, and a small room reverb. Haptics are single soft taps, and
  only on select, pour, finished bottle and win. They use Capacitor in the native apps,
  `navigator.vibrate` on Android and the `<input switch>` trick on iPhone Safari 18+.
- Generated levels get harder as you go (3 colours at first, up to 12), and a built-in solver checks
  that every level can be solved.
- Mystery `?` layers from level 6 onward. They flash into their colour once they reach the top.
- Undo (5 per level), shuffle (keeps the board solvable), +1 extra bottle per level, restart.
- Settings for sound and vibration. Coins and progress are saved on the device (localStorage).
- Plain HTML/CSS/JS, so there is no build step. Live at https://woleywa.github.io/happy-sort/.

## Run

Open `index.html` in a browser, or serve the folder:

```sh
npx serve .        # or: python3 -m http.server
```

## Test

```sh
node test/logic.test.js
```

## Structure

| File | Purpose |
| --- | --- |
| `js/logic.js` | Rules, solver, level generator, shuffle (no DOM; also loaded by the Node tests) |
| `js/render.js` | Bottle geometry, level-liquid physics, canvas drawing |
| `js/fx.js` | Sound and haptics |
| `js/game.js` | Game screen: state, input, pour animation, particles, toolbar, settings |
| `index.html`, `style.css` | Page shell, UI chrome |
| `tools/build-web.js` | Copies the game into `www/`, which GitHub Pages serves |
| `test/logic.test.js` | Rule tests, a check that levels 1–60 can all be solved, shuffle tests |

When you change a file, bump the `?v=N` on the script and style tags in `index.html` so phones pick up the new version.
