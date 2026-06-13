import questions from "./questions.json";

const MAP_WIDTH = 4000;
const MAP_HEIGHT = 3000;
const PLAYER_RADIUS = 16;
const ROLE_DURATION = 30;
const TICK_RATE = 30;
const NORMAL_SPEED = 190;
const TIRED_SPEED = 55;
const MANA_MAX = 100;
const MANA_DRAIN_PER_SECOND = 8;
const TAG_DISTANCE = 34;
const RESPAWN_SECONDS = 3;
const QUESTION_COOLDOWN_SECONDS = 3;
const LOBBY_SPAWN = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };

const SPAWNS = {
  A: { x: 900, y: 900 },
  B: { x: 3000, y: 2100 },
};

const OBSTACLES = [
  { id: "wall_01", x: 520, y: 330, width: 440, height: 90 },
  { id: "wall_02", x: 1180, y: 560, width: 110, height: 470 },
  { id: "wall_03", x: 1740, y: 310, width: 620, height: 95 },
  { id: "wall_04", x: 2820, y: 560, width: 130, height: 560 },
  { id: "wall_05", x: 350, y: 1260, width: 620, height: 120 },
  { id: "wall_06", x: 1420, y: 1370, width: 135, height: 520 },
  { id: "wall_07", x: 2060, y: 1250, width: 660, height: 110 },
  { id: "wall_08", x: 3240, y: 1540, width: 150, height: 470 },
  { id: "wall_09", x: 880, y: 2180, width: 560, height: 100 },
  { id: "wall_10", x: 1780, y: 2320, width: 140, height: 420 },
  { id: "wall_11", x: 2520, y: 2240, width: 700, height: 110 },
  { id: "wall_12", x: 3320, y: 720, width: 360, height: 95 },
];

export class OfflineClient {
  async create(_roomName, options = {}) {
    return new OfflineRoom(options);
  }

  async joinById(_roomId, options = {}) {
    return new OfflineRoom(options);
  }
}

export function getStateCallbacks(room) {
  return (target) => ({
    listen: (property, callback) => room.listen(target, property, callback),
    onChange: (callback) => room.listenChange(target, callback),
    get onAdd() {
      return target && typeof target.onAdd === "function" ? target.onAdd.bind(target) : undefined;
    },
    get onRemove() {
      return target && typeof target.onRemove === "function" ? target.onRemove.bind(target) : undefined;
    },
  });
}

class OfflineRoom {
  constructor(options = {}) {
    this.roomId = "OFFLINE";
    this.sessionId = options.playerId || createId();
    this.messageHandlers = new Map();
    this.stateHandlers = [];
    this.propertyHandlers = new WeakMap();
    this.changeHandlers = new WeakMap();
    this.inputs = new Map();
    this.currentQuestions = new Map();
    this.questionCooldownUntil = new Map();
    this.roleElapsed = 0;
    this.lastTick = performance.now();

    this.state = createState();
    for (const obstacle of OBSTACLES) {
      this.state.obstacles.set(obstacle.id, { ...obstacle });
    }

    this.addPlayer({
      id: this.sessionId,
      name: cleanName(options.name || "Player"),
      isHost: true,
      isBot: false,
    });
    this.addPlayer({
      id: "offline_bot",
      name: "Bot MLN",
      isHost: false,
      isBot: true,
    });

    this.state.hostId = this.sessionId;
    this.state.playerCount = 1;
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    setTimeout(() => {
      this.emitMessage("room_info", { roomCode: this.state.roomCode, isHost: true });
      this.emitStateChange();
    }, 0);
  }

  onMessage(type, callback) {
    if (!this.messageHandlers.has(type)) this.messageHandlers.set(type, []);
    this.messageHandlers.get(type).push(callback);
    if (type === "room_info") {
      setTimeout(() => callback({ roomCode: this.state.roomCode, isHost: true }), 0);
    }
  }

