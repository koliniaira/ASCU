
// const WS_URL = "wss://a029f1de13e4.ngrok-free.app";

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


const vibrationPatterns = {
  short_pulse: [0, 50],
  long_warning: [0, 200, 100, 200]
};

// ---------------- FEEDBACK (Unity -> phone) ----------------

function handleFeedback(msg) {
  // TTS
  if ("speechSynthesis" in window && msg.tts) {
    const u = new SpeechSynthesisUtterance(msg.tts);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // Vibration (no-op on iOS, fine)
  if ("vibrate" in navigator && msg.vibrationProfileId) {
    const pattern = vibrationPatterns[msg.vibrationProfileId];
    if (pattern) navigator.vibrate(pattern);
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

  // Debug speech so you can hear gestures even without Unity
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(gesture.replace("_", " "));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

// ---------------- Gesture detection ----------------

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastTapTime = 0;

window.addEventListener(
  "touchstart",
  (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = Date.now();
  },
  { passive: true }
);

window.addEventListener(
  "touchend",
  (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dt = Date.now() - touchStartTime;

    const DIST = 40;
    let gesture = null;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DIST) {
      gesture = dx > 0 ? "swipe_right" : "swipe_left";
    } else if (Math.abs(dy) > DIST) {
      gesture = dy > 0 ? "swipe_down" : "swipe_up";
    } else if (dt < 250) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        gesture = "double_tap";
        lastTapTime = 0;
      } else {
        gesture = "tap";
        lastTapTime = now;
      }
    }

    if (gesture) {
      sendInputGesture(gesture);
    }
  },
  { passive: true }
);

// Start WebSocket after everything is set up
connectToUnity();