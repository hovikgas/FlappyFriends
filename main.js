// main.js - Flappy Bird Royale Game Logic

// --- DOM Elements ---
const gameContainer = document.getElementById("gameContainer");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// UI Screens
const mainMenuScreen = document.getElementById("mainMenuScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const countdownScreen = document.getElementById("countdownScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const winnerBannerContainer = document.getElementById("winnerBannerContainer");
const leaderboardScreen = document.getElementById("leaderboardScreen");

// UI Elements
const nicknameInput = document.getElementById("nicknameInput");
const playSinglePlayerButton = document.getElementById("playSinglePlayerButton");
const multiplayerButton = document.getElementById("multiplayerButton");
const loadingStatus = document.getElementById("loadingStatus");
const playerList = document.getElementById("playerList");
const readyButton = document.getElementById("readyButton");
const lobbyStatus = document.getElementById("lobbyStatus");
const countdownText = document.getElementById("countdownText");
const finalScoreDisplay = document.getElementById("finalScore");
const finalHighScoreDisplay = document.getElementById("finalHighScore");
const restartSinglePlayerButton = document.getElementById("restartSinglePlayerButton");
const backToMenuButton = document.getElementById("backToMenuButton");
const winnerBanner = document.getElementById("winnerBanner");
const scoreDisplay = document.getElementById("scoreDisplay");
const highScoreDisplay = document.getElementById("highScoreDisplay");
const leaderboardList = document.getElementById("leaderboardList");

// --- Game Constants ---
const GRAVITY = 0.25; 
const FLAP_STRENGTH = -5.5;
const PIPE_SPEED = 2; 
const PIPE_WIDTH = 80;
const PIPE_GAP = 150; 
const PIPE_SPAWN_INTERVAL = 120; 

const BIRD_WIDTH = 34;
const BIRD_HEIGHT = 24;

const SERVER_HOST = `ws://${window.location.hostname}:3000`; 
const SERVER_TICK_RATE = 20; 
const CLIENT_PREDICTION = true;

// Logical canvas dimensions (will be set by resizeCanvas)
let LOGICAL_CANVAS_WIDTH;
let LOGICAL_CANVAS_HEIGHT;

// --- Game State ---
let gameState = "loading"; 
let gameMode = "single"; 

let bird = {
    x: 50,
    y: 150, // Initial Y, will be properly set in resetGame
    width: BIRD_WIDTH,
    height: BIRD_HEIGHT,
    velocityY: 0,
    angle: 0,
    frame: 0, 
    isDead: false,
    nickname: "Player",
    id: null 
};

let pipes = [];
let frameCount = 0;
let score = 0;
let highScore = 0;

let audioContext;
let soundBuffers = {};
let assets = {};
let assetsLoaded = false;
let firstUserGesture = false;

let ws;
let players = {}; 
let localPlayerId = null;
let isReady = false;
let lastSentInput = null; 
let serverStateBuffer = []; 
let clientTick = 0;

// --- Asset Loading ---
const assetSources = {
    spriteSheet: "assets/sprite_atlas.png",
    flapSfx: "assets/flap.wav",
    scoreSfx: "assets/score.wav",
    hitSfx: "assets/hit.wav",
    dieSfx: "assets/die.wav",
};

async function loadAssets() {
    loadingStatus.textContent = "Loading assets...";
    let loadedCount = 0;
    const totalAssets = Object.keys(assetSources).length;

    function updateLoadingProgress() {
        loadedCount++;
        loadingStatus.textContent = `Loading assets... (${loadedCount}/${totalAssets})`;
        if (loadedCount === totalAssets) {
            assetsLoaded = true;
            loadingStatus.textContent = "Assets loaded!";
            setTimeout(() => {
                if (gameState === "loading") {
                    showScreen("mainMenuScreen");
                    gameState = "menu";
                }
            }, 500);
        }
    }

    assets.spriteSheet = new Image();
    assets.spriteSheet.src = assetSources.spriteSheet;
    assets.spriteSheet.onload = updateLoadingProgress;
    assets.spriteSheet.onerror = () => {
        console.error("Failed to load sprite sheet");
        updateLoadingProgress(); // Still count it
    }

    for (const key in assetSources) {
        if (assetSources[key].endsWith(".wav") || assetSources[key].endsWith(".mp3")) {
            fetch(assetSources[key])
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => {
                    soundBuffers[key] = { raw: arrayBuffer, buffer: null };
                    updateLoadingProgress();
                })
                .catch(err => {
                    console.error(`Failed to load sound ${key}:`, err);
                    updateLoadingProgress(); 
                });
        }
    }
}

