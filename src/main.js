import Phaser from "phaser";
import { Client, getStateCallbacks } from "colyseus.js";
import "./style.css";

const SERVER_URL = "ws://localhost:2567";
const PLAYER_RADIUS = 16;

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
    this.keys = null;
    this.keyQ = null;
    this.lastInputSent = 0;
    this.mapGraphics = null;
    this.fog = null;
  }

  create() {
    activeScene = this;

    this.cameras.main.setBackgroundColor("#14213d");
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
    this.fog = this.add.graphics();
    this.fog.setScrollFactor(0);
    this.fog.setDepth(1000);
    ui.createRoom.addEventListener("click", () => this.createRoom());
    ui.joinRoom.addEventListener("click", () => this.joinRoom());
    ui.startGame.addEventListener("click", () => this.room?.send("start_game"));
    ui.questionButton.addEventListener("click", () => this.requestQuestion());
  }

  async createRoom() {
    await this.connect(() =>
      this.client.create("game_room", {
        name: getPlayerName(),
      })
    );
  }

  async joinRoom() {
    const code = ui.roomCodeInput.value.trim().toUpperCase();
    if (!code) {
      ui.connectionStatus.textContent = "Nhập mã phòng trước khi join.";
      return;
    }

    await this.connect(() =>
      this.client.joinById(code, {
        name: getPlayerName(),
      })
    );
  }

  async connect(joinAction) {
    try {
      ui.connectionStatus.textContent = "Đang kết nối...";
      this.room = await joinAction();
      this.mySessionId = this.room.sessionId;
      this.bindRoom();
      ui.connectionStatus.textContent = "Đã vào phòng.";
      ui.roomBox.classList.remove("hidden");
      ui.gimHeader.classList.remove("hidden");
      ui.gimBottomBar.classList.remove("hidden");
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
    this.room.onMessage("question_result", (data) => showQuestionResult(data));
    this.room.onMessage("question_cooldown", (data) => {
      ui.questionFeedback.textContent = `Chờ ${data.seconds}s để trả lời tiếp.`;
    });

    let hasInitializedState = false;
    this.room.onStateChange((state) => {
      if (!hasInitializedState) {
        hasInitializedState = true;
        this.syncRoomUi();
      }
    });

    $(this.room.state).listen("phase", (phase) => {
      const playing = phase === "playing";
      ui.lobbyPanel.classList.toggle("hidden", playing);
      ui.gimHeader.classList.toggle("hidden", playing);
      ui.gimBottomBar.classList.toggle("hidden", playing);
      ui.hud.classList.toggle("hidden", !playing);
    });

    $(this.room.state).listen("roomCode", (code) => {
      ui.roomCode.textContent = code;
      ui.hudRoom.textContent = code;
    });

    $(this.room.state).listen("hostId", () => {
      this.syncRoomUi();
    });

    $(this.room.state).listen("playerCount", (count) => {
      ui.hudCount.textContent = String(count);
      this.renderLobbyPlayers();
    });

    $(this.room.state).listen("roleTimer", (timer) => {
      ui.hudTimer.textContent = String(Math.ceil(timer));
    });

    $(this.room.state).obstacles.onAdd((obstacle, id) => this.addObstacle(obstacle, id));
    $(this.room.state).players.onAdd((player, sessionId) => {
      this.addPlayer(player, sessionId, $);
      this.renderLobbyPlayers();
    });
    $(this.room.state).players.onRemove((_player, sessionId) => {
      const view = this.players.get(sessionId);
      if (view) {
        view.container.destroy();
        this.players.delete(sessionId);
      }
      this.renderLobbyPlayers();
    });
  }

  syncRoomUi() {
    if (!this.room || !this.room.state) return;
    ui.roomCode.textContent = this.room.state.roomCode || this.room.roomId || "------";
    ui.hudRoom.textContent = this.room.state.roomCode || this.room.roomId || "------";
    
    const isHost = this.room.state.hostId === this.mySessionId;
    ui.startGame.classList.toggle("hidden", !isHost);
    ui.gimStatusText.textContent = isHost ? "Bạn là Host của phòng này." : "Đang đợi host bắt đầu...";
    
    this.renderLobbyPlayers();
  }

  addObstacle(obstacle, id) {
    if (this.obstacles.has(id)) return;
    
    const colors = [0xa242ff, 0xff6b6b, 0x1070e0, 0xfca311];
    const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fillColor = colors[hash % colors.length];

    const rect = this.add.rectangle(
      obstacle.x + obstacle.width / 2,
      obstacle.y + obstacle.height / 2,
      obstacle.width,
      obstacle.height,
      fillColor
    );
    rect.setStrokeStyle(4, 0xffffff, 1);
    rect.setDepth(5);
    this.obstacles.set(id, rect);
  }

  addPlayer(player, sessionId, $) {
    if (this.players.has(sessionId)) return;

    const charGraphics = this.add.graphics();
    const label = this.add.text(-34, -48, player.name, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.35)",
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    });

    const container = this.add.container(player.x, player.y, [charGraphics, label]);
    container.setDepth(20);

    const view = {
      container,
      charGraphics,
      label,
      targetX: player.x,
      targetY: player.y,
      player,
    };

    this.players.set(sessionId, view);

    if (sessionId === this.mySessionId) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }

    this.drawGimCharacter(charGraphics, getPlayerColor(player), player.role, player.alive);

    $(player).onChange(() => {
      view.targetX = player.x;
      view.targetY = player.y;
      this.drawGimCharacter(charGraphics, getPlayerColor(player), player.role, player.alive);
      this.renderLobbyPlayers();
    });
  }

  renderLobbyPlayers() {
    if (!this.room || !this.room.state || !this.room.state.players) return;
    const rows = [];
    this.room.state.players.forEach((player) => {
      const host = player.isHost ? "Host" : "";
      const team = player.team ? `Team ${player.team}` : "Lobby";
      rows.push(`<div>${escapeHtml(player.name)} <span>${host} ${team}</span></div>`);
    });
    ui.playersList.innerHTML = rows.join("");
  }

  requestQuestion() {
    if (!this.room || this.room.state.phase !== "playing") return;
    ui.questionFeedback.textContent = "";
    this.room.send("request_question");
  }

  update(time) {
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

    this.players.forEach((view) => {
      view.container.x += (view.targetX - view.container.x) * 0.35;
      view.container.y += (view.targetY - view.container.y) * 0.35;
    });

    this.updateHud();
    this.drawMap();
    this.drawFog();
  }

  updateHud() {
    if (!this.room || !this.room.state || !this.room.state.players) return;
    const me = this.room.state.players.get(this.mySessionId);
    if (!me) return;
    ui.hudTeam.textContent = me.team ? `Team ${me.team}` : "-";
    ui.hudRole.textContent = me.role || "-";
    ui.manaBar.style.width = `${Math.max(0, Math.min(100, me.mana))}%`;
    ui.respawnStatus.textContent = me.alive ? "" : `Caught - hồi sinh sau ${Math.ceil(me.respawnLeft)}s`;
  }

  drawMap() {
    if (!this.room || !this.room.state) return;
    const state = this.room.state;
    this.mapGraphics.clear();
    this.mapGraphics.fillStyle(0x2d3436, 1);
    this.mapGraphics.fillRect(0, 0, state.mapWidth, state.mapHeight);

    this.mapGraphics.lineStyle(8, 0x1e272e, 1);
    this.mapGraphics.strokeRect(0, 0, state.mapWidth, state.mapHeight);

    this.mapGraphics.lineStyle(1, 0x4b4c59, 0.25);
    for (let x = 0; x <= state.mapWidth; x += 160) {
      this.mapGraphics.lineBetween(x, 0, x, state.mapHeight);
    }
    for (let y = 0; y <= state.mapHeight; y += 160) {
      this.mapGraphics.lineBetween(0, y, state.mapWidth, y);
    }
  }



  drawGimCharacter(graphics, color, role, alive) {
    graphics.clear();
    const alpha = alive ? 1 : 0.45;

    graphics.fillStyle(0x000000, 0.22);
    graphics.fillEllipse(0, PLAYER_RADIUS + 2, PLAYER_RADIUS * 1.2, 8);

    const outlineColor = 0x111827;
    const thickness = 3;

    const footRadius = 7;
    const footY = PLAYER_RADIUS + 1;
    const leftFootX = -PLAYER_RADIUS * 0.45;
    const rightFootX = PLAYER_RADIUS * 0.45;

    graphics.lineStyle(thickness, outlineColor, alpha);
    graphics.fillStyle(0xd1d5db, alpha);

    graphics.fillCircle(leftFootX, footY, footRadius);
    graphics.strokeCircle(leftFootX, footY, footRadius);

    graphics.fillCircle(rightFootX, footY, footRadius);
    graphics.strokeCircle(rightFootX, footY, footRadius);

    graphics.fillStyle(color, alpha);
    
    const bodyW = PLAYER_RADIUS * 2.2;
    const bodyH = PLAYER_RADIUS * 2.2;
    const bodyX = -bodyW / 2;
    const bodyY = -bodyH / 2 - 2;
    const cornerRadius = 14;

    graphics.fillRoundedRect(bodyX, bodyY, bodyW, bodyH, cornerRadius);
    graphics.strokeRoundedRect(bodyX, bodyY, bodyW, bodyH, cornerRadius);

    const eyeW = 4;
    const eyeH = 8;
    const leftEyeX = -PLAYER_RADIUS * 0.35;
    const rightEyeX = PLAYER_RADIUS * 0.35;
    const eyeY = -PLAYER_RADIUS * 0.15;

    graphics.fillStyle(0x111827, alpha);
    graphics.fillEllipse(leftEyeX, eyeY, eyeW, eyeH);
    graphics.fillEllipse(rightEyeX, eyeY, eyeW, eyeH);

    graphics.fillStyle(0xffffff, alpha);
    graphics.fillCircle(leftEyeX - 1, eyeY - 2, 1);
    graphics.fillCircle(rightEyeX - 1, eyeY - 2, 1);

    if (role === "Chaser") {
      graphics.fillStyle(0xffd166, alpha);
      graphics.lineStyle(2, outlineColor, alpha);

      const crownY = bodyY - 8;
      const points = [
        new Phaser.Geom.Point(-12, crownY + 6),
        new Phaser.Geom.Point(-12, crownY),
        new Phaser.Geom.Point(-6, crownY + 4),
        new Phaser.Geom.Point(0, crownY - 3),
        new Phaser.Geom.Point(6, crownY + 4),
        new Phaser.Geom.Point(12, crownY),
        new Phaser.Geom.Point(12, crownY + 6),
      ];
      graphics.beginPath();
      graphics.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        graphics.lineTo(points[i].x, points[i].y);
      }
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
    }
  }

  drawFog() {
    const me = this.players.get(this.mySessionId);
    if (!me) return;

    const camera = this.cameras.main;
    const screenPoint = camera.getWorldPoint(camera.width / 2, camera.height / 2);
    const playerScreenX = me.container.x - screenPoint.x + camera.width / 2;
    const playerScreenY = me.container.y - screenPoint.y + camera.height / 2;
    const vision = 260;
    const left = Math.max(0, playerScreenX - vision);
    const right = Math.min(camera.width, playerScreenX + vision);
    const top = Math.max(0, playerScreenY - vision);
    const bottom = Math.min(camera.height, playerScreenY + vision);

    this.fog.clear();
    this.fog.fillStyle(0x000000, 0.62);
    this.fog.fillRect(0, 0, camera.width, top);
    this.fog.fillRect(0, bottom, camera.width, camera.height - bottom);
    this.fog.fillRect(0, top, left, bottom - top);
    this.fog.fillRect(right, top, camera.width - right, bottom - top);
    this.fog.lineStyle(46, 0x000000, 0.22);
    this.fog.strokeRect(left, top, right - left, bottom - top);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#14213d",
  scene: MainScene,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);

function getPlayerName() {
  return ui.playerName.value.trim() || `Player_${Math.floor(Math.random() * 1000)}`;
}

function showQuestion(data) {
  ui.questionModal.classList.remove("hidden");
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

function showQuestionResult(data) {
  ui.questionFeedback.textContent = data.correct
    ? `Đúng. +${data.rewardMana} mana.`
    : `Sai. Chờ ${data.cooldown}s để trả lời tiếp.`;

  setTimeout(() => {
    ui.questionModal.classList.add("hidden");
  }, data.correct ? 900 : 1600);
}

function teamColor(team) {
  if (team === "A") return 0x1070e0;
  if (team === "B") return 0xff6b6b;
  return 0xd9d9d9;
}

function roleColor(role) {
  return role === "Chaser" ? 0xffd166 : 0x000000;
}

function hexToNumber(hex) {
  if (!hex) return 0x4aa3ff;
  return parseInt(hex.replace("#", ""), 16);
}

function getPlayerColor(player) {
  if (player.team === "A") return 0x1070e0;
  if (player.team === "B") return 0xff6b6b;
  return hexToNumber(player.color);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
