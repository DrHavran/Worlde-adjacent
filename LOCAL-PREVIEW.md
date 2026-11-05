# Wordle Adjacent Games local preview

Two local designs: a flat Modern layout inspired by PS5 and the Original card grid. Based on upstream main at `eee32bc`.
Development version for the `playground` branch.

Start from this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000. Keep the terminal running; Ctrl+C stops the server.

- Use the Design selector to switch between Modern and Original layouts.
- Remember design is enabled by default and restores your selected layout on the next visit. Disable it to use Modern on the next visit. The preference uses localStorage in this browser.
- All designs share completion, streak, and theme data.
- Click a collection to switch libraries.
- Click a smaller tile to select it, then click the selected tile or Play game to launch it in a new tab.
- In Modern, left/right arrows browse games; up/down arrows switch collections.
- Enter or A launches the selected game, B returns to all games, Y toggles completion.
- Press / or click Search games to search the entire library. Type to filter; up/down selects a result, Enter opens it, Escape restores your previous selection.
- Scroll the Modern cover row on mobile. A keyboard-controls guide and the selected game’s streak are visible below the library.
- Completion and theme preferences are saved in this browser. The latest upstream's daily streak rules are preserved.

No build step or dependencies are required. Remote cover images and the optional font need internet access; local tile artwork remains available without them.