  onStateChange(callback) {
    this.stateHandlers.push(callback);
    setTimeout(() => callback(this.state), 0);
  }

  listen(target, property, callback) {
    let handlers = this.propertyHandlers.get(target);
    if (!handlers) {
      handlers = new Map();
      this.propertyHandlers.set(target, handlers);
    }
    if (!handlers.has(property)) handlers.set(property, []);
    handlers.get(property).push({ callback, lastValue: target[property] });
  }

  listenChange(target, callback) {
    if (!this.changeHandlers.has(target)) this.changeHandlers.set(target, []);
    this.changeHandlers.get(target).push(callback);
  }

  send(type, data = {}) {
    if (type === "input") this.handleInput(data);
    if (type === "start_game") this.startGame(data.duration);
    if (type === "update_settings") this.updateSettings(data.duration);
    if (type === "play_again") this.startGame(this.state.gameDuration);
    if (type === "return_lobby") this.returnToLobby();
    if (type === "request_question") this.sendQuestion(this.sessionId);
    if (type === "answer_question") this.checkAnswer(this.sessionId, data);
  }

  addPlayer({ id, name, isHost, isBot }) {
    const player = {
      x: LOBBY_SPAWN.x + (isBot ? 80 : 0),
      y: LOBBY_SPAWN.y,
      name,
      team: "",
      role: "",
      mana: MANA_MAX,
      alive: true,
      respawnLeft: 0,
      score: 0,
      isHost,
      color: "#4aa3ff",
      connected: true,
      playerId: id,
      isBot,
    };
    this.state.players.set(id, player);
    this.inputs.set(id, { up: false, down: false, left: false, right: false });
  }

  handleInput(input) {
    this.inputs.set(this.sessionId, {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    });
  }

  updateSettings(duration) {
    if (this.state.phase !== "lobby" || typeof duration !== "number") return;
    this.state.gameDuration = duration;
    this.state.gameTimer = duration;
    this.emitStateChange();
  }

  startGame(duration = 180) {
    const normalizedDuration = typeof duration === "number" && duration > 0 ? duration : 180;
    const entries = Array.from(this.state.players.entries());
    entries.forEach(([playerId, player], index) => {
      player.team = index % 2 === 0 ? "A" : "B";
      player.role = player.team === "A" ? "Chaser" : "Runner";
      const spawn = SPAWNS[player.team];
      player.x = spawn.x + Math.random() * 80 - 40;
      player.y = spawn.y + Math.random() * 80 - 40;
      player.mana = MANA_MAX;
      player.alive = true;
      player.respawnLeft = 0;
      player.score = 0;
      this.inputs.set(playerId, { up: false, down: false, left: false, right: false });
    });

    this.state.phase = "playing";
    this.state.teamARole = "Chaser";
    this.state.teamBRole = "Runner";
    this.state.roleTimer = ROLE_DURATION;
    this.state.gameDuration = normalizedDuration;
    this.state.gameTimer = normalizedDuration;
    this.roleElapsed = 0;
    this.lastTick = performance.now();
    this.emitStateChange();
  }

  returnToLobby() {
    this.state.phase = "lobby";
    this.state.players.forEach((player, playerId) => {
      player.role = "";
      player.team = "";
      player.score = 0;
      player.mana = MANA_MAX;
      player.alive = true;
      player.respawnLeft = 0;
      player.x = LOBBY_SPAWN.x + (playerId === "offline_bot" ? 80 : 0);
      player.y = LOBBY_SPAWN.y;
    });
    this.state.gameTimer = this.state.gameDuration;
    this.state.roleTimer = ROLE_DURATION;
    this.roleElapsed = 0;
    this.emitStateChange();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    if (this.state.phase === "playing") {
      this.roleElapsed += dt;
      this.state.roleTimer = Math.max(0, ROLE_DURATION - this.roleElapsed);
      if (this.roleElapsed >= ROLE_DURATION) this.swapRoles();

      this.state.gameTimer = Math.max(0, this.state.gameTimer - dt);
      if (this.state.gameTimer <= 0) this.endGame();
    }

    if (this.state.phase === "playing" || this.state.phase === "lobby") {
      this.updateBotInput();
      this.state.players.forEach((player, playerId) => {
        if (!player.alive) {
          player.respawnLeft = Math.max(0, player.respawnLeft - dt);
          if (player.respawnLeft <= 0) this.respawn(player);
          return;
        }
        this.movePlayer(player, this.inputs.get(playerId) || {}, dt);
      });
    }

    if (this.state.phase === "playing") this.handleTags();
    this.emitStateChange();
  }

