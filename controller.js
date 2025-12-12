// ---------------- GLOBAL VARIABLES ---------------- //
// Default assumption that the first scene is main menu
let isInMenu = true;    

// Default assumption that phone is in portrait 
let isLandscape = false;

// Current highest priority of spoken TTS (to avoid interrupting high-priority messages)
let currentSpokenPriority = 0;


// ---------------- DEBUG CONSOLE ----------------- //
// Debug log display (disabled by default, logs still go to browser console)
const debugLog = [];
// Set to true to show on-screen logs for troubleshooting
const DEBUG_UI_ENABLED = false; 

/**
 * Append a line to the debug log, mirror it into #debugLog if enabled,
 * and always print it to the browser console.
 */
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
  console.log(msg);
}

// Initialize orientation on page load
window.addEventListener('load', updateOrientationHint);

// ---------------- INPUT (PHONE -> UNITY) ---------------- //
/** 
 * If HARDCODED_WS_URL is non-empty, always use that for a tunnel.
 * Otherwise, connect back to the same host that served this page on port 8081.
*/ 

const HARDCODED_WS_URL = ""; 

function getWebSocketURL() {
  if (HARDCODED_WS_URL) {
    return HARDCODED_WS_URL;
  }

  const protocol = location.protocol === "https:" ? "wss://" : "ws://";
  return protocol + location.hostname + ":8081";
}

// Resolved WebSocket URL used by connectToUnity()
const WS_URL = getWebSocketURL();


// ---------------- MOBILE ORIENTATION CHECK ---------------- //
/**
 * Update isLandscape based on window dimensions and show/hide the rotateHint
 * overlay. When we return to landscape, we reset hasSpokenRotateHint so that
 * we can speak the hint again next time the user is in portrait.
 */

// Prevent the browser from scrolling the page when the user drags on the controller
document.addEventListener(
  "touchmove",
  function (e) {
    e.preventDefault();
  },
  { passive: false }
);

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

  // Show overlay when in portrait, hide when in landscape.
  const shouldShow = !isLandscape;
  hint.style.display = shouldShow ? "flex" : "none";
  if (!shouldShow) {
    // Allow the rotate hint to be spoken again, the next time the user is stuck in portrait.
    hasSpokenRotateHint = false;
    console.log("Landscape detected - reset hasSpokenRotateHint");
  }
}

// Keep orientation state up to date when the browser is resized or rotated.
window.addEventListener("resize", updateOrientationHint);
window.addEventListener("orientationchange", updateOrientationHint);


// ---------------- FEEDBACK (UNITY -> PHONE) ---------------- //
/**
 * Handle accessibility feedback coming from Unity.
 * - Decides whether the phone should be in "menu" or "game" mode.
 * - Handles special start-game intro behaviour.
 * - Speaks any TTS text using the Web Speech API with simple priorities.
*/

function handleFeedback(msg) {
  if (!msg || typeof msg.eventId !== "string") return

  const id = msg.eventId;
  const text = msg.tts || "";

  console.log("Feedback from Unity:", msg);

  // Decide menu vs. game mode based on eventId prefix
  if (id.startsWith("menu_")) {
    isInMenu = true; 
    
    // Special handling for "start game" event
    if (id === "menu_start_game") {
      // Leaving the menu and going into the game
      isInMenu = false;

      // Speak short intro and notify Unity when it's safe to start level cues
      if ("speechSynthesis" in window) {
        const intro = new SpeechSynthesisUtterance(
          "Game starting. For best experience, keep your phone in landscape mode. "
        );
      
      intro.onend = () => {
        // When the intro finishes, tell Unity it's safe to start level sound cue
        sendInputGesture("intro_done");
      };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(intro);
      }
      updateOrientationHint();
      return;
  }
  } else {
    // Any non-menu event implies we are in some non-menu scene
    isInMenu = false;
  }
  // Update overlay and orientation whenever mode changes
  updateOrientationHint();

  // --- TTS from Unity (menu focus, checkpoints) ---
  if ("speechSynthesis" in window && text) {
    // Priority from Unity (0–3). Fallback to 0 if missing.
    const incomingPriority =
      typeof msg.priority === "number" ? msg.priority : 0;

    // Higher or equal priority: interrupt what’s currently speaking.
    // Lower priority than what’s already playing: ignore it.
    if (incomingPriority >= currentSpokenPriority) {
      // Kill any queued / currently speaking utterances
      window.speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(text);
      currentSpokenPriority = incomingPriority;

      // When this finishes (or is cancelled), reset priority
      u.onend = () => {
        currentSpokenPriority = 0;
      };

      window.speechSynthesis.speak(u);
    } else {
      console.log(
        "Dropped low-priority TTS:",
        msg.eventId,
        "priority",
        incomingPriority,
        "< current",
        currentSpokenPriority
      );
    }
  }
}

