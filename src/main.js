import Phaser from "phaser";
import { Client, getStateCallbacks } from "colyseus.js";

const SERVER_URL = "ws://localhost:2567";

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");

    this.room = null;
    this.mySessionId = null;
    this.players = {};
    this.keys = null;
    this.lastMoveSent = 0;
  }

  preload() {}

  async create() {
    this.add.text(20, 20, "MLN Chase Demo - Phaser + Colyseus", {
      fontSize: "20px",
      color: "#ffffff",
    });

    this.add.text(20, 50, "Dùng phím mũi tên để di chuyển", {
      fontSize: "16px",
      color: "#ffffff",
    });

    this.keys = this.input.keyboard.createCursorKeys();

    const client = new Client(SERVER_URL);

    const name = "Player_" + Math.floor(Math.random() * 1000);
    const color = randomColor();

    this.room = await client.joinOrCreate("game_room", {
      name,
      color,
    });

    this.mySessionId = this.room.sessionId;

    console.log("Joined room:", this.room.roomId);
    console.log("My session:", this.mySessionId);

    const $ = getStateCallbacks(this.room);

    $(this.room.state).players.onAdd((player, sessionId) => {
      const circle = this.add.circle(player.x, player.y, 12, hexToNumber(player.color));

      const label = this.add.text(player.x - 20, player.y - 30, player.name, {
        fontSize: "12px",
        color: "#ffffff",
      });

      this.players[sessionId] = {
        circle,
        label,
        targetX: player.x,
        targetY: player.y,
      };

      $(player).onChange(() => {
        this.players[sessionId].targetX = player.x;
        this.players[sessionId].targetY = player.y;
      });
    });

    $(this.room.state).players.onRemove((player, sessionId) => {
      const view = this.players[sessionId];

      if (view) {
        view.circle.destroy();
        view.label.destroy();
        delete this.players[sessionId];
      }
    });
  }

  update(time, delta) {
    if (!this.room) return;

    const up = this.keys.up.isDown;
    const down = this.keys.down.isDown;
    const left = this.keys.left.isDown;
    const right = this.keys.right.isDown;

    if ((up || down || left || right) && time - this.lastMoveSent > 33) {
      this.room.send("move", {
        up,
        down,
        left,
        right,
      });

      this.lastMoveSent = time;
    }

    for (const sessionId in this.players) {
      const view = this.players[sessionId];

      const lerp = sessionId === this.mySessionId ? 0.8 : 0.25;

      view.circle.x += (view.targetX - view.circle.x) * lerp;
      view.circle.y += (view.targetY - view.circle.y) * lerp;

      view.label.x = view.circle.x - 20;
      view.label.y = view.circle.y - 30;
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1e1e2f",
  parent: "app",
  scene: MainScene,
};

new Phaser.Game(config);

function randomColor() {
  return "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
}

function hexToNumber(hex) {
  return parseInt(hex.replace("#", ""), 16);
}