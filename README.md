# Happy Sort

A colour-sorting puzzle in the style of "Magic Sort" / water-sort games.

Tap a bottle to pick it up, then tap another to pour. You can pour onto the
same colour or into an empty bottle. Sort every colour into its own bottle to
win.

## Features

- Bottles hold 4 layers. Every matching layer on top pours at once, as many as fit.
- Generated levels get harder as you go (3 colours at first, up to 12), and a
  built-in solver checks that every level can be solved.
- Mystery `?` layers from level 6 onward. They show their colour once they reach the top.
- Undo (5 per level), +1 extra bottle per level, restart.
- Coins, and saved progress (in localStorage).
- Plain HTML/CSS/JS, so there is no build step and nothing to install.

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
| `game.js` | Game rules, solver, level generator (exported for Node tests) and the UI |
| `style.css` | Visuals: bottles, liquid layers, toolbar, overlays |
| `index.html` | Page shell |
| `test/logic.test.js` | Rule tests, plus a check that levels 1–60 can all be solved |
