# The Productivity Matrix

A messy, handmade 2×2 board for sorting your day, after Casey Neistat's productivity matrix.
Construction paper, marker and tape on a beat-up desk. It's an installable web app (PWA)
that works offline and keeps everything on your device.

|               | Unproductive                      | Productive                         |
| ------------- | --------------------------------- | ---------------------------------- |
| Want to do    | Red: the sirens, add a tally when you give in | Green: the work, lock the door and make it |
| Don't want to | Yellow: procrastination maxing, be honest about why | Blue: the storm, batch it in a storm hour |

## Run it

No build step and no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173.

## Put it on your phone

A service worker (offline mode, home-screen install) needs HTTPS, so host the folder on any
static host (Vercel, Netlify, GitHub Pages). Open the URL on your phone, then:

- iPhone: Safari, Share, Add to Home Screen
- Android: Chrome, menu, Install app

## Files

- `index.html`: the board
- `styles.css`: paper, tape and marker
- `app.js`: dragging, the quadrant behaviours, saving
- `sw.js`: offline support
- `manifest.webmanifest` and `icons/`: install info
- `tools/make_icons.py`: redraws the icons (`python3 tools/make_icons.py`)

## Your data

Everything is saved in the browser's local storage on that device. Nothing is sent anywhere,
there's no sync between devices, and clearing the site's data clears the board.
