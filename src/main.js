import Phaser from "phaser";
import { Client, getStateCallbacks } from "colyseus.js";
import "./style.css";

const SERVER_URL = "ws://localhost:2567";
const PLAYER_RADIUS = 18;
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
  gimStatusText: document.getElementById("gim-status-text"),
};

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.client = new Client(SERVER_URL);
    this.room = null;
    this.mySessionId = "";
    this.players = new Map();
    this.obstacles = new Map();
    this.decorationLayer = null;
    this.mapGraphics = null;
    this.floorTiles = null;
    this.keys = null;
    this.keyQ = null;
    this.lastInputSent = 0;
    this.mapDrawn = false;
    this.lastMana = 100;
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
    await this.connect(() => this.client.create("game_room", { name: getPlayerName() }));
  }

  async joinRoom() {
    const code = ui.roomCodeInput.value.trim().toUpperCase();
    if (!code) {
      ui.connectionStatus.textContent = "Nhập mã phòng trước khi vào.";
      return;
    }
    await this.connect(() => this.client.joinById(code, { name: getPlayerName() }));
  }

  async connect(joinAction) {
    try {
      ui.connectionStatus.textContent = "Đang kết nối...";
      this.room = await joinAction();
      this.mySessionId = this.room.sessionId;
      this.bindRoom();
      ui.connectionStatus.textContent = "Đã vào phòng.";
      ui.lobbyPanel.classList.add("hidden");
      ui.gimHeader.classList.remove("hidden");
      ui.gimBottomBar.classList.remove("hidden");
      ui.hud.classList.remove("hidden");
    } catch (error) {
      ui.connectionStatus.textContent = "Không thể vào phòng. Kiểm tra mã phòng hoặc phòng đã đủ.";
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

    this.room.onMessage("question", (data) => showQuestion(data));
    this.room.onMessage("question_result", (data) => this.showQuestionResult(data));
    this.room.onMessage("question_cooldown", (data) => {
      ui.questionFeedback.textContent = `Chờ ${data.seconds}s để trả lời tiếp.`;
    });

    let initialized = false;
    this.room.onStateChange(() => {
      if (initialized) return;
      initialized = true;
      this.syncRoomUi();
      this.drawMapOnce();
      this.room.state.obstacles.forEach((obstacle, id) => this.addObstacle(obstacle, id));
      this.room.state.players.forEach((player, sessionId) => this.addPlayer(player, sessionId, $));
    });

    $(this.room.state).listen("phase", (phase) => {
      const playing = phase === "playing";
      const finished = phase === "finished";
      const lobby = phase === "lobby";

      ui.gimHeader.classList.toggle("hidden", playing || finished);
      ui.gimBottomBar.classList.toggle("hidden", playing || finished);

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
      ui.hudTimer.textContent = String(Math.ceil(timer));
      if (Math.ceil(timer) === 30) this.flashCenterText("Đổi phe!");
    });
    $(this.room.state).listen("gameDuration", (duration) => {
      const select = document.getElementById("game-duration");
      if (select) select.value = String(duration);
    });

    $(this.room.state).obstacles.onAdd((obstacle, id) => this.addObstacle(obstacle, id));
    $(this.room.state).players.onAdd((player, sessionId) => {
      this.addPlayer(player, sessionId, $);
      this.renderLobbyPlayers();
    });
    $(this.room.state).players.onRemove((_player, sessionId) => {
      const view = this.players.get(sessionId);
      if (view) view.container.destroy();
      this.players.delete(sessionId);
      this.renderLobbyPlayers();
    });
  }

  syncRoomUi() {
    if (!this.room?.state) return;
    ui.roomCode.textContent = this.room.state.roomCode || this.room.roomId || "------";
    ui.hudRoom.textContent = this.room.state.roomCode || this.room.roomId || "------";

    const isHost = this.room.state.hostId === this.mySessionId;
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

    this.drawFloorZone(120, 120, 1100, 760, 0x82d9ff, 0x5bc0eb);
    this.drawFloorZone(1460, 150, 1120, 660, 0xffd166, 0xf7b731);
    this.drawFloorZone(2780, 240, 880, 780, 0xff9fb2, 0xff6b8a);
    this.drawFloorZone(360, 1180, 1180, 780, 0xb9fbc0, 0x62d97a);
    this.drawFloorZone(1780, 1160, 1400, 900, 0xd8b4fe, 0xa855f7);
    this.drawFloorZone(960, 2260, 2100, 520, 0xfde68a, 0xfacc15);

    // Thick rounded orange boundary with black inline
    this.mapGraphics.lineStyle(16, 0xf59e0b, 1);
    this.mapGraphics.strokeRoundedRect(16, 16, mapWidth - 32, mapHeight - 32, 40);
    this.mapGraphics.lineStyle(6, OUTLINE_COLOR, 1);
    this.mapGraphics.strokeRoundedRect(22, 22, mapWidth - 44, mapHeight - 44, 34);

    this.drawPatternDots(mapWidth, mapHeight);
    this.addDecorations();
  }

  drawFloorZone(x, y, width, height, fill, stroke) {
    // 1. Draw outer orange/yellow border
    this.mapGraphics.lineStyle(14, 0xf59e0b, 1);
    this.mapGraphics.strokeRoundedRect(x, y, width, height, 36);
    
    // 2. Draw black inline stroke
    this.mapGraphics.lineStyle(6, OUTLINE_COLOR, 1);
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
    this.obstacles.set(id, drawRoundedObstacle(this, obstacle, id));
  }

  addPlayer(player, sessionId, $) {
    if (this.players.has(sessionId)) return;

    const view = createPlayerView(this, player);
    view.targetX = player.x;
    view.targetY = player.y;
    view.player = player;
    const container = view.container;
    this.players.set(sessionId, view);

    if (sessionId === this.mySessionId) {
      container.setPosition(player.x, player.y);
      this.snapCameraToPlayer(player.x, player.y);
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
      this.cameras.main.setZoom(1);
    }

    this.spawnPop(container);

    $(player).onChange(() => {
      view.targetX = player.x;
      view.targetY = player.y;
      view.label.setText(player.name);
      view.crown.setText(player.isHost ? "♛" : "");

      if (view.lastAlive && !player.alive) this.tagBurst(player.x, player.y);
      if (!view.lastAlive && player.alive) {
        view.container.setPosition(player.x, player.y);
        view.targetX = player.x;
        view.targetY = player.y;
        if (sessionId === this.mySessionId) this.snapCameraToPlayer(player.x, player.y);
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
    this.room.state.players.forEach((player) => {
      const crown = player.isHost ? "♛" : "";
      const team = player.team ? `Đội ${player.team}` : "Phòng chờ";
      rows.push(`<div><b>${crown} ${escapeHtml(player.name)}</b><span>${team}</span></div>`);
    });
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

    if (time - this.lastInputSent > 50) {
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

    this.players.forEach((view, sessionId) => {
      const previousX = view.container.x;
      const previousY = view.container.y;
      view.container.x += (view.targetX - view.container.x) * 0.32;
      view.container.y += (view.targetY - view.container.y) * 0.32;
      const networkMoving = Phaser.Math.Distance.Between(previousX, previousY, view.container.x, view.container.y) > 0.08;
      const isMoving = sessionId === this.mySessionId ? localInputMoving || networkMoving : networkMoving;
      updatePlayerView(view, view.player, delta, isMoving, time);
    });

    this.updateHud();
  }

  updateHud() {
    if (!this.room?.state?.players) return;
    const me = this.room.state.players.get(this.mySessionId);
    if (!me) return;

    ui.hudName.textContent = me.name || "-";
    ui.hudRoom.textContent = this.room.state.roomCode || this.room.roomId || "------";
    ui.hudCount.textContent = String(this.room.state.playerCount || this.room.state.players.size || 0);
    ui.hudTeam.textContent = me.team ? `Đội ${me.team}` : "-";
    ui.hudRole.textContent = me.role === "Chaser" ? "Người bắt" : (me.role === "Runner" ? "Người chạy" : "-");
    ui.manaBar.style.width = `${Math.max(0, Math.min(100, me.mana))}%`;
    ui.manaBar.classList.toggle("low", me.mana < 22);
    ui.respawnStatus.textContent = me.alive ? "" : `Bị bắt - hồi sinh sau ${Math.ceil(me.respawnLeft)} giây`;

    if (me.mana - this.lastMana >= 20) this.floatText("+30 Mana", 0x14b8a6);
    this.lastMana = me.mana;

    const matchTimerEl = document.getElementById("hud-match-timer");
    if (matchTimerEl && this.room.state.gameTimer !== undefined) {
      matchTimerEl.textContent = formatTime(this.room.state.gameTimer);
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
      scoreAEl.textContent = String(scoreA);
      scoreBEl.textContent = String(scoreB);

      const total = scoreA + scoreB;
      if (total === 0) {
        progressAEl.style.width = "50%";
        progressBEl.style.width = "50%";
      } else {
        const pctA = (scoreA / total) * 100;
        progressAEl.style.width = `${pctA}%`;
        progressBEl.style.width = `${100 - pctA}%`;
      }
    }
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

    const isHost = this.room.state.hostId === this.mySessionId;
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
  view.walkTime += dt * (isMoving && player.alive ? 13 : 4);

  const leftPhase = Math.sin(view.walkTime);
  const rightPhase = Math.sin(view.walkTime + Math.PI);
  const bob = isMoving && player.alive ? Math.abs(Math.sin(view.walkTime * 2)) * 2 : 0;

  if (isMoving && player.alive) {
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

  const hasRole = player.role === "Chaser" || player.role === "Runner";
  if (hasRole && player.alive) {
    view.roleIcon.y = -44 - bob;
    view.crown.y = -64 - bob;
  } else {
    view.crown.y = -39 - bob;
  }

  view.label.y = 58;
  view.shadow.scaleX = isMoving ? 1 + Math.abs(leftPhase) * 0.08 : 1;
  view.shadow.scaleY = isMoving ? 0.92 : 1;

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

  // Grey background texture
  ctx.fillStyle = "#eef0f2";
  ctx.fillRect(0, 0, 160, 160);

  // Subtle grid lines
  ctx.strokeStyle = "rgba(0, 0, 0, 0.02)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 160, 160);

  // Repeating dots/triangles/squares pattern
  ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
  
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

  texture.refresh();
  return key;
}

function drawRoundedObstacle(scene, obstacle, id = "") {
  // Shadow at depth 1
  const shadow = scene.add.graphics();
  shadow.setDepth(1);
  shadow.fillStyle(0x000000, 0.15);
  shadow.fillRoundedRect(obstacle.x + 9, obstacle.y + 12, obstacle.width, obstacle.height, 18);

  // Wall/Obstacle at depth 2
  const wall = scene.add.graphics();
  wall.setDepth(2);
  const fillColors = [
    0xffadad, // pastel red
    0xffd6a5, // pastel orange
    0xfdffb6, // pastel yellow
    0xcaffbf, // pastel green
    0x9bf6ff, // pastel blue
    0xa0c4ff, // pastel indigo
    0xbdb2ff, // pastel purple
    0xffc6ff  // pastel pink
  ];
  const fill = fillColors[Math.abs(hashString(id)) % fillColors.length];
  
  // Layered strokes:
  // 1. Orange/Yellow outer stroke (11px wide orange outline)
  wall.lineStyle(11, 0xf59e0b, 1);
  wall.strokeRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 18);

  // 2. Black inline (5px stroke) & Pastel fill
  wall.lineStyle(5, OUTLINE_COLOR, 1);
  wall.fillStyle(fill, 1);
  wall.fillRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 18);
  wall.strokeRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 18);

  // 3. Top-left highlight
  wall.fillStyle(0xffffff, 0.28);
  wall.fillRoundedRect(obstacle.x + 14, obstacle.y + 12, Math.max(20, obstacle.width * 0.45), 10, 5);

  return { shadow, wall };
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

function getPlayerName() {
  return ui.playerName.value.trim() || `NguoiChoi_${Math.floor(Math.random() * 1000)}`;
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
