"use strict";

// SIGNAL DEFENSE 2600 — LITE EDITION (SpaceChakra). MIT licensed, see LICENSE.
// A 12-wave campaign of the prototype that became Vector Interceptor 2600.
const LITE_LAST_WAVE = 12;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const W = 960;
const H = 540;
const CANVAS_SCALE = canvas.width / W;
const COLORS = {
  bg: "#000000",
  green: "#34ff5a",
  cyan: "#28e8ff",
  red: "#ff5533",
  orange: "#ff8a24",
  yellow: "#ffe45c",
  purple: "#b05cff",
  white: "#f7f7ff",
  gray: "#7b8496",
  blue: "#3a74ff",
  dark: "#161616",
};

const ENEMY_SCORE = {
  basic: 10,
  fast: 20,
  splitter: 30,
  heavy: 75,
  drone: 100,
  emp: 50,
  ufo: 125,
  orb: 90,
  laser: 15,
  flare: 15,
};

const ENEMY_BOUNTY = {
  basic: 5,
  fast: 8,
  splitter: 12,
  heavy: 25,
  drone: 30,
  emp: 18,
  ufo: 35,
  orb: 24,
  laser: 4,
  flare: 4,
};

const TOWER_DATA = {
  cannon: { name: "CANNON", cost: 125, color: COLORS.green, range: 150, cooldown: 1.0 },
  laser: { name: "LASER", cost: 175, color: COLORS.cyan, range: 210, cooldown: 0.48 },
  shield: { name: "SHIELD", cost: 200, color: COLORS.purple, range: 95, cooldown: 0 },
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b, c, d) {
  return Math.hypot(a - c, b - d);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function hitPointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  beep(freq, duration, type = "square", gain = 0.035, endFreq = null) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  noise(duration = 0.18, gain = 0.07) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(amp).connect(this.ctx.destination);
    src.start();
  }

  launch() { this.beep(220, 0.12, "square", 0.025, 660); }
  tower() { this.beep(520, 0.05, "square", 0.02); }
  laser() { this.beep(980, 0.055, "sawtooth", 0.018, 420); }
  explosion() { this.noise(0.14, 0.06); }
  cityHit() { this.beep(180, 0.45, "sawtooth", 0.05, 55); }
  start() { this.beep(320, 0.08); setTimeout(() => this.beep(520, 0.08), 90); }
  gameOver() { this.beep(440, 0.2, "square", 0.04, 180); setTimeout(() => this.beep(150, 0.35, "square", 0.04, 65), 160); }
}

class City {
  constructor(x) {
    this.x = x;
    this.y = 478;
    this.alive = true;
    this.shield = 0;
    this.level = 1;
    this.growth = 0;
    this.hp = 1;
    this.population = 50;
    this.lostPopulation = 0;
    this.dome = 0;
  }

  get maxHp() {
    return this.level;
  }

  get income() {
    return Math.floor(this.population * 0.7) + this.level * 15;
  }

  get developCost() {
    return 90 + this.level * 65;
  }

  get growthNeeded() {
    return this.level * 3;
  }

  get domeCost() {
    return 120 + this.dome * 90;
  }

  get maxDome() {
    return 3;
  }

  repair() {
    this.alive = true;
    this.hp = Math.max(1, Math.ceil(this.maxHp / 2));
    this.population = Math.max(this.population, 25 + this.level * 5);
    this.lostPopulation = 0;
  }

  develop() {
    if (!this.alive) return;
    if (this.level < 4) {
      this.level++;
      this.hp = this.maxHp;
      this.growth = 0;
      this.population += 20;
    } else {
      this.hp = this.maxHp;
      this.population += 10;
    }
  }

  addGrowth(amount) {
    if (!this.alive) return false;
    this.population += 6 + this.level * 2;
    if (this.level >= 4) return false;
    this.growth += amount;
    if (this.growth >= this.growthNeeded) {
      this.level++;
      this.hp = this.maxHp;
      this.growth = 0;
      return true;
    }
    return false;
  }

  hit(game) {
    if (!this.alive) return;
    if (this.dome > 0) {
      this.dome--;
      game.effects.push(new Explosion(this.x, this.y - 18, 52, 0.32, 0, COLORS.purple));
      return;
    }
    if (this.shield > 0) {
      this.shield--;
      game.effects.push(new Explosion(this.x, this.y - 18, 42, 0.28, 0, COLORS.cyan));
      return;
    }
    this.hp--;
    this.population = Math.max(8, Math.floor(this.population * 0.88));
    game.shake = 10;
    if (this.hp > 0) {
      game.audio.explosion();
      game.effects.push(new Explosion(this.x, this.y - 8, 46, 0.32, 0, COLORS.orange));
      return;
    }
    this.alive = false;
    this.hp = 0;
    game.salvageCityPopulation(this);
    game.shake = 16;
    game.audio.cityHit();
    game.effects.push(new Explosion(this.x, this.y - 8, 62, 0.45, 0, COLORS.red));
  }

