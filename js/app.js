/* ============================================================
   AIRFORM — browser-native hand tracking studio
   MediaPipe Hand Landmarker · running entirely on-device
   ============================================================ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (from, to, amount) => from + (to - from) * amount;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const FINGERS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20]
};

const GESTURES = {
  waiting: {
    label: "Waiting",
    description: "Raise a hand into the camera frame to begin.",
    active: null
  },
  pinch: {
    label: "Pinch",
    description: "Pen down. Move slowly to leave a clean line.",
    active: "pinch"
  },
  open: {
    label: "Open palm",
    description: "All five fingers up. The pen is lifted.",
    active: "open"
  },
  point: {
    label: "Point",
    description: "Index only. A reticle follows your fingertip.",
    active: "point"
  },
  peace: {
    label: "Peace",
    description: "Two fingers up. The pen stays lifted.",
    active: "peace"
  },
  fist: {
    label: "Fist",
    description: "Closed hand detected. The stroke is paused.",
    active: "fist"
  },
  tracking: {
    label: "Tracking",
    description: "Hand acquired. Pinch thumb and index to draw.",
    active: null
  }
};

const dom = {
  stage: $("#stage"),
  video: $("#webcam"),
  canvas: $("#overlayCanvas"),
  cameraPlaceholder: $("#cameraPlaceholder"),
  placeholderTitle: $("#placeholderTitle"),
  placeholderText: $("#placeholderText"),
  startCameraBtn: $("#startCameraBtn"),
  startButtonLabel: $("#startButtonLabel"),
  engineStatus: $("#engineStatus"),
  engineStatusText: $("#engineStatusText"),
  engineState: $("#engineState"),
  engineStateText: $("#engineStateText"),
  engineDot: $("#engineDot"),
  cameraLoading: $("#cameraLoading"),
  cameraLoadingText: $("#cameraLoadingText"),
  errorCard: $("#errorCard"),
  errorTitle: $("#errorTitle"),
  errorText: $("#errorText"),
  retryCameraBtn: $("#retryCameraBtn"),
  dismissErrorBtn: $("#dismissErrorBtn"),
  cameraStatus: $("#cameraStatus"),
  liveLabel: $("#liveLabel"),
  fpsValue: $("#fpsValue"),
  stopCameraBtn: $("#stopCameraBtn"),
  stageHint: $("#stageHint"),
  colorSwatches: $$(".color-swatch"),
  brushButtons: $$(".brush-button"),
  undoBtn: $("#undoBtn"),
  clearBtn: $("#clearBtn"),
  downloadBtn: $("#downloadBtn"),
  mirrorBtn: $("#mirrorBtn"),
  skeletonBtn: $("#skeletonBtn"),
  handCount: $("#handCount"),
  handCountLabel: $("#handCountLabel"),
  handCountBlock: $(".hand-count-block"),
  gestureName: $("#gestureName"),
  gestureDesc: $("#gestureDesc"),
  confidenceValue: $("#confidenceValue"),
  confidenceBar: $("#confidenceBar"),
  pinchValue: $("#pinchValue"),
  pinchBar: $("#pinchBar"),
  landmarkCount: $("#landmarkCount"),
  sidebarSignal: $("#sidebarSignal"),
  legendItems: $$(".legend-item"),
  toast: $("#toast"),
  year: $("#year")
};

const state = {
  landmarker: null,
  modelReady: false,
  modelLoading: false,
  modelFailed: false,
  delegate: null,
  pendingStart: false,

  cameraOn: false,
  starting: false,
  stream: null,
  rafId: 0,
  lastVideoTime: -1,
  detectErrorShown: false,

  hands: [],
  rawHands: [],
  strokes: [],
  activeStrokes: new Map(),
  smoothPoints: new Map(),
  clearedSnapshot: null,

  selectedInk: "#d9ff57",
  brushSize: 6,
  mirror: true,
  showSkeleton: true,

  context: null,
  size: { width: 1, height: 1, dpr: 1 },
  resizeObserver: null,

  fpsWindowStart: 0,
  fpsFrames: 0,
  fps: 0,
  toastTimer: 0,
  lastUIUpdate: 0
};

const uiCache = {
  handCount: -1,
  confidence: -1,
  pinch: -1,
  landmarks: -1,
  gestureKey: null,
  fps: -1,
  cameraOn: null,
  toolState: null
};

/* ============================================================
   Boot
   ============================================================ */

init();

function init() {
  dom.year.textContent = new Date().getFullYear();
  cacheDomState();
  bindEvents();
  setupCanvas();
  initializeEngine();
}

function cacheDomState() {
  state.mirror = !dom.video.classList.contains("mirrored") ? false : true;
  const activeColor = $(".color-swatch.is-active");
  if (activeColor) state.selectedInk = activeColor.dataset.color || state.selectedInk;
  const activeBrush = $(".brush-button.is-active");
  if (activeBrush) state.brushSize = Number(activeBrush.dataset.size) || state.brushSize;
  updateToolState();
}

/* ============================================================
   Vision engine
   ============================================================ */