function initAudio() {
    if (!firstUserGesture || audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioContext) {
        console.warn("AudioContext not supported!");
        return;
    }
    console.log("AudioContext initialized.");

    for (const key in soundBuffers) {
        if (soundBuffers[key].raw && !soundBuffers[key].buffer) {
            audioContext.decodeAudioData(soundBuffers[key].raw.slice(0), 
                (buffer) => {
                    soundBuffers[key].buffer = buffer;
                    console.log(`Sound ${key} decoded.`);
                },
                (err) => console.error(`Error decoding audio data for ${key}:`, err)
            );
        }
    }
}

function playSound(key) {
    if (!audioContext || !soundBuffers[key] || !soundBuffers[key].buffer || !firstUserGesture) return;
    try {
        const source = audioContext.createBufferSource();
        source.buffer = soundBuffers[key].buffer;
        source.connect(audioContext.destination);
        source.start(0);
    } catch (error) {
        console.error(`Error playing sound ${key}:`, error);
    }
}

// --- IndexedDB for High Score ---
let db;
function initDB() {
    const request = indexedDB.open("FlappyBirdDB", 1);
    request.onerror = (event) => console.error("IndexedDB error:", event.target.errorCode);
    request.onsuccess = (event) => {
        db = event.target.result;
        loadHighScore();
    };
    request.onupgradeneeded = (event) => {
        const dbUpgrade = event.target.result;
        if (!dbUpgrade.objectStoreNames.contains("gameData")) {
            dbUpgrade.createObjectStore("gameData", { keyPath: "id" });
        }
    };
}

function loadHighScore() {
    if (!db) return;
    try {
        const transaction = db.transaction(["gameData"], "readonly");
        const objectStore = transaction.objectStore("gameData");
        const request = objectStore.get("highScore");
        request.onsuccess = (event) => {
            if (request.result) {
                highScore = request.result.value;
            }
            updateHighScoreDisplay();
        };
        request.onerror = (event) => console.error("Failed to load high score:", event.target.error);
    } catch (error) {
        console.error("Error in loadHighScore transaction:", error);
    }
}

function saveHighScore() {
    if (!db) return;
    try {
        const transaction = db.transaction(["gameData"], "readwrite");
        const objectStore = transaction.objectStore("gameData");
        objectStore.put({ id: "highScore", value: highScore });
        updateHighScoreDisplay();
        transaction.onerror = (event) => console.error("Failed to save high score:", event.target.error);
    } catch (error) {
        console.error("Error in saveHighScore transaction:", error);
    }
}

// --- UI Management ---
function showScreen(screenId) {
    [mainMenuScreen, lobbyScreen, countdownScreen, gameOverScreen, winnerBannerContainer, leaderboardScreen].forEach(s => s.classList.add("hidden"));
    scoreDisplay.classList.add("hidden");
    highScoreDisplay.classList.add("hidden");

    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.classList.remove("hidden");

    if (screenId === "mainMenuScreen") {
        nicknameInput.value = bird.nickname || localStorage.getItem("flappy_nickname") || "";
    }
}

function updateScoreDisplay() {
    scoreDisplay.textContent = `Score: ${score}`;
}

function updateHighScoreDisplay() {
    highScoreDisplay.textContent = `High Score: ${highScore}`;
}

