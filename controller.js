// Global Variables
let isInMenu = true;  // Default assumption that the first scene is main menu
let isLandscape = false;
let hasSpokenRotateHint = false;

// Debug log display (disabled by default, logs still go to browser console)
const debugLog = [];
const DEBUG_UI_ENABLED = false; // Set to true to show on-screen logs for troubleshooting
function addDebugLog(msg) {
  debugLog.push(msg);
  if (debugLog.length > 20) debugLog.shift();
  if (DEBUG_UI_ENABLED) {
    const logEl = document.getElementById("debugLog");
    if (logEl) {
      logEl.textContent = debugLog.join("\n");
      logEl.style.display = "block";
    }
  }
  // Logs always go to browser console for troubleshooting
  console.log(msg);
}

// Initialize orientation on page load
window.addEventListener('load', updateOrientationHint);

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

// ---------------- MOBILE ORIENTATION CHECK ----------------
function updateOrientationHint() {
  const hint = document.getElementById("rotateHint");
  if (!hint) return;

  // Orientation check: width > height => landscape
  isLandscape = window.innerWidth > window.innerHeight;

  console.log("Orientation check:", {
    isLandscape,
    width: window.innerWidth,
    height: window.innerHeight
  });

  // Show hint whenever we are in portrait, in ANY scene
  const shouldShow = !isLandscape;

  hint.style.display = shouldShow ? "flex" : "none";

  if (!shouldShow) {
    // When we go back to landscape, let us speak the hint again next time we enter portrait
    hasSpokenRotateHint = false;
    console.log("Landscape detected - reset hasSpokenRotateHint");
  }
}

// Keep orientation up to date
window.addEventListener("resize", updateOrientationHint);
window.addEventListener("orientationchange", updateOrientationHint);
window.addEventListener("load", updateOrientationHint);


