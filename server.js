// server.js - Flappy Bird Royale WebSocket Server

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Game Constants (Server-side) ---
const MAX_PLAYERS = 8;
const SERVER_TICK_RATE = 20; // Hz
const GAME_LOOP_INTERVAL = 1000 / SERVER_TICK_RATE;
const GRAVITY = 0.25; // Should match client for consistency if client predicts accurately
const FLAP_STRENGTH = -5.5; // Should match client
const CANVAS_HEIGHT = 512; // Assuming a fixed conceptual game height for server logic
const PIPE_SPEED = 2; // Match client if pipes are client-side, or server dictates pipe movement
const PIPE_WIDTH = 80;
const PIPE_GAP = 150;
const PIPE_SPAWN_INTERVAL_SERVER_TICKS = (120 / (1000 / SERVER_TICK_RATE)); // Approx 120 client frames at 60fps = 4 server ticks at 20Hz if 120 client frames = 2s

// --- Game State (Server-side) ---
let players = {}; // { id: { ws, nickname, x, y, velocityY, angle, isReady, isDead, score, lastFlapTick } }
let gameInterval = null;
let matchState = "lobby"; // lobby, countdown, playing, gameOver
let pipesServer = []; // { x, y (top pipe bottom edge), id }
let nextPipeId = 0;
let pipeSpawnCounter = 0;
let serverTick = 0;

console.log(`WebSocket server starting on port ${PORT}`)