async function initializeEngine() {
  if (state.modelLoading || state.modelReady) return;

  state.modelLoading = true;
  state.modelFailed = false;
  setEngineStatus("loading", "Loading vision engine", "Warming up the vision model…");

  try {
    if (window.location.protocol === "file:") {
      throw new Error(
        "Browsers block local AI files when a page is opened directly. Run the included start.bat or server.ps1 and open http://localhost:8000."
      );
    }

    const vision = await import("../vendor/tasks-vision/vision_bundle.mjs");

    const modelBuffer = await fetchModel((percent) => {
      setEngineStatus(
        "loading",
        `Loading model ${percent}%`,
        `Downloading local model · ${percent}%`
      );
    });

    setEngineStatus("loading", "Starting vision engine", "Spinning up on-device inference…");

    const wasmRoot = new URL("../vendor/tasks-vision/wasm/", import.meta.url).href;

    const visionFiles = await vision.FilesetResolver.forVisionTasks(wasmRoot);

    const createLandmarker = (delegate) =>
      vision.HandLandmarker.createFromOptions(visionFiles, {
        baseOptions: {
          modelAssetBuffer: modelBuffer,
          delegate
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.56,
        minHandPresenceConfidence: 0.52,
        minTrackingConfidence: 0.55
      });

    let landmarker;
    try {
      landmarker = await createLandmarker("GPU");
      state.delegate = "GPU";
    } catch (gpuError) {
      console.warn("Airform: GPU delegate unavailable, trying CPU.", gpuError);
      landmarker = await createLandmarker("CPU");
      state.delegate = "CPU";
    }

    state.landmarker = landmarker;
    state.modelReady = true;
    state.modelFailed = false;
    state.modelLoading = false;

    setEngineStatus(
      "ready",
      `Vision engine ready · ${state.delegate}`,
      `${state.delegate} engine ready`
    );

    console.info(`Airform: HandLandmarker ready using ${state.delegate}.`);

    if (state.pendingStart) {
      state.pendingStart = false;
      dom.startButtonLabel.textContent = "Enable camera";
      startCamera();
    }
  } catch (error) {
    console.error("Airform: vision engine failed to initialise.", error);
    state.modelFailed = true;
    state.modelLoading = false;
    setEngineStatus("error", "Vision engine unavailable", "Engine unavailable");
    dom.startButtonLabel.textContent = "Retry setup";
    showToast("The vision engine could not load. Click “Retry setup”.");
  }
}

async function fetchModel(onProgress) {
  const modelUrl = new URL("../models/hand_landmarker.task", import.meta.url);
  const response = await fetch(modelUrl, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`Could not fetch hand_landmarker.task (${response.status}).`);
  }

  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body) {
    onProgress(85);
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastPercent = -1;
  let lastUpdate = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.length;

    if (total) {
      const percent = clamp(Math.round((received / total) * 88), 1, 88);
      const now = performance.now();
      if (percent !== lastPercent && now - lastUpdate > 120) {
        lastPercent = percent;
        lastUpdate = now;
        onProgress(percent);
      }
    }
  }

  onProgress(90);
  const blob = new Blob(chunks);
  return new Uint8Array(await blob.arrayBuffer());
}

function setEngineStatus(mode, chromeText, placeholderText) {
  dom.engineState.classList.remove("is-ready", "is-error");
  dom.engineStatus.classList.remove("is-ready", "is-error");

  if (mode === "ready") {
    dom.engineState.classList.add("is-ready");
    dom.engineStatus.classList.add("is-ready");
  }
  if (mode === "error") {
    dom.engineState.classList.add("is-error");
    dom.engineStatus.classList.add("is-error");
  }

  if (chromeText) dom.engineStateText.textContent = chromeText;
  if (placeholderText) dom.engineStatusText.textContent = placeholderText;
}

/* ============================================================
   Camera lifecycle
   ============================================================ */

async function handleStartClick() {
  if (state.cameraOn || state.starting) return;

  if (!state.modelReady) {
    state.pendingStart = true;
    dom.startButtonLabel.textContent = state.modelFailed ? "Retrying…" : "Warming up…";

    if (state.modelFailed && !state.modelLoading) {
      initializeEngine();
    } else {
      showToast("The engine is still warming up. The camera will open when it's ready.");
    }
    return;
  }

  startCamera();
}

