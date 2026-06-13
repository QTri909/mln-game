import Phaser from "phaser";
import { OfflineClient, getStateCallbacks } from "./offlineClient.js";
import "./style.css";

const PLAYER_RADIUS = 18;
const NORMAL_SPEED = 190;
const TIRED_SPEED = 55;
const TEAM_A_COLOR = 0xaec3e5;
const TEAM_B_COLOR = 0xf2a3a3;
const LOBBY_COLOR = 0xaebed6;
const OUTLINE_COLOR = 0x101722;
const BODY_WIDTH = 84;
const BODY_HEIGHT = 54;
const BODY_RADIUS = 27;
const OUTLINE_WIDTH = 5;
const FOOT_WIDTH = 28;
const FOOT_HEIGHT = 22;

let activeScene = null;

const ui = {
  homePage: document.getElementById("home-page"),
  startPlayButtons: document.querySelectorAll("[data-start-play]"),
  backHome: document.getElementById("back-home"),
  lobbyPanel: document.getElementById("lobby-panel"),
  playerName: document.getElementById("player-name"),
  roomCodeInput: document.getElementById("room-code-input"),
  createRoom: document.getElementById("create-room"),
  joinRoom: document.getElementById("join-room"),
  connectionStatus: document.getElementById("connection-status"),
  roomBox: document.getElementById("room-box"),
  roomCode: document.getElementById("room-code"),
  playersList: document.getElementById("players-list"),
  startGame: document.getElementById("start-game"),
  hud: document.getElementById("hud"),
  hudName: document.getElementById("hud-name"),
  hudRoom: document.getElementById("hud-room"),
  hudCount: document.getElementById("hud-count"),
  hudTeam: document.getElementById("hud-team"),
  hudRole: document.getElementById("hud-role"),
  hudTimer: document.getElementById("hud-timer"),
  manaBar: document.getElementById("mana-bar"),
  respawnStatus: document.getElementById("respawn-status"),
  questionButton: document.getElementById("question-button"),
  questionModal: document.getElementById("question-modal"),
  questionText: document.getElementById("question-text"),
  questionOptions: document.getElementById("question-options"),
  questionFeedback: document.getElementById("question-feedback"),
  gimHeader: document.getElementById("gim-header"),
  gimBottomBar: document.getElementById("gim-bottom-bar"),
  gimSideActions: document.getElementById("gim-side-actions"),
  gimStatusText: document.getElementById("gim-status-text"),
};

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.client = new OfflineClient();
    this.room = null;
    this.myPlayerId = ""; // Persistent ID stored in localStorage
    this.players = new Map();
    this.obstacles = new Map();
    this.cachedObstacles = [];  // Flat array for fast per-frame collision checks
    this.decorationLayer = null;
    this.mapGraphics = null;
    this.floorTiles = null;
    this.keys = null;
    this.keyQ = null;
    this.lastInputSent = 0;
    this.mapDrawn = false;
    this.lastMana = 100;
    this.cameraTargetX = 0;
    this.cameraTargetY = 0;
    this.lastHudSync = 0;
    this.hudSnapshot = {};
    this.lobbyPlayersSnapshot = "";
    this.lastRoleTimerCeil = null;
    this.cooldownInterval = null;
  }

  create() {
    activeScene = this;

    this.createPatternTexture();

    this.cameras.main.setBackgroundColor("#14213d");
  }

  createPatternTexture() {
    createMapTexture(this);
    this.scale.on("resize", (size) => {
      this.cameras.main.setSize(size.width, size.height);
    });

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      arrowUp: Phaser.Input.Keyboard.KeyCodes.UP,
      arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN,
      arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });
    this.keyQ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    this.mapGraphics = this.add.graphics();

    ui.startPlayButtons.forEach((button) => {
      button.addEventListener("click", () => {
        ui.homePage?.classList.add("hidden");
        ui.lobbyPanel.classList.remove("hidden");
        document.body.classList.remove("home-active");
      });
    });
    ui.backHome?.addEventListener("click", () => {
      ui.lobbyPanel.classList.add("hidden");
      ui.homePage?.classList.remove("hidden");
      document.body.classList.add("home-active");
      history.replaceState(null, "", window.location.pathname + window.location.search);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    ui.createRoom.addEventListener("click", () => this.createRoom());
    ui.joinRoom.addEventListener("click", () => this.joinRoom());
    ui.startGame.addEventListener("click", () => {
      const select = document.getElementById("game-duration");
      const duration = select ? parseInt(select.value) : 180;
      this.room?.send("start_game", { duration });
    });
    ui.questionButton.addEventListener("click", () => this.requestQuestion());

    const playAgainBtn = document.getElementById("results-play-again");
    if (playAgainBtn) {
      playAgainBtn.addEventListener("click", () => {
        this.room?.send("play_again");
      });
    }

    const returnLobbyBtn = document.getElementById("results-return-lobby");
    if (returnLobbyBtn) {
      returnLobbyBtn.addEventListener("click", () => {
        this.room?.send("return_lobby");
      });
    }

    const durationSelect = document.getElementById("game-duration");
    if (durationSelect) {
      durationSelect.addEventListener("change", (e) => {
        this.room?.send("update_settings", { duration: parseInt(e.target.value) });
      });
    }
  }

  async createRoom() {
    const playerId = getOrCreatePlayerId();
    await this.connect(() => this.client.create("offline_game", { name: getPlayerName(), playerId }));
  }

  async joinRoom() {
    const playerId = getOrCreatePlayerId();
    await this.connect(() => this.client.joinById("OFFLINE", { name: getPlayerName(), playerId }));
  }

  async connect(joinAction) {
    try {
      ui.connectionStatus.textContent = "Đang kết nối...";
      this.room = await joinAction();
      this.myPlayerId = getOrCreatePlayerId();
      this.bindRoom();
      ui.connectionStatus.textContent = "Đã vào phòng.";
      ui.lobbyPanel.classList.add("hidden");
      ui.gimHeader.classList.remove("hidden");
      ui.gimBottomBar.classList.remove("hidden");
      ui.gimSideActions.classList.remove("hidden");
      ui.hud.classList.remove("hidden");
    } catch (error) {
      ui.connectionStatus.textContent = "Không thể mở chế độ offline.";
      console.error(error);
    }
  }

  bindRoom() {
    const $ = getStateCallbacks(this.room);

    this.room.onMessage("room_info", (data) => {
      ui.roomCode.textContent = data.roomCode;
      ui.hudRoom.textContent = data.roomCode;
      ui.startGame.classList.toggle("hidden", !data.isHost);
    });

    this.room.onMessage("question", (data) => {
      if (this.cooldownInterval) {
        clearInterval(this.cooldownInterval);
        this.cooldownInterval = null;
      }
      showQuestion(data);
    });
    this.room.onMessage("question_result", (data) => this.showQuestionResult(data));
    this.room.onMessage("question_cooldown", (data) => {
      if (this.cooldownInterval) clearInterval(this.cooldownInterval);

      let secondsLeft = data.seconds;
      ui.questionFeedback.textContent = `Chờ ${secondsLeft}s để trả lời tiếp.`;

      this.cooldownInterval = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearInterval(this.cooldownInterval);
          this.cooldownInterval = null;
          ui.questionFeedback.textContent = "";
          this.room?.send("request_question");
        } else {
          ui.questionFeedback.textContent = `Chờ ${secondsLeft}s để trả lời tiếp.`;
        }
      }, 1000);
    });

    let initialized = false;
    this.room.onStateChange(() => {
      if (initialized) return;
      initialized = true;
      this.syncRoomUi();
      this.drawMapOnce();
      this.room.state.obstacles.forEach((obstacle, id) => this.addObstacle(obstacle, id));
      this.room.state.players.forEach((player, playerId) => this.addPlayer(player, playerId, $));
    });

    $(this.room.state).listen("phase", (phase) => {
      const playing = phase === "playing";
      const finished = phase === "finished";
      const lobby = phase === "lobby";

      ui.gimHeader.classList.toggle("hidden", playing || finished);
      ui.gimBottomBar.classList.toggle("hidden", playing || finished);
      ui.gimSideActions.classList.toggle("hidden", playing || finished);

      const scoreBar = document.getElementById("gim-score-bar");
      if (scoreBar) scoreBar.classList.toggle("hidden", !playing);

      const resultsModal = document.getElementById("results-modal");
      if (resultsModal) resultsModal.classList.toggle("hidden", !finished);

      if (finished) {
        this.showGameResults();
      }

      ui.hud.classList.toggle("hidden", finished);
      this.showStatus(playing ? "Trò chơi bắt đầu!" : (lobby ? "Đang đợi người chơi..." : "Trò chơi kết thúc!"));
      if (playing) this.flashCenterText("Đã phân vai trò!");

      if (!playing) {
        ui.questionModal.classList.add("hidden");
        if (this.cooldownInterval) {
          clearInterval(this.cooldownInterval);
          this.cooldownInterval = null;
        }
      }
    });

    $(this.room.state).listen("roomCode", (code) => {
      ui.roomCode.textContent = code;
      ui.hudRoom.textContent = code;
    });

    $(this.room.state).listen("hostId", () => this.syncRoomUi());
    $(this.room.state).listen("playerCount", (count) => {
      ui.hudCount.textContent = String(count);
      this.renderLobbyPlayers();
    });
    $(this.room.state).listen("roleTimer", (timer) => {
      const roundedTimer = Math.ceil(timer);
      ui.hudTimer.textContent = String(roundedTimer);
      if (roundedTimer === 30 && this.lastRoleTimerCeil !== 30 && this.room.state.phase === "playing") {
        this.flashCenterText("Đổi phe!");
      }
      this.lastRoleTimerCeil = roundedTimer;
    });
    $(this.room.state).listen("gameDuration", (duration) => {
      const select = document.getElementById("game-duration");
      if (select) select.value = String(duration);
    });

    $(this.room.state.obstacles).onAdd((obstacle, id) => this.addObstacle(obstacle, id));
    $(this.room.state.players).onAdd((player, playerId) => {
      this.addPlayer(player, playerId, $);
      this.renderLobbyPlayers();
    });
    $(this.room.state.players).onRemove((_player, playerId) => {
      const view = this.players.get(playerId);
      if (view) view.container.destroy();
      this.players.delete(playerId);
      this.renderLobbyPlayers();
    });
  }

  syncRoomUi() {
    if (!this.room?.state) return;
    ui.roomCode.textContent = this.room.state.roomCode || this.room.roomId || "------";
    ui.hudRoom.textContent = this.room.state.roomCode || this.room.roomId || "------";

    const isHost = this.room.state.hostId === this.myPlayerId;
    ui.startGame.classList.toggle("hidden", !isHost);
    this.showStatus(isHost ? "Bạn là chủ phòng. Bắt đầu khi sẵn sàng!" : "Đợi chủ phòng bắt đầu...");
    
    const select = document.getElementById("game-duration");
    if (select) select.disabled = !isHost;

    this.renderLobbyPlayers();
  }

  drawMapOnce() {
    if (this.mapDrawn || !this.room?.state) return;
    this.mapDrawn = true;

    const { mapWidth, mapHeight } = this.room.state;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.mapGraphics.clear();
    this.mapGraphics.setDepth(-15);

    const textureKey = createMapTexture(this);
    this.floorTiles = this.add.tileSprite(mapWidth / 2, mapHeight / 2, mapWidth, mapHeight, textureKey);
    this.floorTiles.setDepth(-20);

    this.drawFloorZone(120, 120, 1100, 760, 0x666b72, 0x25282d);
    this.drawFloorZone(1460, 150, 1120, 660, 0x737880, 0x282c31);
    this.drawFloorZone(2780, 240, 880, 780, 0x686e76, 0x23262b);
    this.drawFloorZone(360, 1180, 1180, 780, 0x71777f, 0x262a2f);
    this.drawFloorZone(1780, 1160, 1400, 900, 0x676d75, 0x22262b);
    this.drawFloorZone(960, 2260, 2100, 520, 0x757a82, 0x2a2e33);

    // Thick rounded orange boundary with black inline
    this.mapGraphics.lineStyle(16, 0xf59e0b, 1);
    this.mapGraphics.strokeRoundedRect(16, 16, mapWidth - 32, mapHeight - 32, 40);
    this.mapGraphics.lineStyle(6, OUTLINE_COLOR, 1);
    this.mapGraphics.strokeRoundedRect(22, 22, mapWidth - 44, mapHeight - 44, 34);

    this.drawPatternDots(mapWidth, mapHeight);
    this.addDecorations();

    // Cache obstacle list as plain array - avoids MapSchema proxy overhead each frame
    this.cachedObstacles = [];
    this.room.state.obstacles.forEach((obs) => this.cachedObstacles.push(obs));

    // --- BAKE all static Graphics into a single RenderTexture ---
    // This eliminates ~81 Graphics objects that Phaser re-submits vertex data
    // for every frame (batchLine/batchTri/batchStrokePath = 17.6% of CPU).
    // After baking: 1 texture draw per frame instead of ~81 vector draws.
    this._bakeStaticGraphics(mapWidth, mapHeight);
  }

  _bakeStaticGraphics(mapWidth, mapHeight) {
    // Collect all static game objects to bake into one texture
    const toBake = [];

    // Snapshot the children list (we'll be destroying items)
    const snapshot = [...this.children.list];
    for (const child of snapshot) {
      if (child === this.floorTiles) continue; // keep as tileSprite
      const d = child.depth;
      const t = child.type;
      // mapGraphics (depth -15), obstacle containers (depth 2),
      // decoration shadows (depth 3), decoration props (depth 4),
      // sign text (depth 4.5)
      if (d >= -15 && d <= 4.5 && (t === "Graphics" || t === "Text" || t === "Container")) {
        toBake.push(child);
      }
    }

    if (toBake.length === 0) return;

    // Sort by depth so they render in correct order
    toBake.sort((a, b) => a.depth - b.depth);

    // Create RenderTexture the size of the map
    const rt = this.add.renderTexture(0, 0, mapWidth, mapHeight);
    rt.setOrigin(0, 0);
    rt.setDepth(-10); // Above floor tiles (-20), below players (20)

    // Draw all static objects into the RenderTexture
    rt.beginDraw();
    for (const obj of toBake) {
      rt.batchDraw(obj);
    }
    rt.endDraw();

    // Destroy the original objects — they are baked now
    for (const obj of toBake) {
      obj.destroy();
    }

    // Clear references to destroyed objects
    this.mapGraphics = null;
    this.obstacles.clear();
  }

  drawFloorZone(x, y, width, height, fill, stroke) {
    this.mapGraphics.lineStyle(14, 0x231b2d, 0.65);
    this.mapGraphics.strokeRoundedRect(x, y, width, height, 36);
    
    this.mapGraphics.lineStyle(5, stroke, 1);
    this.mapGraphics.fillStyle(fill, 1);
    this.mapGraphics.fillRoundedRect(x, y, width, height, 36);
    this.mapGraphics.strokeRoundedRect(x, y, width, height, 36);
    
    // 3. Draw inner shadow (darken the edges)
    this.mapGraphics.lineStyle(8, 0x000000, 0.1);
    this.mapGraphics.strokeRoundedRect(x + 4, y + 4, width - 8, height - 8, 32);
  }

  drawPatternDots(mapWidth, mapHeight) {
    // Kept as a no-op: the repeated floor pattern is pre-rendered in createMapTexture().
  }

  addDecorations() {
    const props = [
      ["plant", 340, 350], ["plant", 2240, 420], ["plant", 3500, 700], ["plant", 700, 2500],
      ["desk", 760, 650], ["desk", 1550, 520], ["desk", 2480, 1700], ["desk", 3100, 2420],
      ["sign", 1180, 280, "MLN"], ["sign", 1980, 1240, "QUIZ"], ["sign", 3380, 360, "TEAM"],
      ["machine", 440, 1540], ["machine", 2860, 520], ["machine", 1800, 2500],
      ["box", 1260, 1720], ["box", 3360, 1420], ["box", 540, 2260],
    ];

    for (const prop of props) {
      const [type, x, y, text] = prop;
      if (type === "plant") this.drawPlant(x, y);
      if (type === "desk") this.drawDesk(x, y);
      if (type === "sign") this.drawSign(x, y, text);
      if (type === "machine") this.drawMachine(x, y);
      if (type === "box") this.drawBox(x, y);
    }
  }

  addObstacle(obstacle, id) {
    if (this.obstacles.has(id)) return;
    this.obstacles.set(id, createObstacleView(this, obstacle, id));
  }

  addPlayer(player, playerId, $) {
    if (this.players.has(playerId)) return;

    const view = createPlayerView(this, player);
    view.targetX = player.x;
    view.targetY = player.y;
    view.player = player;
    const container = view.container;
    this.players.set(playerId, view);

    if (playerId === this.myPlayerId) {
      container.setPosition(player.x, player.y);
      this.snapCameraToPlayer(player.x, player.y);
      this.cameras.main.setZoom(1);
    }

    this.spawnPop(container);

    $(player).onChange(() => {
      // Snap immediately on large teleports (game start → spawn, respawn after tag)
      const jumpDist = Math.hypot(player.x - view.targetX, player.y - view.targetY);
      if (jumpDist > 200) {
        view.container.setPosition(player.x, player.y);
        if (playerId === this.myPlayerId) this.snapCameraToPlayer(player.x, player.y);
      }

      view.targetX = player.x;
      view.targetY = player.y;
      if (view.label.text !== player.name) view.label.setText(player.name);
      const crownText = player.isHost ? "♛" : "";
      if (view.crown.text !== crownText) view.crown.setText(crownText);

      if (view.lastAlive && !player.alive) this.tagBurst(player.x, player.y);
      if (!view.lastAlive && player.alive) {
        view.container.setPosition(player.x, player.y);
        view.targetX = player.x;
        view.targetY = player.y;
        if (playerId === this.myPlayerId) this.snapCameraToPlayer(player.x, player.y);
        this.spawnPop(view.container);
      }
      if (view.lastRole && view.lastRole !== player.role) this.rolePulse(view.container);

      view.lastAlive = player.alive;
      view.lastRole = player.role;
      this.renderLobbyPlayers();
    });
  }

  renderLobbyPlayers() {
    if (!this.room?.state?.players) return;
    const rows = [];
    const snapshotParts = [];
    this.room.state.players.forEach((player) => {
      const crown = player.isHost ? "♛" : "";
      const team = player.team ? `Đội ${player.team}` : "Phòng chờ";
      snapshotParts.push(`${player.name}:${player.isHost}:${player.team}`);
      rows.push(`<div><b>${crown} ${escapeHtml(player.name)}</b><span>${team}</span></div>`);
    });
    const snapshot = snapshotParts.join("|");
    if (snapshot === this.lobbyPlayersSnapshot) return;
    this.lobbyPlayersSnapshot = snapshot;
    ui.playersList.innerHTML = rows.join("");
  }

  requestQuestion() {
    if (!this.room || this.room.state.phase !== "playing") return;
    ui.questionFeedback.textContent = "";
    ui.questionModal.classList.remove("hidden");
    ui.questionText.textContent = "Đang lấy câu hỏi...";
    ui.questionOptions.innerHTML = "";
    this.room.send("request_question");
  }

  update(time, delta) {
    if (!this.room) return;

    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      this.requestQuestion();
    }

    // Send input every ~33ms (≈30Hz) for lower latency
    if (time - this.lastInputSent > 33) {
      this.room.send("input", {
        up: this.keys.up.isDown || this.keys.arrowUp.isDown,
        down: this.keys.down.isDown || this.keys.arrowDown.isDown,
        left: this.keys.left.isDown || this.keys.arrowLeft.isDown,
        right: this.keys.right.isDown || this.keys.arrowRight.isDown,
      });
      this.lastInputSent = time;
    }

    const localInputMoving =
      this.keys.up.isDown || this.keys.arrowUp.isDown ||
      this.keys.down.isDown || this.keys.arrowDown.isDown ||
      this.keys.left.isDown || this.keys.arrowLeft.isDown ||
      this.keys.right.isDown || this.keys.arrowRight.isDown;

    this.players.forEach((view, playerId) => {
      const previousX = view.container.x;
      const previousY = view.container.y;

      if (playerId === this.myPlayerId) {
        // Local Player - Client-Side Prediction (no soft reconciliation to avoid pull-back)
        if (view.player.alive && localInputMoving) {
          let dx = 0;
          let dy = 0;
          if (this.keys.up.isDown || this.keys.arrowUp.isDown) dy -= 1;
          if (this.keys.down.isDown || this.keys.arrowDown.isDown) dy += 1;
          if (this.keys.left.isDown || this.keys.arrowLeft.isDown) dx -= 1;
          if (this.keys.right.isDown || this.keys.arrowRight.isDown) dx += 1;

          if (dx !== 0 || dy !== 0) {
            const length = Math.hypot(dx, dy);
            dx /= length;
            dy /= length;

            const speed = view.player.mana > 0 ? NORMAL_SPEED : TIRED_SPEED;
            const dt = delta / 1000;
            const dist = speed * dt;
            const mapWidth = this.room.state.mapWidth;
            const mapHeight = this.room.state.mapHeight;
            const radius = 16;

            // Move X axis with obstacle collision
            if (dx !== 0) {
              const oldX = view.container.x;
              view.container.x = Phaser.Math.Clamp(view.container.x + dx * dist, radius, mapWidth - radius);
              let hit = false;
              for (let i = 0; i < this.cachedObstacles.length; i++) {
                if (clientCircleRectHit(view.container.x, view.container.y, radius, this.cachedObstacles[i])) { hit = true; break; }
              }
              if (hit) view.container.x = oldX;
            }

            // Move Y axis with obstacle collision
            if (dy !== 0) {
              const oldY = view.container.y;
              view.container.y = Phaser.Math.Clamp(view.container.y + dy * dist, radius, mapHeight - radius);
              let hit = false;
              for (let i = 0; i < this.cachedObstacles.length; i++) {
                if (clientCircleRectHit(view.container.x, view.container.y, radius, this.cachedObstacles[i])) { hit = true; break; }
              }
              if (hit) view.container.y = oldY;
            }
            // No soft reconciliation here - large corrections handled by onChange snap (jumpDist > 200)
          }
        } else {
          // Idle or dead: very gently drift toward server position.
          // The server catches up within 1-2 ticks (33-66ms), so we only
          // need a tiny nudge here — prevents the visible snap-back that
          // happened when the old alpha (0.34/frame) yanked the container
          // backward to the stale server pos the instant keys were released.
          const gap = Math.hypot(view.targetX - view.container.x, view.targetY - view.container.y);
          if (gap < 2) {
            // Close enough — snap to avoid micro-jitter
            view.container.x = view.targetX;
            view.container.y = view.targetY;
          } else {
            const followAlpha = 1 - Math.exp(-delta * 0.004);
            view.container.x = Phaser.Math.Linear(view.container.x, view.targetX, followAlpha);
            view.container.y = Phaser.Math.Linear(view.container.y, view.targetY, followAlpha);
          }
        }
      } else {
        // Remote players receive uneven patches over the internet; ease toward
        // each target instead of arriving early and waiting for the next patch.
        const rdx = view.targetX - view.container.x;
        const rdy = view.targetY - view.container.y;
        const rdist = Math.hypot(rdx, rdy);

        if (rdist > 0.1) {
          if (rdist > 220) {
            // Very large gap = respawn/teleport: snap immediately
            view.container.x = view.targetX;
            view.container.y = view.targetY;
          } else {
            const followAlpha = 1 - Math.exp(-delta * 0.016);
            view.container.x = Phaser.Math.Linear(view.container.x, view.targetX, followAlpha);
            view.container.y = Phaser.Math.Linear(view.container.y, view.targetY, followAlpha);
          }
        }
      }

      const movedX = view.container.x - previousX;
      const movedY = view.container.y - previousY;
      const networkMoving = movedX * movedX + movedY * movedY > 0.0064;
      const isMoving = playerId === this.myPlayerId ? localInputMoving || networkMoving : networkMoving;
      updatePlayerView(view, view.player, delta, isMoving, time);
    });

    updateCamera(this, delta);
    this.updateHud(time);
  }

  updateHud(time = 0) {
    if (!this.room?.state?.players) return;
    const me = this.room.state.players.get(this.myPlayerId);
    if (!me) return;

    if (me.mana - this.lastMana >= 20) this.floatText("+30 Mana", 0x14b8a6);
    this.lastMana = me.mana;

    if (time - this.lastHudSync < 100) return;
    this.lastHudSync = time;

    const snapshot = {
      name: me.name || "-",
      room: this.room.state.roomCode || this.room.roomId || "------",
      count: String(this.room.state.playerCount || this.room.state.players.size || 0),
      team: me.team ? `Đội ${me.team}` : "-",
      role: me.role === "Chaser" ? "Người bắt" : (me.role === "Runner" ? "Người chạy" : "-"),
      mana: Math.round(Math.max(0, Math.min(100, me.mana))),
      manaLow: me.mana < 22,
      respawn: me.alive ? "" : `Bị bắt - hồi sinh sau ${Math.ceil(me.respawnLeft)} giây`,
      timer: this.room.state.gameTimer !== undefined ? formatTime(this.room.state.gameTimer) : "",
    };

    if (this.hudSnapshot.name !== snapshot.name) ui.hudName.textContent = snapshot.name;
    if (this.hudSnapshot.room !== snapshot.room) ui.hudRoom.textContent = snapshot.room;
    if (this.hudSnapshot.count !== snapshot.count) ui.hudCount.textContent = snapshot.count;
    if (this.hudSnapshot.team !== snapshot.team) ui.hudTeam.textContent = snapshot.team;
    if (this.hudSnapshot.role !== snapshot.role) ui.hudRole.textContent = snapshot.role;
    if (this.hudSnapshot.mana !== snapshot.mana) ui.manaBar.style.width = `${snapshot.mana}%`;
    if (this.hudSnapshot.manaLow !== snapshot.manaLow) ui.manaBar.classList.toggle("low", snapshot.manaLow);
    if (this.hudSnapshot.respawn !== snapshot.respawn) ui.respawnStatus.textContent = snapshot.respawn;

    const matchTimerEl = document.getElementById("hud-match-timer");
    if (matchTimerEl && this.hudSnapshot.timer !== snapshot.timer) {
      matchTimerEl.textContent = snapshot.timer;
    }

    // Calculate team scores
    let scoreA = 0;
    let scoreB = 0;
    this.room.state.players.forEach((player) => {
      if (player.team === "A") scoreA += player.score;
      if (player.team === "B") scoreB += player.score;
    });

    const scoreAEl = document.getElementById("score-team-a");
    const scoreBEl = document.getElementById("score-team-b");
    const progressAEl = document.getElementById("score-progress-a");
    const progressBEl = document.getElementById("score-progress-b");

    if (scoreAEl && scoreBEl && progressAEl && progressBEl) {
      if (this.hudSnapshot.scoreA !== scoreA) scoreAEl.textContent = String(scoreA);
      if (this.hudSnapshot.scoreB !== scoreB) scoreBEl.textContent = String(scoreB);

      const total = scoreA + scoreB;
      if (total === 0) {
        if (this.hudSnapshot.progressA !== 50) {
          progressAEl.style.width = "50%";
          progressBEl.style.width = "50%";
        }
        snapshot.progressA = 50;
      } else {
        const pctA = (scoreA / total) * 100;
        const roundedPctA = Math.round(pctA);
        if (this.hudSnapshot.progressA !== roundedPctA) {
          progressAEl.style.width = `${pctA}%`;
          progressBEl.style.width = `${100 - pctA}%`;
        }
        snapshot.progressA = roundedPctA;
      }
    }
    snapshot.scoreA = scoreA;
    snapshot.scoreB = scoreB;
    this.hudSnapshot = snapshot;
  }

  showGameResults() {
    if (!this.room?.state) return;

    let scoreA = 0;
    let scoreB = 0;
    this.room.state.players.forEach((player) => {
      if (player.team === "A") scoreA += player.score;
      if (player.team === "B") scoreB += player.score;
    });

    const winnerEl = document.getElementById("results-winner");
    let winningTeam = "";
    if (scoreA > scoreB) {
      winnerEl.textContent = "ĐỘI XANH THẮNG";
      winnerEl.className = "results-winner blue-text";
      winningTeam = "A";
    } else if (scoreB > scoreA) {
      winnerEl.textContent = "ĐỘI ĐỎ THẮNG";
      winnerEl.className = "results-winner red-text";
      winningTeam = "B";
    } else {
      winnerEl.textContent = "HÒA NHAU!";
      winnerEl.className = "results-winner draw-text";
    }

    document.getElementById("results-blue-score").textContent = String(scoreA);
    document.getElementById("results-red-score").textContent = String(scoreB);

    renderTopPlayers(winningTeam, this.room.state.players);

    const isHost = this.room.state.hostId === this.myPlayerId;
    const playAgainBtn = document.getElementById("results-play-again");
    const returnLobbyBtn = document.getElementById("results-return-lobby");
    const waitMsg = document.getElementById("results-wait-message");

    if (playAgainBtn && returnLobbyBtn && waitMsg) {
      playAgainBtn.classList.toggle("hidden", !isHost);
      returnLobbyBtn.classList.toggle("hidden", !isHost);
      waitMsg.classList.toggle("hidden", isHost);
    }
  }

  snapCameraToPlayer(x, y) {
    this.cameraTargetX = x;
    this.cameraTargetY = y;
    this.cameras.main.centerOn(x, y);
  }

  showStatus(text) {
    ui.gimStatusText.textContent = text;
  }

  flashCenterText(text) {
    const label = this.add.text(this.cameras.main.centerX, 92, text, {
      fontFamily: "Lexend, Arial, sans-serif",
      fontSize: "30px",
      fontStyle: "800",
      color: "#ffffff",
      stroke: "#263238",
      strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    this.tweens.add({
      targets: label,
      y: 118,
      alpha: 0,
      duration: 1300,
      ease: "Back.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  floatText(text, color) {
    const label = this.add.text(this.cameras.main.width - 150, 132, text, {
      fontFamily: "Lexend, Arial, sans-serif",
      fontSize: "24px",
      fontStyle: "800",
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: "#ffffff",
      strokeThickness: 5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    this.tweens.add({
      targets: label,
      y: 86,
      alpha: 0,
      duration: 1000,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  spawnPop(container) {
    container.setScale(0.5);
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 260,
      ease: "Back.easeOut",
    });
  }

  rolePulse(container) {
    this.tweens.add({
      targets: container,
      scale: 1.18,
      yoyo: true,
      duration: 180,
      ease: "Sine.easeOut",
    });
  }

  tagBurst(x, y) {
    const particles = [];
    for (let i = 0; i < 12; i += 1) {
      const dot = this.add.circle(x, y, 5, 0xffd166).setDepth(35);
      particles.push(dot);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos((Math.PI * 2 * i) / 12) * 48,
        y: y + Math.sin((Math.PI * 2 * i) / 12) * 48,
        alpha: 0,
        scale: 0.2,
        duration: 420,
        onComplete: () => dot.destroy(),
      });
    }
  }

  showQuestionResult(data) {
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
    ui.questionFeedback.textContent = data.correct
      ? `Chính xác! +${data.rewardMana} Mana`
      : `Sai rồi. Thử lại sau ${data.cooldown} giây.`;
    ui.questionModal.classList.toggle("correct", data.correct);
    ui.questionModal.classList.toggle("wrong", !data.correct);
    if (data.correct) this.floatText(`+${data.rewardMana} Mana`, 0x14b8a6);

    setTimeout(() => {
      ui.questionModal.classList.add("hidden");
      ui.questionModal.classList.remove("correct", "wrong");
    }, data.correct ? 900 : 1500);
  }

  drawPlant(x, y) {
    const shadow = this.add.graphics().setDepth(3);
    shadow.fillStyle(0x000000, 0.15).fillEllipse(x + 4, y + 22, 48, 18);

    const prop = this.add.graphics().setDepth(4);
    prop.fillStyle(0xffc857).fillRoundedRect(x - 15, y + 6, 30, 30, 8);
    prop.lineStyle(4, OUTLINE_COLOR, 1).strokeRoundedRect(x - 15, y + 6, 30, 30, 8);
    prop.fillStyle(0x27ae60).fillCircle(x - 12, y, 18).fillCircle(x + 10, y - 8, 20).fillCircle(x + 18, y + 7, 16);
    prop.lineStyle(4, OUTLINE_COLOR, 1)
        .strokeCircle(x - 12, y, 18)
        .strokeCircle(x + 10, y - 8, 20)
        .strokeCircle(x + 18, y + 7, 16);
  }

  drawDesk(x, y) {
    const shadow = this.add.graphics().setDepth(3);
    shadow.fillStyle(0x000000, 0.15).fillRoundedRect(x - 52, y - 17, 112, 52, 14);

    const prop = this.add.graphics().setDepth(4);
    prop.fillStyle(0xf4a261).fillRoundedRect(x - 56, y - 26, 112, 46, 14);
    prop.lineStyle(5, OUTLINE_COLOR).strokeRoundedRect(x - 56, y - 26, 112, 46, 14);
  }

  drawSign(x, y, text) {
    const shadow = this.add.graphics().setDepth(3);
    shadow.fillStyle(0x000000, 0.15).fillRoundedRect(x - 54, y - 28, 116, 62, 14);

    const prop = this.add.graphics().setDepth(4);
    prop.fillStyle(0xffffff).fillRoundedRect(x - 60, y - 36, 120, 58, 14);
    prop.lineStyle(5, 0x2f7df6).strokeRoundedRect(x - 60, y - 36, 120, 58, 14);

    this.add.text(x, y - 8, text, {
      fontFamily: "Lexend, Arial, sans-serif",
      fontSize: "20px",
      fontStyle: "800",
      color: "#2f3a4a",
    }).setOrigin(0.5).setDepth(4.5);
  }

  drawMachine(x, y) {
    const shadow = this.add.graphics().setDepth(3);
    shadow.fillStyle(0x000000, 0.15).fillRoundedRect(x - 35, y - 34, 82, 86, 18);

    const prop = this.add.graphics().setDepth(4);
    prop.fillStyle(0x7c3aed).fillRoundedRect(x - 42, y - 42, 84, 84, 18);
    prop.lineStyle(5, OUTLINE_COLOR).strokeRoundedRect(x - 42, y - 42, 84, 84, 18);
    prop.fillStyle(0x22d3ee).fillRoundedRect(x - 24, y - 22, 48, 24, 8);
    prop.fillStyle(0xffd166).fillCircle(x - 12, y + 20, 6).fillCircle(x + 12, y + 20, 6);
  }

  drawBox(x, y) {
    const shadow = this.add.graphics().setDepth(3);
    shadow.fillStyle(0x000000, 0.15).fillRoundedRect(x - 28, y - 20, 64, 56, 10);

    const prop = this.add.graphics().setDepth(4);
    prop.fillStyle(0xf97316).fillRoundedRect(x - 32, y - 28, 64, 54, 10);
    prop.lineStyle(4, 0x9a3412).strokeRoundedRect(x - 32, y - 28, 64, 54, 10);
    prop.lineStyle(3, 0xffedd5).lineBetween(x - 32, y - 3, x + 32, y - 3);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#bfe8ff",
  scene: MainScene,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);

function createPlayerView(scene, player) {
  const shadow = scene.add.ellipse(0, 38, 70, 18, 0x000000, 0.3);

  const leftFoot = scene.add.graphics();
  const rightFoot = scene.add.graphics();
  const bodyGroup = scene.add.container(0, 0);
  const chaserGlow = scene.add.graphics();
  const body = scene.add.graphics();
  const highlight = scene.add.graphics();
  const eyes = scene.add.graphics();

  bodyGroup.add([body, highlight, eyes]);

  const roleIcon = scene.add.text(0, -42, "", {
    fontFamily: "Lexend, Arial, sans-serif",
    fontSize: "20px",
  }).setOrigin(0.5);

  const crown = scene.add.text(0, -39, player.isHost ? "♛" : "", {
    fontFamily: "Lexend, Arial, sans-serif",
    fontSize: "10px",
    fontStyle: "900",
    color: "#f6b51d",
    stroke: "#ffffff",
    strokeThickness: 2,
  }).setOrigin(0.5);

  const label = scene.add.text(0, 58, player.name, {
    fontFamily: "Lexend, Arial, sans-serif",
    fontSize: "14px",
    fontStyle: "900",
    color: "#ffffff",
    stroke: "#000000",
    strokeThickness: 5,
  }).setOrigin(0.5);

  const container = scene.add.container(player.x, player.y, [
    shadow,
    chaserGlow,
    leftFoot,
    rightFoot,
    bodyGroup,
    roleIcon,
    crown,
    label,
  ]);
  container.setDepth(20);

  const view = {
    container,
    shadow,
    leftFoot,
    rightFoot,
    bodyGroup,
    chaserGlow,
    body,
    highlight,
    eyes,
    roleIcon,
    crown,
    label,
    targetX: player.x,
    targetY: player.y,
    player,
    walkTime: 0,
    styleKey: "",
    lastAlive: player.alive,
    lastRole: player.role,
  };

  applyPlayerStyle(view, player);
  return view;
}

function updatePlayerView(view, player, delta, isMoving, sceneTime = 0) {
  applyPlayerStyle(view, player);

  const dt = delta / 1000;
  const walking = isMoving && player.alive;
  view.walkTime += dt * (walking ? 12 : 4);

  const leftPhase = Math.sin(view.walkTime);
  const rightPhase = Math.sin(view.walkTime + Math.PI);
  const bob = walking ? Math.abs(Math.sin(sceneTime * 0.014)) * 4 : 0;

  if (walking) {
    view.leftFoot.x = -22 + leftPhase * 8;
    view.leftFoot.y = 33 - Math.max(0, leftPhase) * 5;
    view.leftFoot.rotation = -0.08 + leftPhase * 0.2;

    view.rightFoot.x = 22 + rightPhase * 8;
    view.rightFoot.y = 33 - Math.max(0, rightPhase) * 5;
    view.rightFoot.rotation = 0.08 + rightPhase * 0.2;
  } else {
    view.leftFoot.x += (-22 - view.leftFoot.x) * 0.25;
    view.leftFoot.y += (33 - view.leftFoot.y) * 0.25;
    view.leftFoot.rotation += (-0.08 - view.leftFoot.rotation) * 0.25;

    view.rightFoot.x += (22 - view.rightFoot.x) * 0.25;
    view.rightFoot.y += (33 - view.rightFoot.y) * 0.25;
    view.rightFoot.rotation += (0.08 - view.rightFoot.rotation) * 0.25;
  }

  view.bodyGroup.y = -bob;
  view.roleIcon.y = -44 - bob;

  const hasRole = player.role === "Chaser" || player.role === "Runner";
  if (hasRole && player.alive) {
    view.crown.y = -64 - bob;
  } else {
    view.crown.y = -39 - bob;
  }

  view.label.y = 58 - bob * 0.18;
  const shadowScale = walking ? 1 - bob * 0.035 : 1;
  view.shadow.scaleX = shadowScale;
  view.shadow.scaleY = walking ? 0.92 - bob * 0.015 : 1;

  if (player.role === "Chaser" && player.alive) {
    view.chaserGlow.setAlpha(0.18 + Math.sin(sceneTime / 120) * 0.05);
  } else {
    view.chaserGlow.setAlpha(0);
  }
}

function createMapTexture(scene) {
  const key = "gimkit-floor-pattern";
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.createCanvas(key, 160, 160);
  const ctx = texture.getContext();

  // Gimkit-like rough gray floor texture.
  ctx.fillStyle = "#565b61";
  ctx.fillRect(0, 0, 160, 160);

  // Subtle tile boundary.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 160, 160);

  // Repeating dots/triangles/squares pattern
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  
  // 1. Tiny dots
  ctx.beginPath();
  ctx.arc(30, 30, 3, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.beginPath();
  ctx.arc(110, 110, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 2. Tiny squares
  ctx.fillRect(120, 25, 5, 5);
  ctx.fillRect(40, 105, 4, 4);

  // 3. Tiny triangles
  ctx.beginPath();
  ctx.moveTo(80, 60);
  ctx.lineTo(85, 70);
  ctx.lineTo(75, 70);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(140, 135);
  ctx.lineTo(144, 143);
  ctx.lineTo(136, 143);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
  ctx.beginPath();
  ctx.arc(65, 22, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(18, 82, 4, 4);

  texture.refresh();
  return key;
}

function createObstacleView(scene, obstacle, id = "") {
  const heightOffset = 12;
  const radius = 18;
  const strokeWidth = 5;
  const fill = 0xf04f55;
  const sideFill = shadeColor(fill, -58);
  const topFill = shadeColor(fill, 24);

  const container = scene.add.container(0, 0).setDepth(2);
  const shadow = scene.add.graphics();
  const side = scene.add.graphics();
  const top = scene.add.graphics();
  const highlight = scene.add.graphics();

  shadow.fillStyle(0x000000, 0.18);
  shadow.fillRoundedRect(
    obstacle.x + 8,
    obstacle.y + heightOffset + 10,
    obstacle.width,
    obstacle.height,
    radius
  );

  side.lineStyle(strokeWidth, OUTLINE_COLOR, 1);
  side.fillStyle(sideFill, 1);
  side.fillRoundedRect(
    obstacle.x,
    obstacle.y + heightOffset,
    obstacle.width,
    obstacle.height,
    radius
  );
  side.strokeRoundedRect(
    obstacle.x,
    obstacle.y + heightOffset,
    obstacle.width,
    obstacle.height,
    radius
  );

  top.lineStyle(strokeWidth, OUTLINE_COLOR, 1);
  top.fillStyle(topFill, 1);
  top.fillRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, radius);
  top.strokeRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, radius);

  highlight.lineStyle(3, 0xffffff, 0.34);
  highlight.beginPath();
  highlight.moveTo(obstacle.x + radius, obstacle.y + 8);
  highlight.lineTo(obstacle.x + obstacle.width - radius, obstacle.y + 8);
  highlight.strokePath();
  highlight.beginPath();
  highlight.moveTo(obstacle.x + 8, obstacle.y + radius);
  highlight.lineTo(obstacle.x + 8, obstacle.y + obstacle.height - radius);
  highlight.strokePath();

  container.add([shadow, side, top, highlight]);
  return { container, shadow, side, top, highlight };
}

function applyPlayerStyle(view, player) {
  const styleKey = [
    getPlayerColor(player),
    player.team,
    player.role,
    player.alive,
    player.isHost,
  ].join(":");

  if (view.styleKey === styleKey) return;
  view.styleKey = styleKey;

  const alpha = player.alive ? 1 : 0.42;
  const color = getPlayerColor(player);

  view.container.setAlpha(alpha);
  view.crown.setText(player.isHost ? "♛" : "");

  const hasRole = player.role === "Chaser" || player.role === "Runner";
  if (hasRole && player.alive) {
    view.roleIcon.setText(player.role === "Chaser" ? "👊" : "👟");
  } else {
    view.roleIcon.setText("");
  }

  drawFoot(view.leftFoot, alpha, getFootColor(color));
  drawFoot(view.rightFoot, alpha, getFootColor(color));

  view.chaserGlow.clear();
  if (player.role === "Chaser") {
    view.chaserGlow.fillStyle(0xffd166, 1);
    view.chaserGlow.fillEllipse(0, 38, 76, 18);
  }

  view.body.clear();
  view.body.lineStyle(OUTLINE_WIDTH, OUTLINE_COLOR, alpha);
  view.body.fillStyle(color, alpha);
  view.body.fillRoundedRect(-BODY_WIDTH / 2, -BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, BODY_RADIUS);
  view.body.strokeRoundedRect(-BODY_WIDTH / 2, -BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, BODY_RADIUS);

  view.highlight.clear();

  view.eyes.clear();
  view.eyes.fillStyle(0x000000, alpha);
  view.eyes.fillEllipse(-15, -2, 7, 14);
  view.eyes.fillEllipse(15, -2, 7, 14);
}

function drawFoot(graphics, alpha, color) {
  graphics.clear();
  graphics.lineStyle(OUTLINE_WIDTH, OUTLINE_COLOR, alpha);
  graphics.fillStyle(color, alpha);
  graphics.fillRoundedRect(-FOOT_WIDTH / 2, -FOOT_HEIGHT / 2, FOOT_WIDTH, FOOT_HEIGHT, 9);
  graphics.strokeRoundedRect(-FOOT_WIDTH / 2, -FOOT_HEIGHT / 2, FOOT_WIDTH, FOOT_HEIGHT, 9);
}

function getFootColor(color) {
  const r = Math.max(0, ((color >> 16) & 0xff) - 68);
  const g = Math.max(0, ((color >> 8) & 0xff) - 68);
  const b = Math.max(0, (color & 0xff) - 68);
  return (r << 16) | (g << 8) | b;
}

function shadeColor(color, amount) {
  const r = Phaser.Math.Clamp(((color >> 16) & 0xff) + amount, 0, 255);
  const g = Phaser.Math.Clamp(((color >> 8) & 0xff) + amount, 0, 255);
  const b = Phaser.Math.Clamp((color & 0xff) + amount, 0, 255);
  return (r << 16) | (g << 8) | b;
}

function updateCamera(scene, delta = 16.67) {
  const view = scene.players.get(scene.myPlayerId);
  if (!view || !scene.room?.state) return;

  const camera = scene.cameras.main;
  const mapWidth = scene.room.state.mapWidth || camera.width;
  const mapHeight = scene.room.state.mapHeight || camera.height;
  const halfWidth = camera.width * 0.5;
  const halfHeight = camera.height * 0.5;
  const maxX = Math.max(halfWidth, mapWidth - halfWidth);
  const maxY = Math.max(halfHeight, mapHeight - halfHeight);

  scene.cameraTargetX = Phaser.Math.Clamp(view.container.x, halfWidth, maxX);
  scene.cameraTargetY = Phaser.Math.Clamp(view.container.y, halfHeight, maxY);

  const currentX = camera.scrollX + halfWidth;
  const currentY = camera.scrollY + halfHeight;
  const cameraAlpha = 1 - Math.exp(-delta * 0.0075);
  const nextX = Phaser.Math.Linear(currentX, scene.cameraTargetX, cameraAlpha);
  const nextY = Phaser.Math.Linear(currentY, scene.cameraTargetY, cameraAlpha);

  camera.centerOn(nextX, nextY);
}

function getPlayerName() {
  return ui.playerName.value.trim() || `NguoiChoi_${Math.floor(Math.random() * 1000)}`;
}

// Returns a stable playerId stored in localStorage — survives page refreshes
function getOrCreatePlayerId() {
  const KEY = "mln_player_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

function showQuestion(data) {
  ui.questionModal.classList.remove("hidden", "correct", "wrong");
  ui.questionText.textContent = data.question;
  ui.questionFeedback.textContent = "";
  ui.questionOptions.innerHTML = "";

  data.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.textContent = option;
    button.addEventListener("click", () => {
      activeScene?.room?.send("answer_question", { selectedIndex: index });
    });
    ui.questionOptions.appendChild(button);
  });
}

function getPlayerColor(player) {
  if (player.team === "A") return TEAM_A_COLOR;
  if (player.team === "B") return TEAM_B_COLOR;
  return player.isHost ? 0xffc857 : LOBBY_COLOR;
}

function hashString(value) {
  return String(value).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderTopPlayers(winningTeam, players) {
  let list = [];
  players.forEach((player) => {
    if (!winningTeam || player.team === winningTeam) {
      list.push(player);
    }
  });

  list.sort((a, b) => b.score - a.score);

  const container = document.getElementById("results-top-list");
  if (!container) return;
  container.innerHTML = "";

  const medals = ["🥇", "🥈", "🥉"];
  list.slice(0, 3).forEach((player, idx) => {
    const row = document.createElement("div");
    row.className = "top-player-row";
    row.innerHTML = `
      <span class="player-medal-name">${medals[idx] || "🏅"} ${escapeHtml(player.name)}</span>
      <span class="player-score">${player.score}</span>
    `;
    container.appendChild(row);
  });
}

function clientClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clientCircleRectHit(cx, cy, radius, rect) {
  const nearestX = clientClamp(cx, rect.x, rect.x + rect.width);
  const nearestY = clientClamp(cy, rect.y, rect.y + rect.height);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}
