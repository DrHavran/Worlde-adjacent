# Worlde 360 local preview

Xbox 360 NXE-inspired dashboard, based on upstream main at `eee32bc`.
This version is on the local branch `local/xbox360-dashboard`.

Start from this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000. Keep the terminal running; Ctrl+C stops the server.

- Click a collection to switch libraries.
- Click a smaller tile to select it, then click the selected tile or Play game to launch it in a new tab.
- Left/right arrows browse games; up/down arrows switch collections.
- A launches the selected game, B returns to all games, Y toggles completion.
- Swipe left/right on the tiles on mobile.
- Completion and theme preferences are saved in this browser. The latest upstream's daily streak rules are preserved.

No build step or dependencies are required. Remote cover images and the optional font need internet access; local tile artwork remains available without them.