async function startCamera() {
  if (state.cameraOn || state.starting) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showError(
      "Camera not supported",
      "This browser cannot access a camera. Try a recent version of Chrome, Edge, Firefox, or Safari on localhost or HTTPS."
    );
    return;
  }

  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    showError(
      "Secure connection required",
      "Browsers only share cameras over HTTPS or localhost. Run the included start.bat and open http://localhost:8000."
    );
    return;
  }

  hideError();
  state.starting = true;
  dom.stage.classList.add("is-loading");
  dom.stage.classList.remove("has-error");
  dom.cameraLoading.hidden = false;
  dom.cameraLoadingText.textContent = "Opening your camera…";
  dom.startCameraBtn.disabled = true;
  dom.startCameraBtn.setAttribute("aria-busy", "true");

  try {
    let stream;
    const preferredConstraints = {
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 }
      }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
    } catch (error) {
      if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } else {
        throw error;
      }
    }

    state.stream = stream;
    dom.video.srcObject = stream;
    dom.cameraLoadingText.textContent = "Finding your hand…";

    await waitForVideo(dom.video);
    await dom.video.play();

    const track = stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener("ended", handleTrackEnded, { once: true });
    }

    state.cameraOn = true;
    state.starting = false;
    state.lastVideoTime = -1;
    state.fpsWindowStart = 0;
    state.fpsFrames = 0;
    state.fps = 0;
    state.detectErrorShown = false;

    dom.video.classList.toggle("mirrored", state.mirror);
    dom.stage.classList.add("is-on");
    dom.stage.classList.remove("is-loading", "has-error");
    dom.cameraLoading.hidden = true;
    dom.startCameraBtn.disabled = false;
    dom.startCameraBtn.removeAttribute("aria-busy");

    setCameraUI(true);
    resetGestureReadout();
    updateToolState();
    showToast("Camera live. Pinch thumb + index together to draw.");
    startRenderLoop();
  } catch (error) {
    state.starting = false;
    dom.cameraLoading.hidden = true;
    dom.stage.classList.remove("is-loading");
    dom.startCameraBtn.disabled = false;
    dom.startCameraBtn.removeAttribute("aria-busy");
    dom.startButtonLabel.textContent = "Enable camera";
    handleCameraError(error);
  }
}

function waitForVideo(video) {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The camera didn't start in time. Another app may be using it."));
    }, 12000);

    const onReady = () => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("loadedmetadata", onReady);
    };

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("loadedmetadata", onReady);
  });
}

function stopCamera(options = {}) {
  const { silent = false } = options;

  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => {
      track.removeEventListener("ended", handleTrackEnded);
      track.stop();
    });
    state.stream = null;
  }

  if (dom.video.srcObject) {
    dom.video.srcObject = null;
  }

  state.cameraOn = false;
  state.starting = false;
  state.lastVideoTime = -1;
  state.hands = [];
  state.rawHands = [];
  state.activeStrokes.clear();
  state.smoothPoints.clear();
  state.fps = 0;

  dom.stage.classList.remove("is-on", "is-loading", "has-error");
  dom.cameraLoading.hidden = true;
  dom.cameraStatus.classList.remove("is-live");
  dom.liveLabel.textContent = "Standby";
  dom.stopCameraBtn.hidden = true;
  dom.stageHint.hidden = true;
  dom.fpsValue.textContent = "--";
  dom.startCameraBtn.disabled = false;
  dom.startButtonLabel.textContent = "Resume camera";

  dom.placeholderTitle.textContent = "Camera paused.";
  dom.placeholderText.textContent =
    "Your drawing is still here. Re-enable the camera when you want to make another mark.";

  setCameraUI(false);
  resetGestureReadout();
  drawOverlay();

  if (!silent) showToast("Camera paused. Your drawing is safe.");
}

function handleTrackEnded() {
  if (!state.cameraOn) return;
  const hadCamera = state.cameraOn;
  stopCamera({ silent: true });
  if (hadCamera) {
    showError(
      "Camera disconnected",
      "The camera stream ended. Check the connection, then try again."
    );
  }
}

function handleCameraError(error) {
  const name = error?.name || "";
  let title = "Camera unavailable";
  let message = "We couldn't reach a camera. Check your browser permissions and try again.";

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    title = "Camera permission blocked";
    message =
      "Allow camera access from the icon beside your browser's address bar, then try again. Some browsers also require a page reload after denying access.";
  } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    title = "No camera found";
    message =
      "Connect a webcam and check that it is enabled in your system settings, then try again.";
  } else if (name === "NotReadableError" || name === "TrackStartError") {
    title = "Camera is busy";
    message =
      "Another app may be using your camera. Close video-call or camera apps and try once more.";
  } else if (error?.message?.includes("didn't start in time")) {
    title = "Camera took too long";
    message = "The stream did not arrive in time. Unplug and reconnect the camera, then try again.";
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    dom.video.srcObject = null;
  }

  dom.video.classList.remove("mirrored");
  state.cameraOn = false;
  state.hands = [];
  state.rawHands = [];
  state.activeStrokes.clear();
  state.smoothPoints.clear();

  showError(title, message);
}

function showError(title, message) {
  dom.cameraLoading.hidden = true;
  dom.stage.classList.remove("is-loading", "is-on");
  dom.stage.classList.add("has-error");
  dom.errorTitle.textContent = title;
  dom.errorText.textContent = message;
  dom.errorCard.hidden = false;
  dom.retryCameraBtn.textContent = state.modelFailed ? "Retry setup" : "Try again";
  dom.stopCameraBtn.hidden = true;
  dom.stageHint.hidden = true;
  dom.cameraStatus.classList.remove("is-live");
  dom.liveLabel.textContent = "Standby";
  dom.startCameraBtn.disabled = false;
  setCameraUI(false);
  resetGestureReadout();
  drawOverlay();
}

function hideError() {
  dom.errorCard.hidden = true;
  dom.stage.classList.remove("has-error");
}

async function handleRetry() {
  hideError();

  if (!state.modelReady) {
    state.pendingStart = true;
    if (!state.modelLoading) {
      await initializeEngine();
    }
    return;
  }

  startCamera();
}

