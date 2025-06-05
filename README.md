# Flappy Bird Royale

A simple Flappy Bird-style game with single-player and multiplayer battle-royale modes, designed to run on Mobile Safari (iOS 18) and desktop browsers.

## Features

-   **Single-player mode:** Infinite side-scrolling with local high-score saving (IndexedDB).
-   **Multiplayer battle-royale mode (up to 8 players):**
    -   Real-time gameplay using Node.js/Express + `ws` for the relay server.
    -   Tick-based authoritative server (20 Hz) with client-side prediction and reconciliation.
    -   Spectator mode for defeated players, following the lead bird.
    -   Live leaderboard during multiplayer matches.
-   **Responsive Design:** Adapts to portrait and landscape orientations, including iPhone notch safe areas (CSS `env()` insets).
-   **Performance:** Uses Canvas 2D API and `requestAnimationFrame` for smooth 60fps gameplay. Sprites are intended to be optimized via an image atlas.
-   **Audio:** Touch-unlocked AudioContext for sound effects, with WAV/MP3 formats.
-   **Controls:** Tap anywhere on screen (or press Space on desktop) to flap.
-   **Match Flow (Multiplayer):**
    -   Lobby screen showing connected players and their ready status.
    -   Match starts when all connected players are ready.
    -   Automatic return to lobby after a match, with players reset to "Not Ready".
-   **Code:** Plain ES modules, no build step required for the client-side code.
-   **Accessibility:** Includes consideration for `prefers-reduced-motion` (though core gameplay is motion-centric).

## Files

-   `index.html`: Main HTML file with canvas and UI layout.
-   `main.js`: Client-side game logic, including game loop, physics, asset loading, UI management, and WebSocket client.
-   `server.js`: Node.js (Express + ws) relay server for multiplayer mode.
-   `assets/`: Directory containing game assets.
    -   `sprite_atlas.png`: Image atlas for game sprites (bird, pipes, ground).
    -   `flap.wav`, `flap.mp3`: Sound effect for flapping.
    -   `score.wav`, `score.mp3`: Sound effect for scoring a point.
    -   `hit.wav`, `hit.mp3`: Sound effect for hitting an obstacle.
    -   `die.wav`, `die.mp3`: Sound effect for player death.
-   `README.md`: This file.

## Quick Start

1.  **Prerequisites:**
    -   Node.js and npm installed (for the server).

2.  **Install Dependencies:**
    Open your terminal in the project root directory and run:
    ```bash
    npm install express ws
    ```

3.  **Run the Server:**
    In the same terminal, start the Node.js server:
    ```bash
    node server.js
    ```
    By default, the server will run on `http://localhost:3000` and the WebSocket server on `ws://localhost:3000`.

4.  **Open the Game:**
    Open the `index.html` file in your web browser like Chrome, Firefox, or Mobile Safari on iOS 18.
    -   You can usually do this by double-clicking the `index.html` file or by navigating to `file:///path/to/your/project/index.html`.
    -   For multiplayer, ensure clients can reach the server (e.g., all on the same local network, or server deployed publicly).

## Development Notes & Caveats

*   **Bundle Size & Asset Optimization:**
    *   The current `assets/sprite_atlas.png` is approximately 1.6MB. This exceeds the target gzipped bundle size of &leq;1MB. **For production use, this sprite atlas needs significant optimization (e.g., using tools like TinyPNG, OptiPNG, or re-exporting with indexed colors and fewer details) or replacement with a more compact version.**
    *   Audio files are small but could also be further compressed if needed.
    *   The code itself is not minified. For production, minifying JS and CSS would further reduce bundle size.
*   **Server Authoritativeness:**
    *   The server (`server.js`) implements authoritative movement and basic collision detection. Client-side prediction is in `main.js`.
    *   Score validation on the server is currently basic. For a production game, more robust validation against server-side pipe state would be necessary to prevent cheating.
*   **Multiplayer Pipes:**
    *   The server now generates and sends pipe data. Clients use this for rendering and can perform their own collision prediction.
*   **Reduced Motion:**
    *   The game checks for `prefers-reduced-motion`. While the core gameplay is inherently motion-based, this setting could be used to disable secondary animations (e.g., background parallax if it were more complex, or subtle bird bobbing animations not currently implemented).
*   **Error Handling & Robustness:**
    *   Basic error handling is in place for WebSocket connections and messages. More comprehensive error handling and UI feedback could be added for production.
    *   Packet loss handling on the client involves resending the last input; the server should be idempotent for such inputs (currently, flap processing uses a tick to avoid re-processing the exact same flap command for the same game tick).
*   **iOS Performance:**
    *   The game is designed with iOS 18 Mobile Safari in mind, using Canvas 2D and `requestAnimationFrame`. Testing on actual devices is crucial to confirm 60fps performance under various conditions.
    *   Ensure the `viewport-fit=cover` meta tag and `env()` CSS variables are correctly handled by the target iOS version for notch support.

## Gameplay

*   **Single Player:** Try to fly as far as possible, navigating the bird through pipe gaps. Your high score is saved locally.
*   **Multiplayer:**
    1.  Enter a nickname on the main menu and click "Multiplayer".
    2.  You'll enter the lobby. Click "Ready" when you are prepared to start.
    3.  Once all connected players are ready, the game will start with a short countdown.
    4.  Fly your bird and try to be the last one alive. Other players are visible on your screen.
    5.  If you collide, you'll become a spectator and can watch the remaining players.
    6.  A live leaderboard shows active players.
    7.  The last player remaining wins, and a "WINNER" banner is displayed.
    8.  After the match, all players automatically return to the lobby.

Enjoy the game!