  draw(g) {
    const c = this.alive ? COLORS.yellow : COLORS.gray;
    g.fillStyle = c;
    if (!this.alive) {
      g.fillRect(this.x - 24, this.y + 14, 10, 7);
      g.fillRect(this.x - 8, this.y + 8, 13, 13);
      g.fillRect(this.x + 10, this.y + 16, 18, 5);
      return;
    }
    const bonus = (this.level - 1) * 4;
    g.fillRect(this.x - 26 - bonus, this.y + 8 - bonus, 12 + bonus, 13 + bonus);
    g.fillRect(this.x - 10, this.y - bonus * 2, 14 + bonus, 21 + bonus * 2);
    g.fillRect(this.x + 8, this.y + 6 - bonus, 19 + bonus, 15 + bonus);
    if (this.level >= 3) {
      g.fillStyle = COLORS.cyan;
      g.fillRect(this.x - 2, this.y - 24, 6, 7);
    }
    g.fillStyle = COLORS.bg;
    g.fillRect(this.x - 6, this.y + 7, 4, 4);
    g.fillRect(this.x + 15, this.y + 12, 4, 4);
    if (this.shield > 0) {
      g.strokeStyle = COLORS.cyan;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.x, this.y + 6, 37, Math.PI, 0);
      g.stroke();
      g.fillStyle = COLORS.cyan;
      g.fillText(String(this.shield), this.x - 3, this.y - 28);
    }
    if (this.dome > 0) {
      g.strokeStyle = COLORS.purple;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.x, this.y + 3, 48, Math.PI, 0);
      g.stroke();
      g.fillStyle = COLORS.purple;
      g.fillText(String(this.dome), this.x + 30, this.y - 26);
    }
    g.fillStyle = COLORS.white;
    g.font = "12px Courier New, monospace";
    g.fillText(`L${this.level}`, this.x - 10, this.y + 28);
    g.fillStyle = COLORS.green;
    for (let i = 0; i < this.hp; i++) g.fillRect(this.x - 16 + i * 8, this.y - 8, 5, 5);
  }
}

class MissileBase {
  constructor(x) {
    this.x = x;
    this.y = 498;
    this.maxAmmo = 10;
    this.ammo = this.maxAmmo;
    this.disabled = false;
  }

  reset() {
    this.ammo = this.maxAmmo;
    this.disabled = false;
  }

  draw(g) {
    g.strokeStyle = this.disabled ? COLORS.gray : COLORS.white;
    g.fillStyle = this.disabled ? COLORS.gray : COLORS.cyan;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.x - 28, this.y + 22);
    g.lineTo(this.x, this.y - 9);
    g.lineTo(this.x + 28, this.y + 22);
    g.closePath();
    g.stroke();
    g.fillRect(this.x - 17, this.y + 12, 34, 9);

  }
}

