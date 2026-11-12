# Airform

**Make thin air tangible.** A polished, open-source hand tracking website with a live air-drawing studio in the browser.

Powered by Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker). All camera frames are processed locally — no uploads, no accounts, no cloud service.

## Start it

1. Double-click **`start.bat`** (Windows).
2. Your browser opens at `http://localhost:8000`.
3. Click **Enable camera**, allow camera access, then pinch your thumb and index finger together to draw.

> The included PowerShell server has no dependencies. If PowerShell blocks scripts, run:
>
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
> ```
>
> Use another port with `.\server.ps1 -Port 8080`.

You can also serve the folder with any static server, for example `python -m http.server 8000` or `npx serve`, but camera access requires **localhost or HTTPS**.

## Features

- Real-time 21-point hand tracking for up to two hands at once
- On-device inference using MediaPipe Tasks Vision (GPU with CPU fallback)
- Pinch-to-draw neon line art over the live camera
- Smooth strokes, three inks, three brush sizes, undo, clear, mirror, and point overlays
- Gesture readout for pinch, open palm, point, peace, and fist
- High-resolution PNG poster export (artwork only — never the camera feed)
- Responsive landing page with a full studio UI
- Self-hosted fonts, model, WASM, and icon graphics — no runtime CDN calls

## Privacy

The camera feed is rendered in a `<video>` element and passed directly to MediaPipe's WebAssembly/WebGL graph inside the page. No frames, landmarks, or drawings are sent over the network. The only network requests this site makes are for its own local static files. PNG export is generated from a canvas containing only the drawing.

## Stack

- Vanilla HTML, CSS, and modern JavaScript — no build step
- [`@mediapipe/tasks-vision` 0.10.21](https://www.npmjs.com/package/@mediapipe/tasks-vision) (Apache-2.0)
- [Hand Landmarker float16 model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) (Apache-2.0)
- Instrument Serif, Manrope, and IBM Plex Mono (SIL Open Font License)
- Selected hand icons adapted from Lucide (ISC)

## Files

```
index.html                  Markup and page content
css/styles.css              Full visual system and responsive layout
js/app.js                   MediaPipe setup, gesture logic, canvas, export
models/hand_landmarker.task Local vision model (7.8 MB)
vendor/tasks-vision/        Local Tasks Vision bundle + WASM runtime
vendor/                      Third-party licenses
server.ps1                  Zero-dependency local static server
start.bat                   Windows one-click launcher
```

## Gesture logic

The site does not use a trained gesture classifier, which keeps it small and predictable. It derives gestures geometrically from the 21 landmarks:

- **Pinch** — normalised thumb-tip/index-tip distance below a threshold, with hysteresis for stable pen-down/pen-up
- **Open palm** — all four fingers extended
- **Point** — index extended, other three curled
- **Peace** — index + middle extended, ring + pinky curled
- **Fist** — no non-thumb fingers extended

Handedness and a confidence score come directly from the model. The FPS and pinch proximity readouts are live.

## Notes

- Chrome, Edge, Firefox, and Safari are supported. Safari 16.4+ is recommended.
- The GPU delegate falls back to CPU automatically.
- Camera access requires `localhost` or HTTPS; opening `index.html` as a file will not work.
- Good light and a plain background improve tracking.
- The first load reads about 17 MB from disk (model + WASM) but does not go out to the internet.
- `THIRD_PARTY_NOTICES.md` lists licenses and attribution.

## License

Original site code is released under the [MIT License](LICENSE). Third-party components retain their respective licenses.