  endGame() {
    this.state.phase = "finished";
    this.inputs.clear();
  }

  swapRoles() {
    this.roleElapsed = 0;
    this.state.roleTimer = ROLE_DURATION;
    this.state.teamARole = this.state.teamARole === "Chaser" ? "Runner" : "Chaser";
    this.state.teamBRole = this.state.teamBRole === "Chaser" ? "Runner" : "Chaser";
    this.state.players.forEach((player) => {
      player.role = player.team === "A" ? this.state.teamARole : this.state.teamBRole;
    });
  }

  updateBotInput() {
    const bot = this.state.players.get("offline_bot");
    const player = this.state.players.get(this.sessionId);
    if (!bot || !player || this.state.phase !== "playing" || !bot.alive) {
      this.inputs.set("offline_bot", { up: false, down: false, left: false, right: false });
      return;
    }

    let dx = player.x - bot.x;
    let dy = player.y - bot.y;
    if (bot.role === "Runner") {
      dx = -dx;
      dy = -dy;
    }
    if (Math.hypot(dx, dy) < 12) {
      this.inputs.set("offline_bot", { up: false, down: false, left: false, right: false });
      return;
    }

    this.inputs.set("offline_bot", {
      up: dy < -8,
      down: dy > 8,
      left: dx < -8,
      right: dx > 8,
    });
  }

  movePlayer(player, input, dt) {
    let dx = 0;
    let dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (dx === 0 && dy === 0) return;

    const length = Math.hypot(dx, dy);
    dx /= length;
    dy /= length;

    const speed = player.mana > 0 ? NORMAL_SPEED : TIRED_SPEED;
    const distance = speed * dt;
    if (this.state.phase === "playing" && player.mana > 0 && !player.isBot) {
      player.mana = Math.max(0, player.mana - MANA_DRAIN_PER_SECOND * dt);
    }

    this.tryMoveAxis(player, dx * distance, 0);
    this.tryMoveAxis(player, 0, dy * distance);
  }