class Enemy {
  constructor(type, x, y, tx, ty, wave) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.tx = tx;
    this.ty = ty;
    this.alive = true;
    this.reached = false;
    this.trail = [];
    this.splitDone = false;
    this.dropTimer = rand(1.2, 2.4);
    this.fireTimer = rand(0.8, 1.6);
    this.life = 0;
    this.phase = rand(0, Math.PI * 2);
    this.orbDir = Math.random() < 0.5 ? -1 : 1;
    const speed = 34 + wave * 2.3;
    this.speed = speed;
    this.health = 1;
    this.radius = 5;
    this.color = COLORS.red;
    this.damage = 1;
    if (type === "fast") {
      this.speed = speed * 1.65;
      this.color = COLORS.yellow;
      this.radius = 4;
    } else if (type === "splitter") {
      this.speed = speed * 0.9;
      this.health = 2;
      this.color = COLORS.purple;
      this.radius = 6;
    } else if (type === "heavy") {
      this.speed = speed * 0.52;
      this.health = 5 + Math.floor(wave / 5);
      this.color = COLORS.orange;
      this.radius = 9;
      this.damage = 2;
    } else if (type === "drone") {
      this.speed = 58 + wave * 1.2;
      this.health = 3;
      this.color = COLORS.cyan;
      this.radius = 9;
      this.ty = y;
    } else if (type === "ufo") {
      this.speed = 68 + wave * 1.4;
      this.health = 4;
      this.color = COLORS.purple;
      this.radius = 12;
      this.ty = y;
    } else if (type === "orb") {
      this.speed = 42 + wave * 0.9;
      this.health = 3;
      this.color = COLORS.green;
      this.radius = 10;
      this.ty = y;
    } else if (type === "laser") {
      this.speed = 190 + wave * 4;
      this.health = 1;
      this.color = COLORS.cyan;
      this.radius = 4;
      this.damage = 1;
    } else if (type === "flare") {
      this.speed = 120 + wave * 3;
      this.health = 1;
      this.color = COLORS.yellow;
      this.radius = 5;
      this.damage = 1;
    } else if (type === "emp") {
      this.speed = speed * 1.05;
      this.health = 2;
      this.color = COLORS.white;
      this.radius = 6;
    }
  }

  update(dt, game) {
    if (!this.alive) return;
    this.life += dt;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 14) this.trail.shift();

    if (this.type === "drone") {
      const dir = this.tx > this.x ? 1 : -1;
      this.x += dir * this.speed * dt;
      this.dropTimer -= dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = rand(1.0, 2.0);
        const target = game.randomGroundTarget();
        game.enemies.push(new Enemy("basic", this.x, this.y + 8, target.x, target.y, game.wave));
      }
      if ((dir > 0 && this.x >= this.tx) || (dir < 0 && this.x <= this.tx)) this.alive = false;
      return;
    }

    if (this.type === "ufo") {
      const dir = this.tx > this.x ? 1 : -1;
      this.x += dir * this.speed * dt;
      this.y += Math.sign(Math.sin(this.life * 5)) * 24 * dt;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = rand(1.0, 1.8);
        game.enemies.push(new Enemy("laser", this.x, this.y + 12, this.x, 506, game.wave));
      }
      if ((dir > 0 && this.x >= this.tx) || (dir < 0 && this.x <= this.tx)) this.alive = false;
      return;
    }

    if (this.type === "orb") {
      this.x += this.orbDir * this.speed * dt;
      this.y += Math.sign(Math.sin(this.life * 4 + this.phase)) * this.speed * 0.65 * dt;
      this.y = clamp(this.y, 80, 300);
      this.dropTimer -= dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = rand(0.85, 1.45);
        game.enemies.push(new Enemy("flare", this.x, this.y + 8, this.x, 506, game.wave));
      }
      if (this.x < -30 || this.x > W + 30 || this.life > 13) this.alive = false;
      return;
    }

    const d = dist(this.x, this.y, this.tx, this.ty);
    if (d < 4) {
      this.impact(game);
      return;
    }
    this.x += ((this.tx - this.x) / d) * this.speed * dt;
    this.y += ((this.ty - this.y) / d) * this.speed * dt;
  }

  takeDamage(amount, game) {
    this.health -= amount;
    if (this.health <= 0) this.destroy(game);
  }

  destroy(game) {
    if (!this.alive) return;
    this.alive = false;
    game.kills++;
    game.score += ENEMY_SCORE[this.type] || 10;
    game.waveMoney += ENEMY_BOUNTY[this.type] || 5;
    game.effects.push(new Explosion(this.x, this.y, this.type === "heavy" ? 34 : 24, 0.22, 0, this.color));
    if (this.type === "splitter" && !this.splitDone) {
      this.splitDone = true;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        const target = game.randomGroundTarget(true);
        const e = new Enemy("fast", this.x + rand(-8, 8), this.y + rand(-4, 8), target.x, target.y, Math.max(1, game.wave - 2));
        e.speed *= 0.8;
        game.enemies.push(e);
      }
    }
  }

  impact(game) {
    if (!this.alive) return;
    this.alive = false;
    this.reached = true;
    game.effects.push(new Explosion(this.tx, this.ty, this.type === "heavy" ? 74 : 46, 0.35, 0, this.color));
    game.audio.explosion();
    if (this.type === "emp") {
      for (const slot of game.slots) {
        if (slot.tower && dist(slot.x, slot.y, this.tx, this.ty) < 140) slot.tower.disabledTimer = 5;
      }
    }
    const city = game.cities.find(c => c.alive && dist(c.x, c.y + 8, this.tx, this.ty) < 38);
    if (city) city.hit(game);
    const base = game.bases.find(b => !b.disabled && dist(b.x, b.y, this.tx, this.ty) < 34);
    if (base) {
      base.disabled = true;
      game.shake = 12;
    }
  }

  draw(g) {
    g.strokeStyle = this.color;
    g.lineWidth = this.type === "heavy" ? 3 : 2;
    g.beginPath();
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.lineTo(this.x, this.y);
    g.stroke();

    g.fillStyle = this.color;
    if (this.type === "heavy") {
      g.fillRect(this.x - 8, this.y - 8, 16, 16);
      g.fillStyle = COLORS.bg;
      g.fillRect(this.x - 3, this.y - 3, 6, 6);
    } else if (this.type === "drone") {
      g.fillRect(this.x - 12, this.y - 3, 24, 6);
      g.fillRect(this.x - 5, this.y - 8, 10, 5);
      g.fillRect(this.x - 16, this.y, 5, 4);
      g.fillRect(this.x + 11, this.y, 5, 4);
    } else if (this.type === "ufo") {
      g.fillRect(this.x - 18, this.y - 4, 36, 8);
      g.fillRect(this.x - 10, this.y - 11, 20, 7);
      g.fillStyle = COLORS.yellow;
      g.fillRect(this.x - 4, this.y + 5, 8, 4);
    } else if (this.type === "orb") {
      g.strokeStyle = this.color;
      g.strokeRect(this.x - 9, this.y - 9, 18, 18);
      g.fillRect(this.x - 4, this.y - 4, 8, 8);
      g.fillStyle = COLORS.white;
      g.fillRect(this.x - 2, this.y - 2, 4, 4);
    } else if (this.type === "laser") {
      g.fillStyle = COLORS.cyan;
      g.fillRect(this.x - 2, this.y - 14, 4, 24);
      g.fillStyle = COLORS.white;
      g.fillRect(this.x - 1, this.y - 10, 2, 18);
    } else if (this.type === "flare") {
      g.fillStyle = COLORS.yellow;
      g.fillRect(this.x - 5, this.y - 5, 10, 10);
      g.fillStyle = COLORS.orange;
      g.fillRect(this.x - 3, this.y - 18, 6, 10);
      g.fillStyle = COLORS.red;
      g.fillRect(this.x - 2, this.y - 27, 4, 8);
    } else {
      g.fillRect(this.x - this.radius / 2, this.y - this.radius / 2, this.radius, this.radius);
      if (this.type === "splitter" && Math.floor(performance.now() / 120) % 2 === 0) {
        g.fillStyle = COLORS.white;
        g.fillRect(this.x - 2, this.y - 2, 4, 4);
      }
    }
  }
}

class Interceptor {
  constructor(base, tx, ty, speed, radius) {
    this.x = base.x;
    this.y = base.y;
    this.sx = base.x;
    this.sy = base.y;
    this.tx = tx;
    this.ty = ty;
    this.speed = speed;
    this.radius = radius;
    this.alive = true;
  }

  update(dt, game) {
    const d = dist(this.x, this.y, this.tx, this.ty);
    if (d < this.speed * dt) {
      this.alive = false;
      game.explosions.push(new Explosion(this.tx, this.ty, this.radius, 0.42, 1.6, COLORS.white));
      game.audio.explosion();
      return;
    }
    this.x += ((this.tx - this.x) / d) * this.speed * dt;
    this.y += ((this.ty - this.y) / d) * this.speed * dt;
  }

  draw(g) {
    g.strokeStyle = COLORS.cyan;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.sx, this.sy);
    g.lineTo(this.x, this.y);
    g.stroke();
    g.fillStyle = COLORS.white;
    g.fillRect(this.x - 2, this.y - 2, 4, 4);
  }
}

class Explosion {
  constructor(x, y, maxRadius, duration, damage, color) {
    this.x = x;
    this.y = y;
    this.maxRadius = maxRadius;
    this.duration = duration;
    this.damage = damage;
    this.color = color;
    this.t = 0;
    this.alive = true;
    this.hit = new Set();
  }

  update(dt, game) {
    this.t += dt;
    if (this.t >= this.duration) this.alive = false;
    const p = clamp(this.t / this.duration, 0, 1);
    const r = this.maxRadius * Math.sin(p * Math.PI);
    if (this.damage > 0) {
      for (const e of game.enemies) {
        if (e.alive && !this.hit.has(e) && dist(this.x, this.y, e.x, e.y) <= r + e.radius) {
          this.hit.add(e);
          e.takeDamage(this.damage, game);
        }
      }
    }
  }