// ---------------- FEEDBACK (Unity -> phone) ----------------
function handleFeedback(msg) {
  if (!msg || typeof msg.eventId !== "string") return

  const id = msg.eventId;
  const text = msg.tts || "";

  console.log("Feedback from Unity:", msg);
  // --- Decide menu vs game mode ---
  if (id.startsWith("menu_")) {
    // Default: menu
    isInMenu = true;

    console.log("Feedback from Unity:", msg);
    
    // // ---------- SPECIAL CASE: CHECKPOINT ----------
    // if (id === "checkpoint_reached") {
    //   // Say the line if there is one
    //   if ("speechSynthesis" in window && text) {
    //     window.speechSynthesis.cancel();
    //     const u = new SpeechSynthesisUtterance(text);
    //     window.speechSynthesis.speak(u);
    //   }

    //   // After Unity's 1s delay + a bit of buffer, reload the controller page.
    //   // This puts us back into the same working state as a fresh run.
    //   setTimeout(() => {
    //     console.log("[controller] Checkpoint reached → reloading controller page.");
    //     window.location.reload();
    //   }, 1500); // 1000ms (Unity delay) + 500ms buffer

    //   return; // Don't process anything else for this message
    // }
    
    // Any menu_activate = user just confirmed a menu item (START))
    if (id === "menu_activate") {
      isInMenu = false;

      // Audio instructions about game + rotation
      if ("speechSynthesis" in window) {
        const intro = new SpeechSynthesisUtterance(
          "Game starting. For best experience, turn off screen rotation lock, and " +
          "keep your phone in landscape mode. " +
          "In landscape, use the top part of the screen to move left and right, " +
          "and the bottom of the screen to jump."
        );
      
      // When the intro finishes, tell Unity it's safe to start SFX
      intro.onend = () => {
        sendInputGesture("intro_done");
      };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(intro);
      }
      updateOrientationHint();
      return;
    }
  } else {
    // Any non-menu_* event means we're in some non-menu scene (game, checkpoints, hazards)
    isInMenu = false;
  }

  // Update overlay + orientation
  updateOrientationHint();

  // --- TTS from Unity (menu focus, checkpoints, etc.) ---
  if ("speechSynthesis" in window && text) {
    const u = new SpeechSynthesisUtterance(text);
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
  addDebugLog("Gesture: " + gesture);

  const payload = {
    type: "input",
    gesture: gesture
  };

  if (socket && socket.readyState === WebSocket.OPEN) {
    addDebugLog("Sending to Unity: " + JSON.stringify(payload));
    socket.send(JSON.stringify(payload));
  } else {
    addDebugLog("Socket not ready. State: " + (socket?.readyState || "null"));
  }

  // // Debug speech so gestures are heard even without Unity
  // if ("speechSynthesis" in window) {
  //   try {
  //     const u = new SpeechSynthesisUtterance(gesture.replace(/_/g, " "));
  //     u.rate = 1.0;
  //     u.pitch = 1.0;
  //     u.volume = 1.0;
  //     window.speechSynthesis.cancel();
  //     addDebugLog("Speaking: " + gesture.replace(/_/g, " "));
  //     window.speechSynthesis.speak(u);
  //   } catch (e) {
  //     addDebugLog("TTS error: " + e);
  //   }
  // }
}

// ---------------- Gesture detection ----------------


// Shared state for both modes
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastActionTapTime = 0;

// Controller-mode movement state
let movementTouchId = null;   // Finger controlling left/right
let currentHoldDir = null;    // "Left" | "Right" | Null

let actionTouchId = null;     // Finger used for jump/tap
let actionStartX = 0;
let actionStartY = 0;
let actionStartTime = 0;

const SWIPE_DIST = 40;
const DOUBLE_TAP_MS = 300;

// Movement = bottom 40% of the screen in GAME mode
function isMovementArea(y) {
  return y >= window.innerHeight * 0.6;
}

window.addEventListener(
  "touchstart",
  (e) => {
    const t0 = e.touches[0];
    if (t0) {
      touchStartX = t0.clientX;
      touchStartY = t0.clientY;
      touchStartTime = Date.now();
    }

    // 1) Recompute orientation INSIDE a user gesture
    updateOrientationHint();

    // 2) Hard gate input in portrait (see below)
    if (!isLandscape) {
      return;
    }

    // --- MENU MODE: simple single-finger swipe/tap anywhere ---
    if (isInMenu) {
      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchStartTime = Date.now();
      addDebugLog("Menu mode touch start: x=" + touchStartX + " y=" + touchStartY);
      return;
    }

    // --- GAME MODE (isInMenu === false, and we know isLandscape === true here) ---
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;

      // Bottom area: movement finger (hold to move left/right)
      if (movementTouchId === null) {
      // if (isMovementArea(y) && movementTouchId === null) {
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
      // Top area: action finger (jump/tap/swipe)
      else if (actionTouchId === null && t.identifier !== movementTouchId) {

      // else if (!isMovementArea(y) && actionTouchId === null) {
        actionTouchId = t.identifier;
        actionStartX = x;
        actionStartY = y;
        actionStartTime = Date.now();
      }
      // Extra fingers ignored
    }
  },
  { passive: true }
);

window.addEventListener(
  "touchend",
  (e) => {
     // If portrait and we haven't unlocked TTS, detect quick tap and unlock + speak hint
    if (!isLandscape) {
      const t = e.changedTouches[0];
      const dx = Math.abs((t?.clientX || 0) - (touchStartX || 0));
      const dy = Math.abs((t?.clientY || 0) - (touchStartY || 0));
      const dt = Date.now() - (touchStartTime || Date.now());
      const TAP_DIST = 16; // pixels allowed
      const TAP_MS = 300; // max tap duration

      if (dx <= TAP_DIST && dy <= TAP_DIST && dt < TAP_MS) {
        // This is a tap in portrait — speak the rotate hint directly
        if ("speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(
            "Turn off screen rotation lock, and rotate your phone to landscape to use it as a controller."
          );
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          addDebugLog("Spoke rotation hint after portrait tap");
          hasSpokenRotateHint = true;
        }
      }
      // In portrait, always stop here: no gestures go to Unity.
      return;
  }

    // --- MENU MODE: simple swipe/tap everywhere ---
    if (isInMenu) {
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      const dt = Date.now() - touchStartTime;

      addDebugLog("Menu mode touch end: dx=" + dx + " dy=" + dy + " dt=" + dt);

      let gesture = null;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_DIST) {
        gesture = dx > 0 ? "swipe_right" : "swipe_left";
      } else if (Math.abs(dy) > SWIPE_DIST) {
        gesture = dy > 0 ? "swipe_down" : "swipe_up";
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
        addDebugLog("Menu mode gesture detected: " + gesture);
        sendInputGesture(gesture);
      }
      return;
    }

    // --- GAME MODE (isInMenu === false, and isLandscape === true) ---
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

      // Action finger lifted → detect swipe/tap/double-tap in top area
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

// Start connection
connectToUnity();