function dismissError() {
  hideError();
  dom.placeholderTitle.textContent = "Your hand is the brush.";
  dom.placeholderText.textContent =
    "Enable your camera to step into the studio. Frames are processed right here in your browser.";
  dom.startButtonLabel.textContent = "Enable camera";
}

function setCameraUI(isLive) {
  if (uiCache.cameraOn === isLive) {
    if (isLive) {
      dom.fpsReadout.hidden = false;
      dom.stopCameraBtn.hidden = false;
      dom.stageHint.hidden = false;
      dom.cameraStatus.classList.add("is-live");
      dom.liveLabel.textContent = "Live";
      dom.sidebarSignal.classList.add("is-live");
      dom.sidebarSignal.innerHTML = "<i></i> Tracking";
    }
    return;
  }

  uiCache.cameraOn = isLive;
  dom.cameraStatus.classList.toggle("is-live", isLive);
  dom.liveLabel.textContent = isLive ? "Live" : "Standby";
  dom.stopCameraBtn.hidden = !isLive;
  dom.stageHint.hidden = !isLive;
  dom.sidebarSignal.classList.toggle("is-live", isLive);
  dom.sidebarSignal.innerHTML = isLive ? "<i></i> Tracking" : "<i></i> Idle";

  if (!isLive) {
    state.fps = 0;
    dom.fpsValue.textContent = "--";
    uiCache.fps = -1;
  }
}

/* ============================================================
   Detection loop
   ============================================================ */

function startRenderLoop() {
  if (state.rafId) cancelAnimationFrame(state.rafId);

  const loop = () => {
    if (!state.cameraOn) {
      state.rafId = 0;
      return;
    }

    state.rafId = requestAnimationFrame(loop);

    if (
      dom.video.readyState >= 2 &&
      !dom.video.paused &&
      dom.video.videoWidth > 0 &&
      dom.video.currentTime !== state.lastVideoTime
    ) {
      state.lastVideoTime = dom.video.currentTime;

      try {
        const now = performance.now();
        const results = state.landmarker.detectForVideo(dom.video, now);
        processResults(results, now);
        updateFps(now);
        drawOverlay();
      } catch (error) {
        console.error("Airform: hand detection failed.", error);
        if (!state.detectErrorShown) {
          state.detectErrorShown = true;
          stopCamera({ silent: true });
          showError(
            "Tracking stopped",
            "The vision engine hit a snag. Try starting the camera again. If it keeps happening, reload the page."
          );
        }
        return;
      }
    }
  };

  state.rafId = requestAnimationFrame(loop);
}

function updateFps(now) {
  if (!state.fpsWindowStart) state.fpsWindowStart = now;
  state.fpsFrames++;

  const elapsed = now - state.fpsWindowStart;
  if (elapsed >= 650) {
    state.fps = Math.round((state.fpsFrames * 1000) / elapsed);
    state.fpsFrames = 0;
    state.fpsWindowStart = now;

    if (uiCache.fps !== state.fps) {
      uiCache.fps = state.fps;
      dom.fpsValue.textContent = state.fps;
    }
  }
}

function processResults(result, now) {
  const rawHands = result?.landmarks || [];
  const handednessGroups = result?.handednesses || result?.handedness || [];

  const hands = rawHands
    .map((landmarks, index) => {
      if (!landmarks || landmarks.length < 21) return null;

      const category = handednessGroups[index]?.[0] || {};
      const handLabel = category.categoryName || category.displayName || `Hand ${index + 1}`;
      const key = `${handLabel}-${index}`;
      const analysis = analyzeHand(landmarks);
      const wasDrawing = state.activeStrokes.has(key);
      const pinching =
        !analysis.isFist &&
        analysis.pinchRatio < (wasDrawing ? 0.46 : 0.34);

      return {
        key,
        index,
        landmarks,
        label: handLabel,
        confidence: typeof category.score === "number" ? category.score : 0.9,
        analysis,
        pinching
      };
    })
    .filter(Boolean);

  state.rawHands = rawHands;
  state.hands = hands;

  const presentKeys = new Set(hands.map((hand) => hand.key));

  for (const key of [...state.activeStrokes.keys()]) {
    if (!presentKeys.has(key)) {
      state.activeStrokes.delete(key);
    }
  }
  for (const key of [...state.smoothPoints.keys()]) {
    if (!presentKeys.has(key)) {
      state.smoothPoints.delete(key);
    }
  }

  for (const hand of hands) {
    const tip = hand.landmarks[8];
    const projected = projectToStage(tip.x, tip.y);
    const key = hand.key;
    const previous = state.smoothPoints.get(key);
    const smoothed = previous
      ? { x: lerp(previous.x, projected.x, 0.56), y: lerp(previous.y, projected.y, 0.56) }
      : { x: projected.x, y: projected.y };
    state.smoothPoints.set(key, smoothed);

    if (hand.pinching) {
      let active = state.activeStrokes.get(key);

      if (!active) {
        const stroke = {
          points: [{ x: smoothed.x, y: smoothed.y }],
          color: state.selectedInk,
          size: state.brushSize,
          label: hand.label
        };
        state.strokes.push(stroke);
        state.clearedSnapshot = null;
        state.activeStrokes.set(key, {
          stroke,
          lastPoint: { ...smoothed },
          lastSample: now
        });
        updateToolState();
      } else {
        const distance = Math.hypot(
          (smoothed.x - active.lastPoint.x) * state.size.width,
          (smoothed.y - active.lastPoint.y) * state.size.height
        );

        if (distance > 1.15 || now - active.lastSample > 70) {
          active.stroke.points.push({ x: smoothed.x, y: smoothed.y });
          active.lastPoint = { ...smoothed };
          active.lastSample = now;
        }
      }
    } else {
      state.activeStrokes.delete(key);
    }
  }

  updateTelemetry(hands);
}