  tryMoveAxis(player, dx, dy) {
    const oldX = player.x;
    const oldY = player.y;
    player.x = clamp(player.x + dx, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
    player.y = clamp(player.y + dy, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);

    for (const obstacle of OBSTACLES) {
      if (circleRectHit(player.x, player.y, PLAYER_RADIUS, obstacle)) {
        player.x = oldX;
        player.y = oldY;
        return;
      }
    }
  }

  handleTags() {
    const players = Array.from(this.state.players.values());
    const chasers = players.filter((player) => player.alive && player.role === "Chaser");
    const runners = players.filter((player) => player.alive && player.role === "Runner");

    for (const chaser of chasers) {
      for (const runner of runners) {
        if (chaser.team === runner.team) continue;
        if (distance(chaser, runner) <= TAG_DISTANCE) {
          runner.alive = false;
          runner.respawnLeft = RESPAWN_SECONDS;
          chaser.score += 10;
        }
      }
    }
  }

  respawn(player) {
    const spawn = SPAWNS[player.team] || LOBBY_SPAWN;
    let rx = spawn.x;
    let ry = spawn.y;
    let tries = 0;
    let collides = true;

    while (collides && tries < 50) {
      rx = clamp(spawn.x + Math.random() * 160 - 80, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      ry = clamp(spawn.y + Math.random() * 160 - 80, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
      collides = OBSTACLES.some((obstacle) => circleRectHit(rx, ry, PLAYER_RADIUS, obstacle));
      tries += 1;
    }

    player.x = rx;
    player.y = ry;
    player.alive = true;
    player.respawnLeft = 0;
    player.mana = MANA_MAX;
  }

  sendQuestion(playerId) {
    const now = Date.now();
    const cooldownUntil = this.questionCooldownUntil.get(playerId) || 0;
    if (now < cooldownUntil) {
      this.emitMessage("question_cooldown", { seconds: Math.ceil((cooldownUntil - now) / 1000) });
      return;
    }

    const question = questions[Math.floor(Math.random() * questions.length)];
    this.currentQuestions.set(playerId, question.id);
    this.emitMessage("question", {
      id: question.id,
      question: question.question,
      options: question.options,
    });
  }

  checkAnswer(playerId, data) {
    const questionId = this.currentQuestions.get(playerId);
    const question = questions.find((item) => item.id === questionId);
    const player = this.state.players.get(playerId);
    if (!question || !player) return;

    const correct = Number(data.selectedIndex) === question.correctIndex;
    if (correct) {
      player.mana = Math.min(MANA_MAX, player.mana + question.rewardMana);
    } else {
      this.questionCooldownUntil.set(playerId, Date.now() + QUESTION_COOLDOWN_SECONDS * 1000);
    }

    this.currentQuestions.delete(playerId);
    this.emitMessage("question_result", {
      correct,
      rewardMana: correct ? question.rewardMana : 0,
      cooldown: correct ? 0 : QUESTION_COOLDOWN_SECONDS,
    });
    this.emitStateChange();
  }

  emitMessage(type, data) {
    const handlers = this.messageHandlers.get(type) || [];
    handlers.forEach((callback) => callback(data));
  }

  emitStateChange() {
    this.notifyPropertyListeners(this.state);
    this.state.players.forEach((player) => {
      this.notifyPropertyListeners(player);
      const handlers = this.changeHandlers.get(player) || [];
      handlers.forEach((callback) => callback(player));
    });
    this.stateHandlers.forEach((callback) => callback(this.state));
  }

  notifyPropertyListeners(target) {
    const handlers = this.propertyHandlers.get(target);
    if (!handlers) return;
    handlers.forEach((items, property) => {
      items.forEach((item) => {
        const value = target[property];
        if (value !== item.lastValue) {
          item.lastValue = value;
          item.callback(value);
        }
      });
    });
  }
}

function createState() {
  return {
    players: new OfflineMap(),
    obstacles: new OfflineMap(),
    phase: "lobby",
    roomCode: "OFFLINE",
    hostId: "",
    playerCount: 1,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    teamARole: "Chaser",
    teamBRole: "Runner",
    roleTimer: ROLE_DURATION,
    gameTimer: 180,
    gameDuration: 180,
  };
}

class OfflineMap extends Map {
  constructor() {
    super();
    this.addHandlers = [];
    this.removeHandlers = [];
  }

  set(key, value) {
    const exists = this.has(key);
    super.set(key, value);
    if (!exists) this.addHandlers.forEach((callback) => callback(value, key));
    return this;
  }

  delete(key) {
    const value = this.get(key);
    const deleted = super.delete(key);
    if (deleted) this.removeHandlers.forEach((callback) => callback(value, key));
    return deleted;
  }

  onAdd(callback) {
    this.addHandlers.push(callback);
  }

  onRemove(callback) {
    this.removeHandlers.push(callback);
  }
}

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanName(name) {
  return String(name).trim().slice(0, 16) || "Player";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function circleRectHit(cx, cy, radius, rect) {
  const nearestX = clamp(cx, rect.x, rect.x + rect.width);
  const nearestY = clamp(cy, rect.y, rect.y + rect.height);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}
