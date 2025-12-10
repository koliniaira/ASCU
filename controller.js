// ---------------- INPUT (phone -> Unity) ----------------
const HARDCODED_WS_URL = ""; 

function getWebSocketURL() {
  if (HARDCODED_WS_URL) {
    return HARDCODED_WS_URL;
  }

  const protocol = location.protocol === "https:" ? "wss://" : "ws://";
  return protocol + location.hostname + ":8081";
}

const WS_URL = getWebSocketURL();

document.addEventListener(
  "touchmove",
  function (e) {
    e.preventDefault();
  },
  { passive: false }
);



// ---------------- FEEDBACK (Unity -> phone) ----------------
let isInMenu = true;  // Default assumption that the first scene is main menu
let isLandscape = false;
let hasSpokenRotateHint = false;

function updateOrientationHint() {
  const hint = document.getElementById("rotateHint");
  if (!hint) return;

  // Orientation check: width > height => landscape
  isLandscape = window.innerWidth > window.innerHeight;

  const shouldShow = !isInMenu && !isLandscape; // only in game + portrait

  hint.style.display = shouldShow ? "flex" : "none";

  if (shouldShow && !hasSpokenRotateHint && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(
      "Rotate your phone to landscape to use the game controller."
    );
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    hasSpokenRotateHint = true;
  }

  if (!shouldShow) {
    // Allow hint to be spoken again if they go wrong orientation later
    hasSpokenRotateHint = false;
  }
}

// Keep orientation up to date
window.addEventListener("resize", updateOrientationHint);
window.addEventListener("orientationchange", updateOrientationHint);
window.addEventListener("load", updateOrientationHint);


function handleFeedback(msg) {
  // --- Update menu vs game mode based on eventId from Unity ---
  if (msg && typeof msg.eventId === "string") {
    const id = msg.eventId;

    // Any menu_* event means "we're in the menu"
    if (id.startsWith("menu_")) {
      isInMenu = true;

      // Special case: user activated START in the menu
      // MainMenuManager sends: eventId "menu_activate" with tts "Selected START" for Start. :contentReference[oaicite:6]{index=6}
      if (id === "menu_activate" && msg.tts) {
        const t = msg.tts.toLowerCase();
        if (t.includes("selected start") || t.includes("start")) {
          isInMenu = false;
        }
      }
    }
    // Any non-menu event means "we're in some non-menu scene" (game, checkpoint, hazards, etc.)
    else {
      isInMenu = false;
    }
  }
  // Update orientation hint visibility
  updateOrientationHint();

  // TTS
  if ("speechSynthesis" in window && msg.tts) {
    const u = new SpeechSynthesisUtterance(msg.tts);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

// Debug buttons
const testFocusBtn = document.getElementById("testFocus");
const testActivateBtn = document.getElementById("testActivate");

if (testFocusBtn) {
  testFocusBtn.onclick = () => {
    handleFeedback({
      eventId: "menu_focus",
      tts: "START",
      speechProfileId: "Default",
      vibrationProfileId: "short_pulse",
      priority: 1
    });
  };
}

if (testActivateBtn) {
  testActivateBtn.onclick = () => {
    handleFeedback({
      eventId: "menu_activate",
      tts: "Selection confirmed",
      speechProfileId: "Default",
      vibrationProfileId: "long_warning",
      priority: 2
    });
  };
}

// ---------------- INPUT (phone -> Unity) ----------------

let socket = null;

function connectToUnity() {
  console.log("Connecting to Unity at", WS_URL);
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("Connected to Unity");
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Connected to Unity.";

    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("Phone connected.");
      window.speechSynthesis.speak(u);
    }
  };

  socket.onclose = () => {
    console.log("Disconnected from Unity, retrying soon...");
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Disconnected. Reconnecting...";
    setTimeout(connectToUnity, 2000);
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleFeedback(msg);
    } catch (e) {
      console.error("Bad JSON from Unity:", event.data);
    }
  };
}

function sendInputGesture(gesture) {
  console.log("Gesture:", gesture);

  const payload = {
    type: "input",
    gesture: gesture
  };

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }

  // Debug speech so gestures are heard even without Unity
  // if ("speechSynthesis" in window) {
  //   const u = new SpeechSynthesisUtterance(gesture.replace("_", " "));
  //   window.speechSynthesis.cancel();
  //   window.speechSynthesis.speak(u);
  // }
}

// ---------------- Gesture detection ----------------

let movementTouchId = null;   // finger controlling left/right
let currentHoldDir = null;    // "left" | "right" | null

let actionTouchId = null;     // finger used for jump/tap
let actionStartX = 0;
let actionStartY = 0;
let actionStartTime = 0;
let lastActionTapTime = 0;

const SWIPE_DIST = 40;
const DOUBLE_TAP_MS = 300;

// Movement = bottom half, Jump/Action = top half
function isMovementArea(y) {
  const midY = window.innerHeight * 0.6; // bottom 40% for movement
  return y >= midY;
}

window.addEventListener(
  "touchstart",
  (e) => {
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;

      // Bottom area: movement finger
      if (isMovementArea(y) && movementTouchId === null) {
        movementTouchId = t.identifier;

        const screenMid = window.innerWidth / 2;
        const newDir = x < screenMid ? "left" : "right";

        if (newDir !== currentHoldDir) {
          // End previous hold if any
          if (currentHoldDir === "left") {
            sendInputGesture("hold_left_end");
          } else if (currentHoldDir === "right") {
            sendInputGesture("hold_right_end");
          }

          // Start new hold
          if (newDir === "left") {
            sendInputGesture("hold_left_start");
          } else {
            sendInputGesture("hold_right_start");
          }

          currentHoldDir = newDir;
        }
      }
      // Top area: action finger (jump/tap)
      else if (!isMovementArea(y) && actionTouchId === null) {
        actionTouchId = t.identifier;
        actionStartX = x;
        actionStartY = y;
        actionStartTime = Date.now();
      }
      // Any extra fingers are ignored for now
    }
  },
  { passive: true }
);

window.addEventListener(
  "touchend",
  (e) => {
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;

      // Movement finger lifted
      if (t.identifier === movementTouchId) {
        if (currentHoldDir === "left") {
          sendInputGesture("hold_left_end");
        } else if (currentHoldDir === "right") {
          sendInputGesture("hold_right_end");
        }
        currentHoldDir = null;
        movementTouchId = null;
        continue;
      }

      // Action finger lifted → detect swipe/tap/double-tap
      if (t.identifier === actionTouchId) {
        const dx = x - actionStartX;
        const dy = y - actionStartY;
        const dt = Date.now() - actionStartTime;

        let gesture = null;

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_DIST) {
          gesture = dx > 0 ? "swipe_right" : "swipe_left";
        } else if (Math.abs(dy) > SWIPE_DIST) {
          gesture = dy < 0 ? "swipe_up" : "swipe_down";
        } else if (dt < 250) {
          const now = Date.now();
          if (now - lastActionTapTime < DOUBLE_TAP_MS) {
            gesture = "double_tap";
            lastActionTapTime = 0;
          } else {
            gesture = "tap";
            lastActionTapTime = now;
          }
        }

        if (gesture) {
          sendInputGesture(gesture);
        }

        actionTouchId = null;
      }
    }
  },
  { passive: true }
);

// Start WebSocket after everything is set up
connectToUnity();