/* ============================================================
   Gesture geometry
   ============================================================ */

function analyzeHand(landmarks) {
  const aspect =
    dom.video.videoWidth && dom.video.videoHeight
      ? dom.video.videoWidth / dom.video.videoHeight
      : 16 / 9;

  const point = (index) => {
    const landmark = landmarks[index];
    return { x: landmark.x * aspect, y: landmark.y, z: landmark.z || 0 };
  };

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angle = (a, b, c) => {
    const abx = a.x - b.x;
    const aby = a.y - b.y;
    const cbx = c.x - b.x;
    const cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const magnitude = Math.hypot(abx, aby) * Math.hypot(cbx, cby) || 1;
    return (Math.acos(clamp(dot / magnitude, -1, 1)) * 180) / Math.PI;
  };

  const isExtended = (joints) => {
    const [mcp, pip, , tip] = joints;
    const straight = angle(point(mcp), point(pip), point(tip)) > 149;
    const reach =
      distance(point(tip), point(0)) > distance(point(pip), point(0)) * 1.075;
    return straight && reach;
  };

  const fingers = {
    thumb:
      angle(point(2), point(3), point(4)) > 140 &&
      distance(point(4), point(0)) > distance(point(3), point(0)) * 1.04,
    index: isExtended(FINGERS.index),
    middle: isExtended(FINGERS.middle),
    ring: isExtended(FINGERS.ring),
    pinky: isExtended(FINGERS.pinky)
  };

  const extendedCount = [fingers.index, fingers.middle, fingers.ring, fingers.pinky].filter(Boolean).length;
  const handScale = Math.max(distance(point(0), point(9)), 0.0001);
  const pinchRatio = distance(point(4), point(8)) / handScale;
  const isFist = extendedCount === 0;

  let key = "tracking";
  if (isFist) {
    key = "fist";
  } else if (pinchRatio < 0.33) {
    key = "pinch";
  } else if (extendedCount === 4) {
    key = "open";
  } else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    key = "point";
  } else if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
    key = "peace";
  }

  const pinchStrength = Math.round(clamp(1 - pinchRatio / 0.82, 0, 1) * 100);

  return {
    fingers,
    extendedCount,
    pinchRatio,
    pinchStrength,
    isFist,
    key
  };
}

/* ============================================================
   Telemetry UI
   ============================================================ */

function updateTelemetry(hands) {
  const now = performance.now();

  // The sidebar runs at a calm 10 fps even though rendering hits 30+.
  if (now - state.lastUIUpdate < 90 && hands.length > 0) return;
  state.lastUIUpdate = now;

  const primary = hands.find((hand) => hand.pinching) || hands[0] || null;
  const gestureKey = primary ? primary.analysis.key : "waiting";
  const gesture = GESTURES[gestureKey] || GESTURES.tracking;
  const handCount = hands.length;
  const landmarks = handCount * 21;
  const confidence = primary ? Math.round(primary.confidence * 100) : 0;
  const pinch = primary ? primary.analysis.pinchStrength : 0;

  if (uiCache.handCount !== handCount) {
    uiCache.handCount = handCount;
    dom.handCount.textContent = handCount;
    dom.handCountLabel.textContent =
      handCount === 0 ? "No hands" : handCount === 1 ? "One hand" : "Two hands";
    dom.handCountBlock.classList.toggle("has-hands", handCount > 0);
  }

  if (uiCache.landmarks !== landmarks) {
    uiCache.landmarks = landmarks;
    dom.landmarkCount.textContent = landmarks;
  }

  if (uiCache.confidence !== confidence) {
    uiCache.confidence = confidence;
    dom.confidenceValue.textContent = primary ? `${confidence}%` : "--";
    dom.confidenceBar.style.width = `${primary ? confidence : 0}%`;
  }

  if (uiCache.pinch !== pinch) {
    uiCache.pinch = pinch;
    dom.pinchValue.textContent = primary ? `${pinch}%` : "--";
    dom.pinchBar.style.width = `${primary ? pinch : 0}%`;
  }

  if (uiCache.gestureKey !== gestureKey) {
    uiCache.gestureKey = gestureKey;
    dom.gestureName.textContent = gesture.label;
    dom.gestureDesc.textContent = gesture.description;
    dom.gestureName.classList.toggle("is-active", Boolean(gesture.active));
    dom.legendItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.gestureKey === gesture.active);
    });
  }
}