wss.on("connection", (ws) => {
    if (Object.keys(players).length >= MAX_PLAYERS && matchState !== "playing") {
        ws.send(JSON.stringify({ type: "error", message: "Server full." }));
        ws.close();
        return;
    }

    // Generate a unique ID for the player (client should also send its preferred ID)
    // For now, server generates one if not provided or to ensure uniqueness.
    // Client now sends an ID, so we should use that if possible, or manage collisions.
    // ws.id = `player_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // console.log(`Player ${ws.id} connected.`);

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            // console.log(`Received from ${data.id || ws.id}:`, data);

            const playerId = data.id || ws.id; // Prefer ID from client message

            if (data.type === "join") {
                if (Object.keys(players).length >= MAX_PLAYERS && !players[playerId]){
                    ws.send(JSON.stringify({ type: "error", message: "Lobby is full." }));
                    ws.close();
                    return;
                }
                if (players[playerId] && players[playerId].ws !== ws) {
                     // Player rejoining with same ID? Close old, accept new.
                    console.log(`Player ${playerId} reconnected.`);
                    players[playerId].ws.close();
                }
                ws.id = playerId; // Assign ID to the WebSocket connection object
                players[playerId] = {
                    ws: ws,
                    id: playerId,
                    nickname: data.nickname || "AnonBird",
                    x: 50,
                    y: CANVAS_HEIGHT / 2,
                    velocityY: 0,
                    angle: 0,
                    isReady: false,
                    isDead: false,
                    score: 0,
                    lastFlapTick: -1, // Server tick of the last processed flap
                    // Add other necessary player state here
                };
                console.log(`Player ${players[playerId].nickname} (${playerId}) joined.`);
                broadcastLobbyUpdate();
                return; // Return early after join
            }

            // All other messages require player to exist
            if (!players[playerId]) {
                console.warn(`Message from unknown player ID: ${playerId}`);
                return;
            }

            switch (data.type) {
                case "ready":
                    players[playerId].isReady = data.isReady;
                    console.log(`Player ${players[playerId].nickname} is now ${data.isReady ? "Ready" : "Not Ready"}`);
                    broadcastLobbyUpdate();
                    checkStartGame();
                    break;
                case "flap":
                    // Prevent spamming flaps by checking server tick
                    if (matchState === "playing" && !players[playerId].isDead && data.tick > players[playerId].lastFlapTick) {
                        players[playerId].velocityY = FLAP_STRENGTH;
                        players[playerId].lastFlapTick = data.tick; // Use client tick for flap command ordering
                    }
                    break;
                case "collision": // Client reports collision, server validates
                    if (matchState === "playing" && !players[playerId].isDead) {
                        // Server should ideally validate this collision based on its state
                        // For now, we trust the client but this is a simplification
                        console.log(`Player ${players[playerId].nickname} reported collision.`);
                        killPlayer(playerId);
                    }
                    break;
                case "scoreUpdate": // Client reports passing a pipe, server validates
                     if (matchState === "playing" && !players[playerId].isDead) {
                        // Server should validate this score update against its pipe state
                        // For now, accept if it seems reasonable (e.g. score increases by 1)
                        if (data.score > players[playerId].score) {
                            players[playerId].score = data.score;
                        }
                    }
                    break;
                case "resetReady": // Client signals it's back in lobby after match
                    players[playerId].isReady = false;
                    players[playerId].isDead = false;
                    players[playerId].score = 0;
                    broadcastLobbyUpdate();
                    break;
                // Add other message handlers as needed
            }
        } catch (error) {
            console.error("Failed to parse message or handle event:", error);
        }
    });

    ws.on("close", () => {
        const playerId = ws.id;
        if (players[playerId]) {
            console.log(`Player ${players[playerId].nickname} (${playerId}) disconnected.`);
            delete players[playerId];
            if (matchState === "playing") {
                checkGameOver(); // Check if this disconnection ends the game
            }
            broadcastLobbyUpdate();
        }
    });

    ws.on("error", (error) => {
        console.error(`WebSocket error for player ${ws.id}:`, error);
        // Handle disconnection due to error as well
        const playerId = ws.id;
        if (players[playerId]) {
            console.log(`Player ${players[playerId].nickname} (${playerId}) disconnected due to error.`);
            delete players[playerId];
            if (matchState === "playing") {
                checkGameOver();
            }
            broadcastLobbyUpdate();
        }
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastLobbyUpdate() {
    const lobbyPlayers = {};
    for (const id in players) {
        lobbyPlayers[id] = {
            id: players[id].id,
            nickname: players[id].nickname,
            isReady: players[id].isReady,
            isDead: players[id].isDead, // Good to send this too
            score: players[id].score
        };
    }
    broadcast({ type: "lobbyUpdate", players: lobbyPlayers });
}

function checkStartGame() {
    if (matchState !== "lobby") return;
    const numPlayers = Object.keys(players).length;
    if (numPlayers === 0) return; // No players to start

    const allReady = Object.values(players).every(p => p.isReady);
    if (allReady && numPlayers > 0) { // Could be numPlayers >= 1 for testing, or more for real game
        console.log("All players ready. Starting match...");
        matchState = "countdown";
        serverTick = 0;
        nextPipeId = 0;
        pipesServer = [];
        pipeSpawnCounter = 0;

        Object.values(players).forEach(p => {
            p.isDead = false;
            p.score = 0;
            p.y = CANVAS_HEIGHT / 2;
            p.velocityY = 0;
            p.angle = 0;
            p.lastFlapTick = -1;
        });

        broadcast({ 
            type: "startMatch", 
            players: getPlayerStates(), 
            countdownTime: 3 
        });
        
        // Start game loop after countdown (client handles countdown display)
        setTimeout(() => {
            if (matchState === "countdown") { // Ensure state hasn't changed (e.g. all players left)
                matchState = "playing";
                console.log("Match started!");
                if (gameInterval) clearInterval(gameInterval);
                gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
            }
        }, 3000); // Countdown duration
    }
}

function getPlayerStates() {
    const currentPlayersState = {};
    for (const id in players) {
        currentPlayersState[id] = {
            id: players[id].id,
            nickname: players[id].nickname, // For leaderboard
            x: players[id].x,
            y: players[id].y,
            velocityY: players[id].velocityY,
            angle: players[id].angle,
            isDead: players[id].isDead,
            score: players[id].score
        };
    }
    return currentPlayersState;
}

function updatePlayerPhysics(player) {
    if (player.isDead) return;

    player.velocityY += GRAVITY;
    player.y += player.velocityY;
    player.angle = Math.min(Math.PI / 4, player.velocityY * 0.05); // Consistent with client

    // Server-side boundary collision
    if (player.y + (24/2) > CANVAS_HEIGHT || player.y - (24/2) < 0) { // Assuming bird height 24
        killPlayer(player.id);
    }
}

function updatePipesServer() {
    pipeSpawnCounter++;
    if (pipeSpawnCounter >= PIPE_SPAWN_INTERVAL_SERVER_TICKS) {
        pipeSpawnCounter = 0;
        const pipeY = Math.random() * (CANVAS_HEIGHT - PIPE_GAP - 100) + 50;
        pipesServer.push({ x: CANVAS_HEIGHT * (16/9), y: pipeY, id: nextPipeId++, scoredBy: [] }); // Start pipes off-screen (assuming canvas width related to height)
        // Client needs to know about these pipes. Send pipe data with game state or separately.
    }

    for (let i = pipesServer.length - 1; i >= 0; i--) {
        pipesServer[i].x -= PIPE_SPEED * (GAME_LOOP_INTERVAL / (1000/60)); // Adjust speed based on server tick relative to 60fps client perception
        if (pipesServer[i].x + PIPE_WIDTH < 0) {
            pipesServer.splice(i, 1);
        }
    }
}

function checkCollisions(player) {
    if (player.isDead) return;
    const birdHitbox = {
        x: player.x - (34/2),
        y: player.y - (24/2),
        width: 34,
        height: 24
    };

    pipesServer.forEach(pipe => {
        const topPipeHitbox = { x: pipe.x, y: 0, width: PIPE_WIDTH, height: pipe.y };
        const bottomPipeHitbox = { x: pipe.x, y: pipe.y + PIPE_GAP, width: PIPE_WIDTH, height: CANVAS_HEIGHT - (pipe.y + PIPE_GAP) };

        if (
            (birdHitbox.x < topPipeHitbox.x + topPipeHitbox.width &&
             birdHitbox.x + birdHitbox.width > topPipeHitbox.x &&
             birdHitbox.y < topPipeHitbox.y + topPipeHitbox.height &&
             birdHitbox.y + birdHitbox.height > topPipeHitbox.y) ||
            (birdHitbox.x < bottomPipeHitbox.x + bottomPipeHitbox.width &&
             birdHitbox.x + birdHitbox.width > bottomPipeHitbox.x &&
             birdHitbox.y < bottomPipeHitbox.y + bottomPipeHitbox.height &&
             birdHitbox.y + birdHitbox.height > bottomPipeHitbox.y)
        ) {
            killPlayer(player.id);
            return; // No need to check other pipes if dead
        }

        // Check for scoring (passed pipe)
        if (!pipe.scoredBy.includes(player.id) && pipe.x + PIPE_WIDTH < player.x) {
            player.score++;
            pipe.scoredBy.push(player.id);
            // Client also sends score updates, this is server authoritative version
        }
    });
}

function killPlayer(playerId) {
    if (players[playerId] && !players[playerId].isDead) {
        players[playerId].isDead = true;
        console.log(`Server killed player ${players[playerId].nickname}.`);
        broadcast({ type: "playerDied", playerId: playerId, score: players[playerId].score });
        checkGameOver();
    }
}

function checkGameOver() {
    if (matchState !== "playing") return;

    const alivePlayers = Object.values(players).filter(p => !p.isDead);
    if (alivePlayers.length <= 1 && Object.keys(players).length > 0) { // Game ends if 1 or 0 players left (0 if last one disconnects)
        matchState = "gameOver";
        if (gameInterval) clearInterval(gameInterval);
        gameInterval = null;
        console.log("Match over.");

        let winnerNickname = "No one";
        if (alivePlayers.length === 1) {
            winnerNickname = alivePlayers[0].nickname;
        }
        
        broadcast({ type: "matchOver", winnerNickname: winnerNickname, players: getPlayerStates() });

        // Reset for lobby after a delay
        setTimeout(() => {
            matchState = "lobby";
            Object.values(players).forEach(p => {
                p.isReady = false;
                p.isDead = false;
                p.score = 0;
                // Keep other fields like ws, nickname, id
            });
            pipesServer = [];
            nextPipeId = 0;
            console.log("Returning to lobby.");
            broadcastLobbyUpdate(); 
        }, 5000); // 5 second delay before returning to lobby
    }
}

function gameLoop() {
    serverTick++;
    if (matchState !== "playing") {
        if (gameInterval) clearInterval(gameInterval);
        gameInterval = null;
        return;
    }

    updatePipesServer(); // Update pipe positions and spawn new ones

    for (const id in players) {
        if (players[id]) {
            updatePlayerPhysics(players[id]);
            checkCollisions(players[id]); // Server-authoritative collision
        }
    }

    broadcast({ type: "gameStateUpdate", tick: serverTick, players: getPlayerStates(), pipes: pipesServer });
    // Client will use pipe data for rendering and its own collision prediction if desired

    // Check for game over again in case all players died in the same tick without a winner from previous check
    const alivePlayers = Object.values(players).filter(p => p && !p.isDead);
    if (alivePlayers.length === 0 && Object.keys(players).length > 0 && matchState === "playing") {
         // All died simultaneously
        checkGameOver(); 
    }
}

server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// Graceful shutdown (optional but good practice)
process.on('SIGINT', () => {
    console.log('Server shutting down...');
    if (gameInterval) clearInterval(gameInterval);
    wss.clients.forEach(client => client.close());
    server.close(() => {
        console.log('Server shut down gracefully.');
        process.exit(0);
    });
});