function updateLobbyUI() {
    if (!lobbyScreen.classList.contains("hidden")) {
        playerList.innerHTML = "";
        Object.values(players).forEach(p => {
            const li = document.createElement("li");
            li.textContent = `${p.nickname} ${p.isReady ? "(Ready)" : "(Not Ready)"}`;
            if (p.id === localPlayerId) li.style.fontWeight = "bold";
            playerList.appendChild(li);
        });
        readyButton.textContent = isReady ? "Cancel Ready" : "Ready";
        readyButton.disabled = false;

        const playerCount = Object.keys(players).length;
        const readyCount = Object.values(players).filter(p=>p.isReady).length;
        const allReady = playerCount > 0 && readyCount === playerCount;

        if (allReady) {
            lobbyStatus.textContent = "All players ready! Starting soon...";
        } else {
            lobbyStatus.textContent = `Waiting for players... (${readyCount}/${playerCount} ready)`;
        }
    }
}

function updateLeaderboardUI() {
    if (!leaderboardScreen.classList.contains("hidden")) {
        leaderboardList.innerHTML = "";
        const sortedPlayers = Object.values(players)
            .filter(p => p && (gameMode === "multi" ? !p.isDead : true)) 
            .sort((a, b) => (b.score || 0) - (a.score || 0)); 

        sortedPlayers.forEach(p => {
            const li = document.createElement("li");
            li.textContent = `${p.nickname}: ${p.score || 0}`;
            if (p.id === localPlayerId) li.style.fontWeight = "bold";
            leaderboardList.appendChild(li);
        });
    }
}

// --- Game Logic ---
function resetGame() {
    if (typeof LOGICAL_CANVAS_HEIGHT !== "number" || LOGICAL_CANVAS_HEIGHT <= 0) {
        console.warn("LOGICAL_CANVAS_HEIGHT not set for resetGame, attempting resize.");
        resizeCanvas(); // Ensure logical dimensions are set
    }
    bird.y = LOGICAL_CANVAS_HEIGHT / 2 - bird.height / 2;
    bird.velocityY = 0;
    bird.angle = 0;
    bird.isDead = false;
    pipes = [];
    score = 0;
    frameCount = 0;
    clientTick = 0;
    serverStateBuffer = [];
    updateScoreDisplay();
}

function flap() {
    if (!firstUserGesture) {
        firstUserGesture = true;
        initAudio();
    }
    if (bird.isDead && gameMode === "single") return; 
    if (gameState !== "playing" && gameState !== "countdown") return; 

    bird.velocityY = FLAP_STRENGTH;
    playSound("flapSfx");

    if (gameMode === "multi" && ws && ws.readyState === WebSocket.OPEN && !bird.isDead) {
        const inputPayload = { type: "flap", tick: clientTick, id: localPlayerId };
        ws.send(JSON.stringify(inputPayload));
        lastSentInput = inputPayload; 
    }
}

function updateBird() {
    bird.velocityY += GRAVITY;
    bird.y += bird.velocityY;
    bird.angle = Math.min(Math.PI / 4, bird.velocityY * 0.05); 

    if (bird.y + bird.height > LOGICAL_CANVAS_HEIGHT || bird.y < 0) {
        gameOver();
    }
}

function updatePipes() {
    if (frameCount % PIPE_SPAWN_INTERVAL === 0) {
        const pipeY = Math.random() * (LOGICAL_CANVAS_HEIGHT - PIPE_GAP - 100) + 50; 
        pipes.push({ x: LOGICAL_CANVAS_WIDTH, y: pipeY, width: PIPE_WIDTH, scored: false });
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
        pipes[i].x -= PIPE_SPEED;

        if (!pipes[i].scored && pipes[i].x + pipes[i].width < bird.x) {
            score++;
            pipes[i].scored = true;
            updateScoreDisplay();
            playSound("scoreSfx");
            if (gameMode === "multi" && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "scoreUpdate", score: score, id: localPlayerId }));
            }
        }

        if (
            bird.x < pipes[i].x + pipes[i].width &&
            bird.x + bird.width > pipes[i].x &&
            (bird.y < pipes[i].y || bird.y + bird.height > pipes[i].y + PIPE_GAP)
        ) {
            gameOver();
        }

        if (pipes[i].x + pipes[i].width < 0) {
            pipes.splice(i, 1);
        }
    }
}