  draw(g) {
    const p = clamp(this.t / this.duration, 0, 1);
    const r = this.maxRadius * Math.sin(p * Math.PI);
    g.strokeStyle = this.color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(this.x, this.y, r, 0, Math.PI * 2);
    g.stroke();
    if (Math.random() < 0.6) {
      g.fillStyle = this.color;
      for (let i = 0; i < 4; i++) {
        g.fillRect(this.x + rand(-r, r), this.y + rand(-r, r), 3, 3);
      }
    }
  }
}

class Tower {
  constructor(type, x, y) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.level = 1;
    this.timer = rand(0, 0.5);
    this.disabledTimer = 0;
    this.beam = 0;
    this.beamTarget = null;
    this.regenTimer = 8;
  }

  get data() { return TOWER_DATA[this.type]; }
  get range() { return this.data.range + (this.level - 1) * 28; }
  get cooldown() { return Math.max(0.16, this.data.cooldown * (1 - (this.level - 1) * 0.18)); }
  get upgradeCost() { return this.level === 1 ? 150 : 300; }

  update(dt, game) {
    if (this.disabledTimer > 0) {
      this.disabledTimer -= dt;
      return;
    }
    if (this.type === "shield") {
      if (this.level < 3) return;
      this.regenTimer -= dt;
      if (this.regenTimer <= 0) {
        this.regenTimer = 8;
        for (const city of game.cities) {
          if (city.alive && dist(this.x, this.y, city.x, city.y) <= this.range && city.shield < this.level) city.shield++;
        }
      }
      return;
    }
    this.timer -= dt;
    if (this.beam > 0) this.beam -= dt;
    if (this.timer > 0) return;
    const target = this.findTarget(game.enemies);
    if (!target) return;
    this.timer = this.cooldown;
    if (this.type === "laser") {
      target.takeDamage(0.75 + this.level * 0.45, game);
      this.beam = 0.09;
      this.beamTarget = { x: target.x, y: target.y };
      game.audio.laser();
    } else {
      game.effects.push(new Explosion(target.x, target.y, 18 + this.level * 6, 0.18, 0.7 + this.level * 0.45, COLORS.green));
      game.audio.tower();
    }
  }

  findTarget(enemies) {
    let best = null;
    let bestY = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d <= this.range && e.y < bestY) {
        best = e;
        bestY = e.y;
      }
    }
    return best;
  }

  upgrade() {
    if (this.level < 3) this.level++;
  }

  draw(g, buildPhase) {
    const color = this.disabledTimer > 0 ? COLORS.gray : this.data.color;
    if (buildPhase) {
      g.strokeStyle = color;
      g.globalAlpha = 0.22;
      g.beginPath();
      g.arc(this.x, this.y, this.range, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 2;
    if (this.type === "cannon") {
      g.fillRect(this.x - 13, this.y - 11, 26, 22);
      g.fillRect(this.x - 4, this.y - 28, 8, 20);
    } else if (this.type === "laser") {
      g.beginPath();
      g.moveTo(this.x, this.y - 28);
      g.lineTo(this.x - 17, this.y + 12);
      g.lineTo(this.x + 17, this.y + 12);
      g.closePath();
      g.stroke();
      g.fillRect(this.x - 4, this.y - 6, 8, 8);
      if (this.beam > 0 && this.beamTarget) {
        g.strokeStyle = COLORS.white;
        g.beginPath();
        g.moveTo(this.x, this.y - 20);
        g.lineTo(this.beamTarget.x, this.beamTarget.y);
        g.stroke();
      }
    } else {
      g.strokeRect(this.x - 14, this.y - 14, 28, 28);
      g.beginPath();
      g.arc(this.x, this.y, 10 + this.level * 3, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = COLORS.white;
    g.fillText(String(this.level), this.x - 4, this.y + 29);
  }
}

class BuildSlot {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.tower = null;
  }

  draw(g, selected) {
    g.strokeStyle = selected ? COLORS.yellow : COLORS.gray;
    g.lineWidth = selected ? 3 : 2;
    g.strokeRect(this.x - 18, this.y - 18, 36, 36);
    if (!this.tower) {
      g.fillStyle = selected ? COLORS.yellow : COLORS.gray;
      g.fillRect(this.x - 3, this.y - 11, 6, 22);
      g.fillRect(this.x - 11, this.y - 3, 22, 6);
    }
  }
}

class Game {
  constructor() {
    this.audio = new AudioManager();
    this.highScore = Number(localStorage.getItem("signalDefense2600LiteHighScore") || 0);
    this.buttons = [];
    this.state = "title";
    this.reset();
    this.bind();
  }

  reset() {
    this.wave = 0;
    this.score = 0;
    this.money = 300;
    this.kills = 0;
    this.waveMoney = 0;
    this.waveStartedCities = 6;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.shake = 0;
    this.pausedFrom = null;
    this.selectedSlot = null;
    this.selectedCity = null;
    this.interceptorSpeed = 360;
    this.interceptorRadius = 42;
    this.baseAmmoUpgradeCost = 100;
    this.cities = [122, 244, 365, 487, 608, 730].map(x => new City(x));
    this.connectors = Array(this.cities.length - 1).fill(false);
    this.bases = [60, 480, 900].map(x => new MissileBase(x));
    this.stars = [
      [70, 82, COLORS.gray], [145, 152, COLORS.cyan], [232, 72, COLORS.green],
      [320, 214, COLORS.gray], [416, 118, COLORS.yellow], [520, 176, COLORS.gray],
      [612, 88, COLORS.purple], [704, 238, COLORS.cyan], [818, 144, COLORS.gray],
      [892, 78, COLORS.yellow], [84, 274, COLORS.purple], [874, 290, COLORS.green],
    ];
    this.slots = [
      new BuildSlot(160, 412), new BuildSlot(280, 388), new BuildSlot(405, 414),
      new BuildSlot(555, 390), new BuildSlot(680, 414), new BuildSlot(810, 392),
      new BuildSlot(238, 330), new BuildSlot(722, 330),
    ];
    this.enemies = [];
    this.interceptors = [];
    this.explosions = [];
    this.effects = [];
  }

  bind() {
    canvas.addEventListener("pointerdown", e => {
      e.preventDefault();
      const p = this.pointer(e);
      this.audio.ensure();
      this.handlePointer(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("keydown", e => {
      const key = e.key.toLowerCase();
      const state = this.state;
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key)) e.preventDefault();
      if (key === "escape" || key === "p") this.togglePause();
      if ((key === "enter" || e.key === " ") && state === "title") this.startNewGame();
      if ((key === "enter" || e.key === " ") && state === "build") this.startWave();
      if ((key === "enter" || e.key === " ") && state === "waveComplete") this.setState("build");
      if ((key === "enter" || e.key === " ") && state === "gameOver") this.startNewGame();
      if (state === "build" && key === "r") this.repairCity();
      if (state === "build" && key === "a") this.upgradeAmmo();
      if (state === "build" && key === "u") this.upgradeSelected();
      if (state === "build" && key === "d") this.developSelectedCity();
      if (state === "build" && key === "o") this.addCityDome();
      if (state === "build" && key === "[") this.buildSelectedConnector(-1);
      if (state === "build" && key === "]") this.buildSelectedConnector(1);
      if (key === "m") this.audio.enabled = !this.audio.enabled;
      if (state === "build" && this.selectedSlot) {
        if (e.key === "1") this.build("cannon");
        if (e.key === "2") this.build("laser");
        if (e.key === "3") this.build("shield");
      }
    });
  }

  pointer(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  setState(state) {
    this.state = state;
    this.selectedSlot = null;
    this.selectedCity = null;
  }

  handlePointer(x, y) {
    for (const b of this.buttons) {
      if (hitPointInRect(x, y, b)) {
        b.onClick();
        return;
      }
    }
    if (this.state === "combat") this.fireInterceptor(x, y);
    if (this.state === "build") {
      for (const city of this.cities) {
        if (dist(x, y, city.x, city.y + 6) < 42) {
          this.selectedCity = city;
          this.selectedSlot = null;
          return;
        }
      }
      for (const slot of this.slots) {
        if (dist(x, y, slot.x, slot.y) < 26) {
          this.selectedSlot = slot;
          this.selectedCity = null;
          return;
        }
      }
    }
  }

  fireInterceptor(x, y) {
    if (y > 460) return;
    const available = this.bases
      .filter(b => !b.disabled && b.ammo > 0)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    if (!available.length) return;
    const base = available[0];
    base.ammo--;
    this.interceptors.push(new Interceptor(base, x, y, this.interceptorSpeed, this.interceptorRadius));
    this.audio.launch();
  }

  startNewGame() {
    this.liteCleared = false;
    this.reset();
    this.setState("build");
  }

  startWave() {
    if (this.state !== "build" && this.state !== "waveComplete") return;
    this.wave++;
    this.kills = 0;
    this.waveMoney = 0;
    this.waveStartedCities = this.cities.filter(c => c.alive).length;
    this.enemies = [];
    this.interceptors = [];
    this.explosions = [];
    this.effects = [];
    for (const base of this.bases) base.reset();
    this.applyShieldNodes();
    this.spawnQueue = this.makeWave(this.wave);
    this.spawnTimer = 0.4;
    this.audio.start();
    this.setState("combat");
  }

  applyShieldNodes() {
    for (const city of this.cities) city.shield = 0;
    for (const slot of this.slots) {
      const tower = slot.tower;
      if (!tower || tower.type !== "shield") continue;
      tower.regenTimer = 8;
      for (const city of this.cities) {
        if (city.alive && dist(tower.x, tower.y, city.x, city.y) <= tower.range) {
          city.shield = Math.max(city.shield, tower.level);
        }
      }
    }
  }

  makeWave(wave) {
    const count = 6 + wave * 2;
    const types = [];
    for (let i = 0; i < count; i++) {
      let type = "basic";
      const r = Math.random();
      if (wave >= 16 && r < 0.12) type = "emp";
      else if (wave >= 13 && r < 0.18) type = Math.random() < 0.5 ? "ufo" : "orb";
      else if (wave >= 11 && r < 0.22) type = Math.random() < 0.55 ? "heavy" : "drone";
      else if (wave >= 9 && r < 0.18) type = "orb";
      else if (wave >= 7 && r < 0.24) type = "splitter";
      else if (wave >= 4 && r < 0.35) type = "fast";
      types.push(type);
    }
    return types.map(type => ({ type, delay: rand(0.25, Math.max(0.5, 1.35 - wave * 0.025)) }));
  }

  spawnEnemy(type) {
    if (type === "drone") {
      const left = Math.random() < 0.5;
      this.enemies.push(new Enemy("drone", left ? -20 : W + 20, rand(82, 190), left ? W + 20 : -20, rand(82, 190), this.wave));
      return;
    }
    if (type === "ufo") {
      const left = Math.random() < 0.5;
      this.enemies.push(new Enemy("ufo", left ? -24 : W + 24, rand(70, 170), left ? W + 24 : -24, rand(70, 170), this.wave));
      return;
    }
    if (type === "orb") {
      const left = Math.random() < 0.5;
      const orb = new Enemy("orb", left ? -20 : W + 20, rand(95, 260), left ? W + 20 : -20, rand(95, 260), this.wave);
      orb.orbDir = left ? 1 : -1;
      this.enemies.push(orb);
      return;
    }
    const target = this.randomGroundTarget();
    this.enemies.push(new Enemy(type, rand(20, W - 20), -8, target.x, target.y, this.wave));
  }

  randomGroundTarget(cityBias = false) {
    const aliveCities = this.cities.filter(c => c.alive);
    if (aliveCities.length && (cityBias || Math.random() < 0.7)) {
      const c = aliveCities[Math.floor(Math.random() * aliveCities.length)];
      return { x: c.x + rand(-18, 18), y: c.y + 12 };
    }
    if (Math.random() < 0.22) {
      const b = this.bases[Math.floor(Math.random() * this.bases.length)];
      return { x: b.x, y: b.y + 10 };
    }
    return { x: rand(40, W - 40), y: 500 };
  }

  update(dt) {
    if (this.state === "combat") this.updateCombat(dt);
    for (const e of this.effects) e.update(dt, this);
    this.effects = this.effects.filter(e => e.alive);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 42 * dt);
  }

  updateCombat(dt) {
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const next = this.spawnQueue.shift();
        this.spawnEnemy(next.type);
        this.spawnTimer = next.delay;
      }
    }
    for (const slot of this.slots) if (slot.tower) slot.tower.update(dt, this);
    for (const i of this.interceptors) i.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const ex of this.explosions) ex.update(dt, this);
    this.interceptors = this.interceptors.filter(i => i.alive);
    this.enemies = this.enemies.filter(e => e.alive);
    this.explosions = this.explosions.filter(e => e.alive);

    if (this.cities.every(c => !c.alive)) {
      this.endGame();
      return;
    }
    if (!this.spawnQueue.length && !this.enemies.length && !this.interceptors.length && !this.explosions.length) {
      if (this.wave >= LITE_LAST_WAVE) {
        // Lite campaign cleared: bank the wave score, then end on a win.
        this.score += 250 * this.wave + this.cities.filter(c => c.alive).length * 50;
        this.liteCleared = true;
        this.endGame();
        return;
      }
      this.finishWave();
    }
  }

  finishWave() {
    const surviving = this.cities.filter(c => c.alive).length;
    let cityIncome = 0;
    let cityGrowth = 0;
    for (const city of this.cities) {
      if (!city.alive) continue;
      cityIncome += city.income;
      if (city.addGrowth(1)) cityGrowth++;
    }
    const ammoBonus = this.bases.reduce((sum, b) => sum + b.ammo, 0) * 2;
    const perfect = surviving === this.waveStartedCities;
    const perfectBonus = perfect ? 100 : 0;
    const earned = cityIncome + ammoBonus + perfectBonus + this.waveMoney;
    this.money += earned;
    this.lastWave = { surviving, cityIncome, cityGrowth, ammoBonus, perfectBonus, bounty: this.waveMoney, earned, kills: this.kills };
    this.score += 250 * this.wave + surviving * 50 + (perfect ? 1000 : 0);
    this.setState("waveComplete");
  }

  cityIndex(city) {
    return this.cities.indexOf(city);
  }

  hasConnector(index) {
    return index >= 0 && index < this.connectors.length && this.connectors[index];
  }

  buildConnector(index) {
    if (index < 0 || index >= this.connectors.length || this.connectors[index] || this.money < 140) return;
    const a = this.cities[index];
    const b = this.cities[index + 1];
    if (!a.alive || !b.alive) return;
    this.money -= 140;
    this.connectors[index] = true;
  }

  buildSelectedConnector(direction) {
    const city = this.selectedCity;
    if (!city) return;
    const index = this.cityIndex(city);
    this.buildConnector(direction < 0 ? index - 1 : index);
  }

  addCityDome() {
    const city = this.selectedCity;
    if (!city || !city.alive || city.dome >= city.maxDome || this.money < city.domeCost) return;
    this.money -= city.domeCost;
    city.dome++;
  }

  salvageCityPopulation(city) {
    const index = this.cityIndex(city);
    const receivers = [];
    if (this.hasConnector(index - 1) && this.cities[index - 1].alive) receivers.push(this.cities[index - 1]);
    if (this.hasConnector(index) && this.cities[index + 1].alive) receivers.push(this.cities[index + 1]);
    const originalPopulation = city.population;
    const salvaged = receivers.length ? Math.floor(city.population * 0.6) : Math.floor(city.population * 0.25);
    if (receivers.length) {
      const share = Math.floor(salvaged / receivers.length);
      for (const receiver of receivers) receiver.population += share;
    } else {
      this.waveMoney += Math.floor(salvaged * 0.4);
    }
    city.population = 0;
    city.lostPopulation = originalPopulation - salvaged;
  }

  endGame() {
    this.audio.gameOver();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("signalDefense2600LiteHighScore", String(this.highScore));
    }
    this.setState("gameOver");
  }

  build(type) {
    if (!this.selectedSlot || this.selectedSlot.tower) return;
    const data = TOWER_DATA[type];
    if (this.money < data.cost) return;
    this.money -= data.cost;
    this.selectedSlot.tower = new Tower(type, this.selectedSlot.x, this.selectedSlot.y);
  }

  upgradeSelected() {
    const tower = this.selectedSlot && this.selectedSlot.tower;
    if (!tower || tower.level >= 3 || this.money < tower.upgradeCost) return;
    this.money -= tower.upgradeCost;
    tower.upgrade();
  }

  repairCity() {
    const city = this.selectedCity && !this.selectedCity.alive
      ? this.selectedCity
      : this.cities.find(c => !c.alive);
    if (!city || this.money < 150) return;
    this.money -= 150;
    city.repair();
  }

  developSelectedCity() {
    const city = this.selectedCity;
    if (!city || !city.alive || city.level >= 4 || this.money < city.developCost) return;
    this.money -= city.developCost;
    city.develop();
  }

  upgradeAmmo() {
    if (this.money < this.baseAmmoUpgradeCost) return;
    this.money -= this.baseAmmoUpgradeCost;
    for (const base of this.bases) base.maxAmmo += 2;
    this.baseAmmoUpgradeCost += 75;
  }

  togglePause() {
    if (this.state === "combat") {
      this.pausedFrom = this.state;
      this.setState("pause");
    } else if (this.state === "pause") {
      this.state = this.pausedFrom || "combat";
    }
  }

  draw() {
    ctx.save();
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    this.drawWorld(ctx);
    ctx.restore();
    ctx.save();
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);
    this.drawUI(ctx);
    ctx.restore();
  }

  drawWorld(g) {
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    this.drawAtariBackdrop(g);

    this.drawConnectors(g);
    for (const slot of this.slots) slot.draw(g, this.selectedSlot === slot && this.state === "build");
    for (const slot of this.slots) if (slot.tower) slot.tower.draw(g, this.state === "build");
    for (const city of this.cities) city.draw(g);
    if (this.state === "build" && this.selectedCity) this.drawSelectedCityMarker(g, this.selectedCity);
    for (const base of this.bases) base.draw(g);
    for (const e of this.enemies) e.draw(g);
    for (const i of this.interceptors) i.draw(g);
    for (const ex of this.explosions) ex.draw(g);
    for (const ef of this.effects) ef.draw(g);
  }

  drawAtariBackdrop(g) {
    for (const [x, y, color] of this.stars) {
      if ((Math.floor(performance.now() / 360) + x + y) % 5 === 0) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 4, 4);
    }

    g.fillStyle = COLORS.blue;
    g.fillRect(0, 500, W, 6);
    g.fillStyle = COLORS.green;
    g.fillRect(0, 506, W, 8);
    g.fillStyle = COLORS.dark;
    g.fillRect(0, 514, W, 26);
  }

  drawSelectedCityMarker(g, city) {
    g.strokeStyle = COLORS.cyan;
    g.lineWidth = 2;
    g.strokeRect(city.x - 42, city.y - 34, 84, 68);
    g.fillStyle = COLORS.cyan;
    g.fillRect(city.x - 4, city.y - 42, 8, 8);
  }

  drawConnectors(g) {
    for (let i = 0; i < this.connectors.length; i++) {
      if (!this.connectors[i]) continue;
      const a = this.cities[i];
      const b = this.cities[i + 1];
      g.strokeStyle = a.alive && b.alive ? COLORS.green : COLORS.gray;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(a.x + 34, a.y + 14);
      g.lineTo(b.x - 34, b.y + 14);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      for (let x = a.x + 48; x < b.x - 42; x += 18) g.fillRect(x, a.y + 10, 7, 7);
    }
  }

  drawUI(g) {
    this.buttons = [];
    g.font = "16px Courier New, monospace";
    g.textBaseline = "top";
    g.fillStyle = COLORS.white;
    g.fillText(`SCORE ${this.score}`, 12, 12);
    g.fillText(`WAVE ${Math.max(1, this.wave || 1)}`, 190, 12);
    g.fillText(`$${this.money}`, 310, 12);
    g.fillText(`AMMO ${this.bases.reduce((s, b) => s + b.ammo, 0)}`, 410, 12);
    g.fillText(`CITIES ${this.cities.filter(c => c.alive).length}/6`, 540, 12);
    g.fillText(`HIGH ${this.highScore}`, 720, 12);
    if (this.state === "build" || this.state === "combat") this.drawBaseAmmoLabels(g);

    if (this.state === "title") this.drawTitle(g);
    if (this.state === "build") this.drawBuild(g);
    if (this.state === "waveComplete") this.drawWaveComplete(g);
    if (this.state === "gameOver") this.drawGameOver(g);
    if (this.state === "pause") this.drawPanel(g, "PAUSED", ["ESC TO RESUME"]);
  }

  drawBaseAmmoLabels(g) {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "20px Courier New, monospace";
    for (const base of this.bases) {
      const x = base.x;
      const y = base.y - 45;
      g.fillStyle = COLORS.bg;
      g.fillRect(x - 26, y - 16, 52, 32);
      g.strokeStyle = base.disabled ? COLORS.gray : COLORS.yellow;
      g.lineWidth = 2;
      g.strokeRect(x - 26, y - 16, 52, 32);
      g.fillStyle = base.disabled ? COLORS.gray : COLORS.white;
      g.fillText(String(base.ammo), x, y);
    }
    g.restore();
  }

  button(g, x, y, w, h, label, onClick, disabled = false) {
    const b = { x, y, w, h, onClick };
    if (!disabled) this.buttons.push(b);
    g.strokeStyle = disabled ? COLORS.gray : COLORS.white;
    g.fillStyle = disabled ? "#141821" : COLORS.bg;
    g.lineWidth = 2;
    g.fillRect(x, y, w, h);
    g.strokeRect(x, y, w, h);
    g.fillStyle = disabled ? COLORS.gray : COLORS.white;
    g.font = "15px Courier New, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.textAlign = "left";
    g.textBaseline = "top";
  }

  drawTitle(g) {
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.fillStyle = COLORS.green;
    g.font = "44px Courier New, monospace";
    g.fillText("SIGNAL DEFENSE 2600", W / 2, 132);
    g.fillStyle = COLORS.cyan;
    g.font = "18px Courier New, monospace";
    g.fillText("CLICK SKY TO FIRE - BUILD BETWEEN WAVES", W / 2, 205);
    g.fillStyle = COLORS.yellow;
    g.fillText(`HIGH SCORE ${this.highScore}`, W / 2, 238);
    g.textAlign = "left";
    this.button(g, W / 2 - 92, 292, 184, 42, "START SIGNAL", () => this.startNewGame());
  }

  drawBuild(g) {
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 52, 250, 202);
    g.strokeStyle = COLORS.green;
    g.strokeRect(0, 52, 250, 202);
    g.fillStyle = COLORS.green;
    g.fillText("BUILD PHASE", 12, 64);
    this.button(g, 12, 94, 106, 32, "START", () => this.startWave());
    this.button(g, 128, 94, 106, 32, `REPAIR 150`, () => this.repairCity(), this.money < 150 || !this.cities.some(c => !c.alive));
    this.button(g, 12, 134, 222, 32, `AMMO +2 ${this.baseAmmoUpgradeCost}`, () => this.upgradeAmmo(), this.money < this.baseAmmoUpgradeCost);

    if (this.selectedSlot) {
      const x = 330;
      const y = 58;
      const w = 300;
      g.fillStyle = COLORS.bg;
      g.fillRect(x, y, w, 184);
      g.strokeStyle = COLORS.yellow;
      g.strokeRect(x, y, w, 184);
      g.fillStyle = COLORS.yellow;
      g.fillText("SELECTED PAD", x + 14, y + 12);
      if (this.selectedSlot.tower) {
        const t = this.selectedSlot.tower;
        g.fillStyle = COLORS.white;
        g.fillText(`${t.data.name} LV ${t.level}`, x + 14, y + 42);
        g.fillText(`RANGE ${Math.round(t.range)}`, x + 14, y + 66);
        this.button(g, x + 14, y + 110, w - 28, 34, `U UPGRADE ${t.level < 3 ? t.upgradeCost : "MAX"}`, () => this.upgradeSelected(), t.level >= 3 || this.money < t.upgradeCost);
      } else {
        this.button(g, x + 14, y + 44, w - 28, 32, "1 CANNON 125", () => this.build("cannon"), this.money < 125);
        this.button(g, x + 14, y + 84, w - 28, 32, "2 LASER 175", () => this.build("laser"), this.money < 175);
        this.button(g, x + 14, y + 124, w - 28, 32, "3 SHIELD 200", () => this.build("shield"), this.money < 200);
      }
    }
    if (this.selectedCity) {
      const city = this.selectedCity;
      const index = this.cityIndex(city);
      const x = 330;
      const y = 58;
      const w = 330;
      const h = city.alive ? 272 : 134;
      g.fillStyle = COLORS.bg;
      g.fillRect(x, y, w, h);
      g.strokeStyle = COLORS.cyan;
      g.strokeRect(x, y, w, h);
      g.fillStyle = COLORS.cyan;
      g.fillText("CITY CONTROL", x + 14, y + 12);
      g.fillStyle = COLORS.white;
      if (city.alive) {
        g.fillText(`LEVEL ${city.level}   HP ${city.hp}/${city.maxHp}`, x + 14, y + 42);
        g.fillText(`POP ${city.population}   INC ${city.income}`, x + 14, y + 66);
        g.fillText(`GROW ${city.level >= 4 ? "MAX" : `${city.growth}/${city.growthNeeded}`}   DOME ${city.dome}/${city.maxDome}`, x + 14, y + 90);
        this.button(g, x + 14, y + 120, w - 28, 32, `D DEVELOP ${city.level < 4 ? city.developCost : "MAX"}`, () => this.developSelectedCity(), city.level >= 4 || this.money < city.developCost);
        this.button(g, x + 14, y + 160, w - 28, 32, `O DOME ${city.dome < city.maxDome ? city.domeCost : "MAX"}`, () => this.addCityDome(), city.dome >= city.maxDome || this.money < city.domeCost);
        this.button(g, x + 14, y + 200, 145, 32, `[ LINK L 140`, () => this.buildSelectedConnector(-1), index <= 0 || this.hasConnector(index - 1) || !this.cities[index - 1].alive || this.money < 140);
        this.button(g, x + 171, y + 200, 145, 32, `] LINK R 140`, () => this.buildSelectedConnector(1), index >= this.cities.length - 1 || this.hasConnector(index) || !this.cities[index + 1].alive || this.money < 140);
        g.fillStyle = COLORS.gray;
        g.fillText("LINKS SHARE SALVAGED POP", x + 14, y + 244);
      } else {
        g.fillText("DESTROYED", x + 14, y + 42);
        g.fillText(`LOST POP ${city.lostPopulation}`, x + 14, y + 66);
        this.button(g, x + 14, y + 76, w - 28, 34, "R REPAIR 150", () => this.repairCity(), this.money < 150);
      }
    }
  }

  drawWaveComplete(g) {
    const w = this.lastWave || {};
    this.drawPanel(g, "WAVE COMPLETE", [
      `DESTROYED ${w.kills || 0}`,
      `CITY INCOME ${w.cityIncome || 0}`,
      `CITY GROWTH +${w.cityGrowth || 0}`,
      `BOUNTY ${w.bounty || 0}`,
      `AMMO BONUS ${w.ammoBonus || 0}`,
      `PERFECT BONUS ${w.perfectBonus || 0}`,
      `TOTAL EARNED ${w.earned || 0}`,
    ]);
    this.button(g, W / 2 - 95, 390, 190, 38, "CONTINUE", () => this.setState("build"));
  }

  drawGameOver(g) {
    this.drawPanel(g, this.liteCleared ? "SIGNAL HELD" : "SIGNAL LOST", [
      `FINAL SCORE ${this.score}`,
      this.liteCleared ? `ALL ${LITE_LAST_WAVE} WAVES CLEARED` : `WAVE REACHED ${this.wave}`,
      `HIGH SCORE ${this.highScore}`,
      "",
      "LITE EDITION - FULL GAME:",
      "PATREON.COM/SPACECHAKRA",
    ]);
    this.button(g, W / 2 - 86, 374, 172, 38, "RESTART", () => this.startNewGame());
  }

  drawPanel(g, title, lines) {
    g.fillStyle = COLORS.bg;
    g.fillRect(W / 2 - 190, 140, 380, 260);
    g.strokeStyle = COLORS.white;
    g.strokeRect(W / 2 - 190, 140, 380, 260);
    g.textAlign = "center";
    g.fillStyle = COLORS.red;
    g.font = "30px Courier New, monospace";
    g.fillText(title, W / 2, 164);
    g.fillStyle = COLORS.white;
    g.font = "17px Courier New, monospace";
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, 220 + i * 24);
    g.textAlign = "left";
  }
}

const game = new Game();
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (game.state !== "pause" && game.state !== "title" && game.state !== "gameOver" && game.state !== "waveComplete") {
    game.update(dt);
  } else {
    game.update(0);
  }
  game.draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
