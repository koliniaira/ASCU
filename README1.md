## Unity Project File Index
All assets that belong to the phone controller system are contained in the `Assets/MobileControllerSystem` folder. The only external dependency is `Assets/Plugins/websocket-sharp.dll`, which provides WebSocket support used by the controller.

### Top level

- **Assets/MobileControllerSystem/** – All assets that belong to the phone-based accessible controller package.
- **Assets/Plugins/websocket-sharp.dll** – Third-party (https://github.com/sta/websocket-sharp) WebSocket library used by `WebSocketConnect` to talk to the phone. 
- **Assets/TextMesh Pro/** – Unity’s TextMesh Pro package (imported dependency, not modified in this project).

---

### Assets/MobileControllerSystem

- **Audio/** – Sound effects used by the demo (jump, landing, footsteps, wall bumps, checkpoint, hazard proximity, level start).
- **AccessibilityFeedbackProfiles/** – ScriptableObject assets that configure TTS text, priority, and optional sound cues for individual accessibility event IDs.
- **PhysicsMaterials/** – Contains `NoFriction` used on colliders to avoid sticking 
- **Prefab/**  
  - **MobileControllerSystem.prefab** – Main prefab containing the accessibility event router, feedback manager, WebSocket server, and phone input listener; drop this into any scene to enable the controller.
- **Scenes/**  
  - **MainMenuDemo.unity** – Example main menu scene that can be fully navigated from the phone and includes Instructions and Connection Help panels.  
  - **ExplorationDemo.unity** – Example 2D platformer scene showing phone-based movement, checkpoints, hazards, and proximity cues.

---

### Scripts

#### Scripts/DemoGameplay

- **ExplorationController.cs** – High-level controller for the demo level that coordinates starting/resetting the scene and listening for intro completion.
- **ExplorationEventTrigger.cs** – Generic trigger that raises configured accessibility events when the player enters specific areas in the level.
- **HazardAnnouncer.cs** – Counts hazards at startup and announces a summary event (e.g., number of obstacles) once the phone intro has finished.
- **HazardProximity.cs** – Triggers a proximity cue event when the player comes within a given radius of a hazard object.
- **PlayerAudio.cs** – Plays sound effects in response to movement and collision events.
- **PlayerCollision.cs** – Detects collisions and raises corresponding accessibility events plus audio feedback.
- **PlayerMovement.cs** – Subscribes to `MobileInputListener` events to move and jump the player character.

#### Scripts/EventFeedback

- **AccessibilityEvents.cs** – Defines the `AccessibilityEvent` data structure and enums for event priority used by the feedback system.
- **AccessibilityEventsRouter.cs** – Singleton event that other scripts call to raise accessibility events, which are then broadcast to listeners.
- **EventFeedbackSettings.cs** – Holds configuration types such as `EventFeedbackProfile` and settings for mapping event IDs to feedback behavior.
- **FeedbackManager.cs** – Listens to `AccessibilityEventsRouter`, looks up profiles, builds JSON `AccessibilityFeedbackPayload`s, and forwards them to transports (and optional local SFX).
- **FeedbackPayload.cs** – Serializable payload struct (`AccessibilityFeedbackPayload`) containing `eventId`, TTS text, and priority for sending to the phone.
- **FeedbackPlug.cs** – Base class for feedback transports that can send JSON payloads (WebSocket, debug logger).
- **DebugFeedbackPlug.cs** – Simple `FeedbackPlug` implementation that logs outgoing payloads to the Unity Console for testing.

#### Scripts/MenuUI

- **MainMenuManager.cs** – Drives the accessible main menu: tracks which button is focused, responds to phone swipes/double-taps or keyboard, and raises `menu_*` accessibility events.
- **InstructionsScene.cs** – Controls the in-menu instructions panel and raises an accessibility event when opened so the phone can prompt the player.
- **MobileConnectInstructions.cs** (`PhoneConnectionInstructions` class) – Fills the Phone Connection Help panel with controller URL/IP/port and sends the same text as a TTS event to the phone.

#### Scripts/MobileInput

- **MobileInputListener.cs** – Listens for `MobileInputMessage`s from `WebSocketConnect` and exposes C# events for gestures such as swipes, taps, double-taps, and left/right holds.

#### Scripts/MobileNetworking

- **MobileInputMessage.cs** – C# representation of input JSON from the phone (`type`, `gesture`) used by `MobileInputListener`.
- **WebSocketConnect.cs** – Starts and manages the WebSocket server in Unity, forwarding incoming messages to listeners and sending feedback JSON out to the phone.
- **WebSocketTest.cs** – Debug script for manually testing WebSocket connectivity and messaging during development.

## Phone Controller Web Client

The `phone-controller` folder is distributed alongside the Unity project (not inside `Assets/`, check repo root) and contains the standalone web client that runs on the player’s phone. 

- **phone-controller/** – Standalone web client that runs on the player’s phone and connects to the Unity WebSocket server over Wi-Fi.
  - **controller.html** – HTML shell for the phone controller UI (status text, orientation hint, and full-screen touch surface).
  - **controller.css** – Styles for the controller UI, including layout for menu/game modes and the rotate-to-landscape hint overlay.
  - **controller.js** – JavaScript logic that connects to Unity via WebSockets, interprets touch gestures (swipes, taps, holds), and speaks accessibility feedback using the Web Speech API.