function resetGestureReadout() {
  uiCache.handCount = -1;
  uiCache.landmarks = -1;
  uiCache.confidence = -1;
  uiCache.pinch = -1;
  uiCache.gestureKey = null;

  dom.handCount.textContent = "0";
  dom.handCountLabel.textContent = "No hands";
  dom.handCountBlock.classList.remove("has-hands");
  dom.landmarkCount.textContent = "0";
  dom.confidenceValue.textContent = "--";
  dom.confidenceBar.style.width = "0%";
  dom.pinchValue.textContent = "--";
  dom.pinchBar.style.width = "0%";
  dom.gestureName.textContent = "Waiting";
  dom.gestureName.classList.remove("is-active");
  dom.gestureDesc.textContent = GESTURES.waiting.description;
  dom.legendItems.forEach((item) => item.classList.remove("is-active"));
}

/* ============================================================
   Canvas rendering
   ============================================================ */

function setupCanvas() {
  state.context = dom.canvas.getContext("2d");
  resizeCanvas();

  if ("ResizeObserver" in window) {
    state.resizeObserver = new ResizeObserver(() => resizeCanvas());
    state.resizeObserver.observe(dom.stage);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  window.addEventListener("orientationchange", () => {
    window.setTimeout(resizeCanvas, 250);
  });
}

function resizeCanvas() {
  const rect = dom.stage.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);

  if (
    Math.abs(state.size.width - width) < 0.5 &&
    Math.abs(state.size.height - height) < 0.5 &&
    state.size.dpr === dpr
  ) {
    return;
  }

  state.size = { width, height, dpr };
  dom.canvas.width = Math.round(width * dpr);
  dom.canvas.height = Math.round(height * dpr);

  if (state.context) {
    state.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawOverlay();
}

function projectToStage(x, y) {
  const videoWidth = dom.video.videoWidth || 1280;
  const videoHeight = dom.video.videoHeight || 720;
  const stageWidth = state.size.width;
  const stageHeight = state.size.height;

  const scale = Math.max(stageWidth / videoWidth, stageHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (stageWidth - renderedWidth) / 2;
  const offsetY = (stageHeight - renderedHeight) / 2;
  const normalizedX = state.mirror ? 1 - x : x;

  return {
    x: (offsetX + normalizedX * renderedWidth) / stageWidth,
    y: (offsetY + y * renderedHeight) / stageHeight
  };
}

function drawOverlay() {
  const ctx = state.context;
  if (!ctx) return;

  const width = state.size.width;
  const height = state.size.height;

  ctx.clearRect(0, 0, width, height);

  for (const stroke of state.strokes) {
    drawArtStroke(ctx, stroke, width, height);
  }

  if (!state.cameraOn) return;

  if (state.showSkeleton) {
    for (const hand of state.hands) {
      drawHandSkeleton(ctx, hand);
    }
  }

  for (const hand of state.hands) {
    if (hand.pinching) {
      drawPinchCursor(ctx, hand);
    } else if (hand.analysis.key === "point") {
      drawPointCursor(ctx, hand);
    }
  }
}

function traceStrokePath(ctx, points, scaleX, scaleY) {
  if (!points.length) return false;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x * scaleX, points[0].y * scaleY, 0.9, 0, Math.PI * 2);
    return true;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);

  if (points.length === 2) {
    ctx.lineTo(points[1].x * scaleX, points[1].y * scaleY);
    return true;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = ((current.x + next.x) / 2) * scaleX;
    const midY = ((current.y + next.y) / 2) * scaleY;
    ctx.quadraticCurveTo(current.x * scaleX, current.y * scaleY, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x * scaleX, last.y * scaleY);
  return true;
}

function drawArtStroke(ctx, stroke, width, height, offsetX = 0, offsetY = 0, lineScale = 1) {
  if (!stroke.points.length) return;

  const isDot = stroke.points.length === 1;
  const lineWidth = Math.max(1.2, stroke.size * lineScale);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;

  if (isDot) {
    const x = stroke.points[0].x * width;
    const y = stroke.points[0].y * height;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 2.3, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = lineWidth * 3.6;
  traceStrokePath(ctx, stroke.points, width, height);
  ctx.stroke();
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = lineWidth * 1.6;
  traceStrokePath(ctx, stroke.points, width, height);
  ctx.stroke();
  ctx.restore();

  ctx.globalAlpha = 0.95;
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = stroke.color;
  ctx.shadowBlur = Math.min(12 * lineScale, 24);
  traceStrokePath(ctx, stroke.points, width, height);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(0.6, lineWidth * 0.22);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  traceStrokePath(ctx, stroke.points, width, height);
  ctx.stroke();

  ctx.restore();
}

function drawHandSkeleton(ctx, hand) {
  const width = state.size.width;
  const height = state.size.height;
  const points = hand.landmarks.map((landmark) => {
    const projected = projectToStage(landmark.x, landmark.y);
    return { x: projected.x * width, y: projected.y * height };
  });

  const palmIndices = [0, 1, 5, 9, 13, 17];
  const palm = palmIndices.map((index) => points[index]);

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(palm[0].x, palm[0].y);
  for (let i = 1; i < palm.length; i += 1) {
    ctx.lineTo(palm[i].x, palm[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(217, 255, 87, 0.025)";
  ctx.fill();

  ctx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    ctx.moveTo(points[start].x, points[start].y);
    ctx.lineTo(points[end].x, points[end].y);
  }
  ctx.strokeStyle = "rgba(9, 11, 7, 0.55)";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    ctx.moveTo(points[start].x, points[start].y);
    ctx.lineTo(points[end].x, points[end].y);
  }
  ctx.strokeStyle = "rgba(247, 244, 236, 0.68)";
  ctx.lineWidth = 1.1;
  ctx.stroke();

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const isTip = [4, 8, 12, 16, 20].includes(index);
    const isWrist = index === 0;

    ctx.beginPath();
    ctx.arc(point.x, point.y, isTip ? 3 : isWrist ? 3.3 : 1.8, 0, Math.PI * 2);
    ctx.fillStyle = isTip ? state.selectedInk : "rgba(247, 244, 236, 0.82)";
    ctx.fill();

    if (isTip) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5.9, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(217, 255, 87, 0.2)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  const wrist = points[0];
  const fontSize = clamp(width / 105, 7.5, 9.5);
  ctx.font = `500 ${fontSize}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(247, 244, 236, 0.5)";
  const label = `${String(hand.label).toUpperCase()} · ${Math.round(hand.confidence * 100)}%`;
  ctx.fillText(label, wrist.x + 9, wrist.y + 14);

  ctx.restore();
}

function drawPinchCursor(ctx, hand) {
  const width = state.size.width;
  const height = state.size.height;
  const thumb = projectToStage(hand.landmarks[4].x, hand.landmarks[4].y);
  const index = projectToStage(hand.landmarks[8].x, hand.landmarks[8].y);
  const thumbPoint = { x: thumb.x * width, y: thumb.y * height };
  const indexPoint = { x: index.x * width, y: index.y * height };
  const center = {
    x: (thumbPoint.x + indexPoint.x) / 2,
    y: (thumbPoint.y + indexPoint.y) / 2
  };
  const time = performance.now() / 1000;

  ctx.save();
  ctx.strokeStyle = state.selectedInk;
  ctx.fillStyle = state.selectedInk;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(thumbPoint.x, thumbPoint.y);
  ctx.lineTo(indexPoint.x, indexPoint.y);
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(center.x, center.y, 9 + Math.sin(time * 3) * 1.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center.x, center.y, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center.x, center.y, 15, time * 0.9, time * 0.9 + Math.PI * 1.1);
  ctx.globalAlpha = 0.42;
  ctx.stroke();
  ctx.restore();
}

function drawPointCursor(ctx, hand) {
  const width = state.size.width;
  const height = state.size.height;
  const index = projectToStage(hand.landmarks[8].x, hand.landmarks[8].y);
  const x = index.x * width;
  const y = index.y * height;
  const time = performance.now() / 1000;

  ctx.save();
  ctx.strokeStyle = state.selectedInk;
  ctx.fillStyle = state.selectedInk;
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.38;
  ctx.beginPath();
  ctx.arc(x, y, 17, time, time + Math.PI * 0.75);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 17, y);
  ctx.lineTo(x - 7, y);
  ctx.moveTo(x + 7, y);
  ctx.lineTo(x + 17, y);
  ctx.moveTo(x, y - 17);
  ctx.lineTo(x, y - 7);
  ctx.stroke();
  ctx.restore();
}

/* ============================================================
   Drawing tools
   ============================================================ */

function selectInk(button) {
  state.selectedInk = button.dataset.color || state.selectedInk;
  dom.colorSwatches.forEach((swatch) => {
    const active = swatch === button;
    swatch.classList.toggle("is-active", active);
    swatch.setAttribute("aria-pressed", String(active));
  });
  const dot = $(".hint-pinch i");
  if (dot) dot.style.background = state.selectedInk;
  drawOverlay();
}

function selectBrush(button) {
  state.brushSize = Number(button.dataset.size) || state.brushSize;
  dom.brushButtons.forEach((brush) => {
    const active = brush === button;
    brush.classList.toggle("is-active", active);
    brush.setAttribute("aria-pressed", String(active));
  });
}

function clearCanvas() {
  if (!state.strokes.length) {
    showToast("There's nothing to clear yet.");
    return;
  }

  state.clearedSnapshot = state.strokes;
  state.strokes = [];
  state.activeStrokes.clear();
  state.smoothPoints.clear();
  updateToolState();
  drawOverlay();
  showToast("Canvas cleared. Press undo to bring it back.");
}

function undo() {
  state.activeStrokes.clear();
  state.smoothPoints.clear();

  if (state.strokes.length) {
    state.strokes.pop();
    state.clearedSnapshot = null;
    showToast("Last stroke removed.");
  } else if (state.clearedSnapshot?.length) {
    state.strokes = state.clearedSnapshot;
    state.clearedSnapshot = null;
    showToast("Canvas restored.");
  } else {
    return;
  }

  updateToolState();
  drawOverlay();
}

function updateToolState() {
  const hasStrokes = state.strokes.length > 0;
  const canUndo = hasStrokes || Boolean(state.clearedSnapshot?.length);
  const signature = `${hasStrokes}-${canUndo}`;

  if (uiCache.toolState === signature) return;
  uiCache.toolState = signature;

  dom.undoBtn.disabled = !canUndo;
  dom.clearBtn.disabled = !hasStrokes;
  dom.downloadBtn.disabled = !hasStrokes;
}

async function downloadArtwork() {
  if (!state.strokes.length) {
    showToast("Make a mark before you save.");
    return;
  }

  try {
    await document.fonts?.ready;

    const stageRatio = state.size.height / state.size.width || 0.625;
    const outputWidth = 1800;
    const margin = Math.round(outputWidth * 0.05);
    const headerHeight = Math.round(outputWidth * 0.056);
    const footerHeight = Math.round(outputWidth * 0.061);
    const innerWidth = outputWidth - margin * 2;
    const innerHeight = Math.round(innerWidth * stageRatio);
    const outputHeight = headerHeight + innerHeight + footerHeight;

    const output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = outputHeight;
    const ctx = output.getContext("2d");

    const background = ctx.createLinearGradient(0, 0, outputWidth, outputHeight);
    background.addColorStop(0, "#171a12");
    background.addColorStop(0.62, "#0c0e0a");
    background.addColorStop(1, "#12140e");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    const glow = ctx.createRadialGradient(
      outputWidth * 0.64,
      outputHeight * 0.35,
      0,
      outputWidth * 0.64,
      outputHeight * 0.35,
      outputWidth * 0.55
    );
    glow.addColorStop(0, "rgba(217, 255, 87, 0.055)");
    glow.addColorStop(1, "rgba(217, 255, 87, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    ctx.strokeStyle = "rgba(241, 238, 231, 0.055)";
    ctx.lineWidth = 1;
    const grid = Math.round(outputWidth / 24);
    for (let x = margin; x < outputWidth - margin; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, headerHeight);
      ctx.lineTo(x, headerHeight + innerHeight);
      ctx.stroke();
    }
    for (let y = headerHeight; y < headerHeight + innerHeight; y += grid) {
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(outputWidth - margin, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(241, 238, 231, 0.12)";
    ctx.strokeRect(margin, headerHeight, innerWidth, innerHeight);

    ctx.fillStyle = "rgba(241, 238, 231, 0.82)";
    ctx.font = '500 22px "IBM Plex Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.fillText("AIRFORM® / AIR DRAWING", margin, headerHeight / 2);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(241, 238, 231, 0.34)";
    ctx.fillText("21 LANDMARKS · 0 UPLOADS", outputWidth - margin, headerHeight / 2);
    ctx.textAlign = "left";

    const lineScale = innerWidth / state.size.width;

    ctx.save();
    ctx.beginPath();
    ctx.rect(margin, headerHeight, innerWidth, innerHeight);
    ctx.clip();
    for (const stroke of state.strokes) {
      drawArtStroke(ctx, stroke, innerWidth, innerHeight, margin, headerHeight, lineScale);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(241, 238, 231, 0.12)";
    ctx.beginPath();
    ctx.moveTo(margin, headerHeight + innerHeight);
    ctx.lineTo(outputWidth - margin, headerHeight + innerHeight);
    ctx.stroke();

    const date = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    })
      .format(new Date())
      .toUpperCase();

    const footerCenter = headerHeight + innerHeight + footerHeight / 2;
    ctx.fillStyle = "rgba(241, 238, 231, 0.33)";
    ctx.font = '400 17px "IBM Plex Mono", monospace';
    ctx.fillText(`MADE IN THIN AIR / ${date}`, margin, footerCenter);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(217, 255, 87, 0.65)";
    ctx.fillText("KEEP DRAWING →", outputWidth - margin, footerCenter);
    ctx.textAlign = "left";

    const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not create the PNG.");

    const link = document.createElement("a");
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
    link.download = `airform-${stamp}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    showToast("Artwork saved as a PNG.");
  } catch (error) {
    console.error("Airform: export failed.", error);
    showToast("The PNG export failed. Try again.");
  }
}

/* ============================================================
   Events & helpers
   ============================================================ */

function bindEvents() {
  dom.startCameraBtn.addEventListener("click", handleStartClick);
  dom.stopCameraBtn.addEventListener("click", () => stopCamera());
  dom.retryCameraBtn.addEventListener("click", handleRetry);
  dom.dismissErrorBtn.addEventListener("click", dismissError);

  dom.colorSwatches.forEach((button) => {
    button.addEventListener("click", () => selectInk(button));
  });

  dom.brushButtons.forEach((button) => {
    button.addEventListener("click", () => selectBrush(button));
  });

  dom.undoBtn.addEventListener("click", undo);
  dom.clearBtn.addEventListener("click", clearCanvas);
  dom.downloadBtn.addEventListener("click", downloadArtwork);

  dom.mirrorBtn.addEventListener("click", () => {
    state.mirror = !state.mirror;
    dom.video.classList.toggle("mirrored", state.mirror);
    dom.mirrorBtn.classList.toggle("is-active", state.mirror);
    dom.mirrorBtn.setAttribute("aria-pressed", String(state.mirror));
    drawOverlay();
  });

  dom.skeletonBtn.addEventListener("click", () => {
    state.showSkeleton = !state.showSkeleton;
    dom.skeletonBtn.classList.toggle("is-active", state.showSkeleton);
    dom.skeletonBtn.setAttribute("aria-pressed", String(state.showSkeleton));
    drawOverlay();
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    }
    if (event.key === "Escape" && !dom.errorCard.hidden) {
      dismissError();
    }
  });

  window.addEventListener("pagehide", () => {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
  });
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 3200);
}