function gameOver() {
    if (bird.isDead && gameState !== "playing") return; 
    bird.isDead = true;
    playSound("hitSfx");
    setTimeout(() => playSound("dieSfx"), 200); 

    if (gameMode === "single") {
        gameState = "gameOver";
        if (score > highScore) {
            highScore = score;
            saveHighScore();
        }
        finalScoreDisplay.textContent = score;
        finalHighScoreDisplay.textContent = highScore;
        showScreen("gameOverScreen");
    } else if (gameMode === "multi" && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "collision", id: localPlayerId }));
        gameState = "spectator"; 
        leaderboardScreen.classList.remove("hidden"); 
        console.log("Player died in multiplayer, client switched to spectator mode.");
    }
}

function startSinglePlayer() {
    gameMode = "single";
    resizeCanvas(); // Ensure dimensions are current before reset
    resetGame();
    gameState = "playing";
    showScreen("gameCanvas"); 
    scoreDisplay.classList.remove("hidden");
    highScoreDisplay.classList.remove("hidden");
    updateHighScoreDisplay();
    gameLoop();
}

// --- Multiplayer Logic ---
function connectToServer() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("Already connected or connecting.");
        return;
    }
    resizeCanvas(); // Ensure logical dimensions are set before multiplayer logic might need them
    ws = new WebSocket(SERVER_HOST);
    lobbyStatus.textContent = "Connecting to server...";

    ws.onopen = () => {
        console.log("Connected to server");
        localPlayerId = `player_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        bird.id = localPlayerId;
        bird.nickname = nicknameInput.value || "AnonBird";
        localStorage.setItem("flappy_nickname", bird.nickname);
        ws.send(JSON.stringify({ type: "join", nickname: bird.nickname, id: localPlayerId }));
        showScreen("lobbyScreen");
        gameState = "lobby";
        isReady = false;
        updateLobbyUI();
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        lobbyStatus.textContent = "Connection error. Try again?";
        showScreen("mainMenuScreen"); 
        gameState = "menu";
    };

    ws.onclose = () => {
        console.log("Disconnected from server");
        if (gameState !== "menu" && gameState !== "gameOver") {
            alert("Disconnected from server.");
            showScreen("mainMenuScreen");
            gameState = "menu";
        }
        players = {};
        localPlayerId = null;
    };
}

function handleServerMessage(message) {
    switch (message.type) {
        case "lobbyUpdate":
            players = message.players;
            updateLobbyUI();
            break;
        case "startMatch":
            players = message.players; 
            Object.values(players).forEach(p => {
                p.width = BIRD_WIDTH; // Ensure these are set for drawing
                p.height = BIRD_HEIGHT;
                p.angle = p.angle || 0;
                p.frame = p.frame || 0;
            });
            resizeCanvas(); // Ensure dimensions are current
            resetGame(); 
            gameMode = "multi";
            gameState = "countdown";
            startCountdown(message.countdownTime || 3);
            leaderboardScreen.classList.remove("hidden");
            updateLeaderboardUI();
            break;
        case "gameStateUpdate":
            serverStateBuffer.push({ tick: message.tick, players: message.players });
            if (serverStateBuffer.length > 60) serverStateBuffer.shift();
            
            Object.keys(message.players).forEach(playerId => {
                if (playerId !== localPlayerId) {
                    if (!players[playerId]) players[playerId] = {}; 
                    Object.assign(players[playerId], message.players[playerId]);
                }
            });
            updateLeaderboardUI(); 
            break;
        case "playerDied":
            if (players[message.playerId]) {
                players[message.playerId].isDead = true;
                console.log(`${players[message.playerId].nickname} died according to server.`);
                if (message.playerId === localPlayerId && !bird.isDead) {
                    // Server confirms our death, ensure local state matches
                    bird.isDead = true;
                    gameState = "spectator";
                    console.log("Server confirmed death. Switched to spectator mode.");
                }
            }
            updateLeaderboardUI();
            break;
        case "matchOver":
            gameState = "gameOver"; 
            winnerBannerContainer.classList.remove("hidden");
            winnerBanner.textContent = message.winnerNickname ? `${message.winnerNickname} WINS!` : "MATCH OVER!";
            leaderboardScreen.classList.add("hidden");
            setTimeout(() => {
                winnerBannerContainer.classList.add("hidden");
                showScreen("lobbyScreen");
                gameState = "lobby";
                isReady = false; 
                if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resetReady", id: localPlayerId })); 
                updateLobbyUI();
            }, 5000);
            break;
        case "error":
            alert(`Server error: ${message.message}`);
            break;
    }
}

function reconcilePlayerState() {
    if (!CLIENT_PREDICTION || !localPlayerId || !players[localPlayerId] || bird.isDead) return;

    const serverUpdate = serverStateBuffer.find(s => s.tick === clientTick -1); 
    if (serverUpdate && serverUpdate.players[localPlayerId]) {
        const serverPlayerState = serverUpdate.players[localPlayerId];
        const clientPlayerState = bird;
        const diffY = Math.abs(serverPlayerState.y - clientPlayerState.y);
        if (diffY > 5) { 
            bird.y = serverPlayerState.y; 
            bird.velocityY = serverPlayerState.velocityY; 
        }
    }
}

function startCountdown(seconds) {
    showScreen("countdownScreen");
    scoreDisplay.classList.remove("hidden");
    highScoreDisplay.classList.remove("hidden");
    let count = seconds;
    countdownText.textContent = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownText.textContent = count;
        } else {
            clearInterval(interval);
            gameState = "playing";
            showScreen("gameCanvas"); 
            // gameLoop() is already requested by startSinglePlayer or will be by multiplayer logic
        }
    }, 1000);
}

// --- Drawing ---
function drawBird(playerBird) {
    ctx.save();
    ctx.translate(playerBird.x + playerBird.width / 2, playerBird.y + playerBird.height / 2);
    ctx.rotate(playerBird.angle);
    const frameX = (Math.floor(playerBird.frame / 5) % 3) * BIRD_WIDTH; 
    if (assets.spriteSheet && assets.spriteSheet.complete && assets.spriteSheet.naturalWidth > 0) {
        ctx.drawImage(assets.spriteSheet, frameX, 0, BIRD_WIDTH, BIRD_HEIGHT, -playerBird.width / 2, -playerBird.height / 2, playerBird.width, playerBird.height);
    }
    ctx.restore();
    playerBird.frame++;
}

function drawPipes() {
    pipes.forEach(pipe => {
        if (assets.spriteSheet && assets.spriteSheet.complete && assets.spriteSheet.naturalWidth > 0) {
            const pipeAtlasTopSpriteX = 0; 
            const pipeAtlasSpriteY = 24; 
            const pipeAtlasSpriteWidth = 52; 
            const pipeAtlasSpriteHeight = 320; 
            const pipeAtlasBottomSpriteX = pipeAtlasTopSpriteX + pipeAtlasSpriteWidth;

            // Top pipe
            ctx.drawImage(assets.spriteSheet, 
                pipeAtlasTopSpriteX, pipeAtlasSpriteY, pipeAtlasSpriteWidth, pipeAtlasSpriteHeight, 
                pipe.x, pipe.y - pipeAtlasSpriteHeight, PIPE_WIDTH, pipeAtlasSpriteHeight);
            // Bottom pipe
            ctx.drawImage(assets.spriteSheet, 
                pipeAtlasBottomSpriteX, pipeAtlasSpriteY, pipeAtlasSpriteWidth, pipeAtlasSpriteHeight, 
                pipe.x, pipe.y + PIPE_GAP, PIPE_WIDTH, pipeAtlasSpriteHeight);

        } else { 
            ctx.fillStyle = "green";
            ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.y);
            ctx.fillRect(pipe.x, pipe.y + PIPE_GAP, PIPE_WIDTH, LOGICAL_CANVAS_HEIGHT - (pipe.y + PIPE_GAP));
        }
    });
}

function drawBackground() {
    if (assets.spriteSheet && assets.spriteSheet.complete && assets.spriteSheet.naturalWidth > 0) {
        const groundSpriteX = 0;
        const groundSpriteY = 344; 
        const groundSpriteWidth = 336; 
        const groundSpriteHeight = 112; 

        const groundVisualY = LOGICAL_CANVAS_HEIGHT - groundSpriteHeight;
        if (groundVisualY < 0) return; // Don't draw ground if canvas too short

        const groundOffset = (frameCount * PIPE_SPEED) % groundSpriteWidth;
        for (let i = 0; (i * groundSpriteWidth - groundOffset) < LOGICAL_CANVAS_WIDTH; i++) {
            ctx.drawImage(assets.spriteSheet, groundSpriteX, groundSpriteY, groundSpriteWidth, groundSpriteHeight,
                          i * groundSpriteWidth - groundOffset, groundVisualY, groundSpriteWidth, groundSpriteHeight);
        }
    }
}

function drawSpectatorView() {
    let leadBirdToFollow = null;
    const livePlayers = Object.values(players).filter(p => p && !p.isDead && p.id !== localPlayerId);
    if (livePlayers.length > 0) {
        leadBirdToFollow = livePlayers.sort((a,b) => (b.score || 0) - (a.score || 0))[0];
    }

    if (leadBirdToFollow) {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`Spectating: ${leadBirdToFollow.nickname}`, LOGICAL_CANVAS_WIDTH / 2, 30);
    }
     else if (Object.values(players).filter(p => p && !p.isDead).length === 0 && gameState !== "gameOver") {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Waiting for next round...", LOGICAL_CANVAS_WIDTH / 2, 30);
    }
}

// --- Game Loop ---
let lastTime = 0;
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

function gameLoop(timestamp) {
    if (!LOGICAL_CANVAS_WIDTH || !LOGICAL_CANVAS_HEIGHT) {
        console.warn("Canvas logical dimensions not set, skipping game loop frame.");
        requestAnimationFrame(gameLoop);
        return;
    }

    if (gameState !== "playing" && gameState !== "spectator" && gameState !== "countdown") {
        if (gameState === "countdown") { /* Drawing still happens */ } 
        else { return; }
    }

    const deltaTime = timestamp - lastTime;

    if (deltaTime >= frameInterval || !lastTime) { // Also run first frame immediately
        lastTime = timestamp - (deltaTime % frameInterval);

        ctx.clearRect(0, 0, LOGICAL_CANVAS_WIDTH, LOGICAL_CANVAS_HEIGHT); // Clear logical area
        drawBackground();

        if (gameMode === "single") {
            if (!bird.isDead) {
                updateBird();
                updatePipes();
            }
            drawBird(bird);
            drawPipes();
        } else if (gameMode === "multi") {
            clientTick++;
            if (!bird.isDead && gameState === "playing") {
                if (CLIENT_PREDICTION) {
                    updateBird(); 
                    reconcilePlayerState(); 
                }
                updatePipes(); // Client manages its own pipes for visuals/prediction
            }

            Object.values(players).forEach(p => {
                if (p && p.id === localPlayerId) {
                    if (!CLIENT_PREDICTION && serverStateBuffer.length > 0) {
                        const latestServerStateForPlayer = serverStateBuffer[serverStateBuffer.length-1].players[localPlayerId];
                        if (latestServerStateForPlayer) Object.assign(bird, latestServerStateForPlayer);
                    }
                    if(!bird.isDead) drawBird(bird); 
                } else if (p && serverStateBuffer.length > 0) {
                    const latestServerStateForPlayer = serverStateBuffer[serverStateBuffer.length-1].players[p.id];
                    if (latestServerStateForPlayer) {
                        if (!p.hasOwnProperty("width")) { 
                            Object.assign(p, {width: BIRD_WIDTH, height: BIRD_HEIGHT, angle:0, frame:0}, latestServerStateForPlayer);
                        } else {
                            Object.assign(p, latestServerStateForPlayer);
                        }
                        if (!p.isDead) drawBird(p);
                    }
                }
            });
            drawPipes(); 

            if (gameState === "spectator") {
                drawSpectatorView();
            }
        }
        frameCount++;
    }

    if (gameState === "playing" || gameState === "spectator" || gameState === "countdown") {
        requestAnimationFrame(gameLoop);
    }
}

// --- Event Listeners ---
function handleCanvasClick(event) {
    if (!firstUserGesture) {
        firstUserGesture = true;
        initAudio();
    }
    const targetElement = event.target;
    if (targetElement.tagName === "BUTTON" || targetElement.tagName === "INPUT" || targetElement.closest("button") || targetElement.closest("input")) {
        return; 
    }
    if (gameState === "playing" || gameState === "countdown") {
        event.preventDefault(); 
    }
    flap(); 
}

function handleKeyPress(event) {
    if (event.code === "Space" || event.key === " ") {
        if (!firstUserGesture) { firstUserGesture = true; initAudio(); }
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === "INPUT") return; // Don't flap if typing in input
        event.preventDefault();
        flap();
    }
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    LOGICAL_CANVAS_WIDTH = gameContainer.clientWidth;
    LOGICAL_CANVAS_HEIGHT = gameContainer.clientHeight;

    canvas.style.width = `${LOGICAL_CANVAS_WIDTH}px`;
    canvas.style.height = `${LOGICAL_CANVAS_HEIGHT}px`;

    canvas.width = Math.floor(LOGICAL_CANVAS_WIDTH * dpr);
    canvas.height = Math.floor(LOGICAL_CANVAS_HEIGHT * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // If game is active, might need to redraw or adjust elements
    if (gameState === "playing" || gameState === "spectator" || gameState === "countdown" || gameState === "gameOver") {
        // For simplicity, let the game loop handle redraw. 
        // If bird position was relative to old logical size, it might need update here.
        // However, resetGame() called at game start should use new logical sizes.
    }
}

// --- Initialization ---
window.addEventListener("DOMContentLoaded", () => {
    resizeCanvas(); // Initial resize to set logical dimensions
    initDB(); 
    loadAssets(); 

    playSinglePlayerButton.addEventListener("click", () => {
        if (!assetsLoaded) { alert("Assets still loading!"); return; }
        if (!firstUserGesture) { firstUserGesture = true; initAudio(); }
        bird.nickname = nicknameInput.value || "Player";
        localStorage.setItem("flappy_nickname", bird.nickname);
        startSinglePlayer();
    });

    multiplayerButton.addEventListener("click", () => {
        if (!assetsLoaded) { alert("Assets still loading!"); return; }
        if (!firstUserGesture) { firstUserGesture = true; initAudio(); }
        bird.nickname = nicknameInput.value || "AnonBird";
        if (!bird.nickname) {
            alert("Please enter a nickname for multiplayer.");
            nicknameInput.focus();
            return;
        }
        localStorage.setItem("flappy_nickname", bird.nickname);
        connectToServer();
    });

    readyButton.addEventListener("click", () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            isReady = !isReady;
            ws.send(JSON.stringify({ type: "ready", isReady: isReady, id: localPlayerId }));
            readyButton.textContent = isReady ? "Cancel Ready" : "Ready";
            readyButton.disabled = true; 
        }
    });

    restartSinglePlayerButton.addEventListener("click", () => {
        startSinglePlayer();
    });

    backToMenuButton.addEventListener("click", () => {
        showScreen("mainMenuScreen");
        gameState = "menu";
    });

    gameContainer.addEventListener("touchstart", handleCanvasClick, { passive: false }); 
    document.addEventListener("keydown", handleKeyPress);
    window.addEventListener("resize", resizeCanvas);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
        console.log("Reduced motion preferred. Adjust animations accordingly.");
    }

    if (!assetsLoaded) {
        showScreen("mainMenuScreen"); 
        loadingStatus.classList.remove("hidden");
    } else {
        showScreen("mainMenuScreen");
        gameState = "menu";
    }
    // Ensure canvas is sized correctly after all UI is potentially laid out
    requestAnimationFrame(() => {
        resizeCanvas();
        if(gameState === "menu" && LOGICAL_CANVAS_HEIGHT > 0 && bird.y === 150) { // If bird y is still default
             bird.y = LOGICAL_CANVAS_HEIGHT / 2 - bird.height / 2; // Pre-position for first game
        }
    });
});

console.log("main.js loaded (v2 - scaling fixes)");