// ---------------- DEBUG BUTTON ---------------- //
// const testFocusBtn = document.getElementById("testFocus");

// if (testFocusBtn) {
//   testFocusBtn.onclick = () => {
//     handleFeedback({
//       eventId: "menu_focus",
//       tts: "START",
//       speechProfileId: "Default",
//       priority: 1
//     });
//   };
// }

// ---------------- INPUT (phone -> Unity) ----------------
/**
 * Establish and maintain the WebSocket connection to the Unity WebSocket server.
 * Updates the on-screen status label and speaks "Phone connected" once.
*/

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

/**
 * Send a high-level gesture string to Unity, if the socket is open.
 * Also pushes the gesture into the debug log.
*/
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
}

// ---------------- GESTURE DETECTION ---------------- //

// Shared touch state for both menu and game modes.
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastActionTapTime = 0;

// In-game movement state: single "movement finger" controlling left/right holds.
let movementTouchId = null;   // Finger controlling left/right
let currentHoldDir = null;    // "Left" | "Right" | Null

// In-game action state: separate finger controlling jump/tap gestures.
let actionTouchId = null;     // Finger used for jump/tap
let actionStartX = 0;
let actionStartY = 0;
let actionStartTime = 0;

// Thresholds for detecting swipes and double-taps.
const SWIPE_DIST = 40;     // Minimum pixels to count as a swipe. 
const DOUBLE_TAP_MS = 300; // Maximum time between taps to count as a double-tap

// Handle the start of touch gesture
window.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();

    const t0 = e.touches[0];
    if (t0) {
      touchStartX = t0.clientX;
      touchStartY = t0.clientY;
      touchStartTime = Date.now();
    }

    // Recompute orientation INSIDE a user gesture, so hint reflects real state.
    updateOrientationHint();

    // Hard gate input in portrait: only allow taps that trigger the rotate hint.
    if (!isLandscape) {
      return;
    }

    // --- MENU MODE: simple single-finger swipe/tap anywhere ---
    if (isInMenu) {
      addDebugLog("Menu mode touch start: x=" + touchStartX + " y=" + touchStartY);
      return;
    }

    // --- GAME MODE (isInMenu === false, and we know isLandscape === true here) ---
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;

      // First finger becomes the movement finger (left/right hold).
      if (movementTouchId === null) {
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

      // Second finger becomes the action finger (jump/tap).
      else if (actionTouchId === null && t.identifier !== movementTouchId) {
        actionTouchId = t.identifier;
        actionStartX = x;
        actionStartY = y;
        actionStartTime = Date.now();
      }
      // Extra fingers ignored
    }
  },
  { passive: false }
);


// Handle the end of a touch gesture.
window.addEventListener(
  "touchend",
  (e) => {
    e.preventDefault();

     // If portrait and we haven't unlocked TTS, detect quick tap and unlock and speak hint
    if (!isLandscape) {
      const t = e.changedTouches[0];
      const dx = Math.abs((t?.clientX || 0) - (touchStartX || 0));
      const dy = Math.abs((t?.clientY || 0) - (touchStartY || 0));
      const dt = Date.now() - (touchStartTime || Date.now());

      const TAP_DIST = 16; 
      const TAP_MS = 300; 

      // Small, quick taps: speak the rotate hint (once per portrait session)
      if (dx <= TAP_DIST && dy <= TAP_DIST && dt < TAP_MS) {
        // This is a tap in portrait, speak the rotate hint directly
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
      // In portrait, no gestures go to Unity.
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

    // --- GAME MODE: release movement or action finger. ---
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;

      // Movement finger lifted, stop any active hold 
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

      // Action finger lifted, detect swipe/tap/double-tap 
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
  { passive: false }
);

// Attempt connection to Unity when the page loads
connectToUnity();