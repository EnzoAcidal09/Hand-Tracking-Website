# Third-party notices

Airform includes the following open-source components. Their licenses are included in the `vendor/` folder.

## MediaPipe Tasks Vision & Hand Landmarker

- Upstream: https://github.com/google-ai-edge/mediapipe
- Package: `@mediapipe/tasks-vision` v0.10.21
- Model: MediaPipe Hand Landmarker, float16, v1
- Copyright: The TensorFlow Authors
- License: Apache License 2.0
- Local paths:
  - `vendor/tasks-vision/vision_bundle.mjs`
  - `vendor/tasks-vision/wasm/vision_wasm_internal.js`
  - `vendor/tasks-vision/wasm/vision_wasm_internal.wasm`
  - `models/hand_landmarker.task`
  - `vendor/LICENSE-mediapipe.txt`

The model and runtime are unmodified. Airform uses the public Hand Landmarker API to detect 21 hand landmarks per hand in video frames.

## Lucide icons

- Upstream: https://github.com/lucide-icons/lucide
- Version referenced: lucide-static v1.71.0
- Copyright: Lucide Contributors
- License: ISC
- Local license: `vendor/LICENSE-lucide.txt`

Hand icons for open palm, point, and fist in `index.html` are adapted from Lucide's `hand`, `pointer`, and `hand-fist` SVG icons. All other icons in the site are original line drawings.

## Typefaces

- **Instrument Serif** — Copyright 2022 The Instrument Serif Project Authors. SIL Open Font License 1.1. `vendor/LICENSE-instrument-serif.txt`.
- **Manrope** — Copyright 2018 The Manrope Project Authors. SIL Open Font License 1.1. `vendor/LICENSE-manrope.txt`.
- **IBM Plex Mono** — Copyright 2017 IBM Corp. SIL Open Font License 1.1. `vendor/LICENSE-ibm-plex-mono.txt`.

The WOFF2 font files are subset from Google Fonts and are self-hosted in `assets/fonts/`.

## Site code

Original Airform HTML, CSS, JavaScript, and design: MIT License. See `LICENSE`.

## Trademarks

MediaPipe is a trademark of Google LLC. Lucide is a project of the Lucide Contributors. This project is not affiliated with or endorsed by Google or the Lucide project.
