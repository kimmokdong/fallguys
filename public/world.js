// 이동·충돌은 서버에서 판정하고 같은 장애물 시간을 화면에 전달합니다.
export { MAPS, createCourse, availableMaps } from './courses.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function platformTiming(platform, timeSeconds, collapsed = {}) {
  if (platform.type === 'collapse') {
    const touched = collapsed[platform.id];
    if (touched === undefined) return { active: true, remaining: Infinity, warning: false };
    const elapsed = timeSeconds - touched, delay = platform.delay || 1;
    const active = elapsed < delay || (platform.recover > 0 && elapsed >= delay + platform.recover);
    return { active, remaining: Math.max(0, delay - elapsed), warning: active && elapsed < delay };
  }
  if (platform.type === 'sink') {
    const remaining = platform.sinkAt - timeSeconds;
    return { active: remaining > 0, remaining, warning: remaining > 0 && remaining <= 2 };
  }
  if (timeSeconds < (platform.warmup || 0)) return { active: true, remaining: Infinity, warning: false };
  if (platform.type !== 'disappear') return { active: true, remaining: Infinity, warning: false };
  const phase = ((timeSeconds + (platform.phase || 0)) % platform.period + platform.period) % platform.period;
  const active = phase < platform.period * 0.7;
  const remaining = (active ? platform.period * 0.7 : platform.period) - phase;
  return { active, remaining, warning: active && remaining <= 1 };
}

export function platformActive(platform, timeSeconds, collapsed) {
  return platformTiming(platform, timeSeconds, collapsed).active;
}

export function platformPose(platform, timeSeconds) {
  if (platform.type === 'rotating') return { ...platform, rotation: (platform.rotation || 0) + timeSeconds * platform.speed };
  if (platform.type !== 'moving') return platform;
  const pose = { ...platform };
  if (platform.type === 'moving') pose[platform.axis] += Math.sin(timeSeconds * platform.speed + (platform.phase || 0)) * platform.range;
  return pose;
}

// 물리 이동과 바닥 화살표가 같은 월드 방향을 사용합니다.
export function conveyorVelocity(platform) {
  return { x: platform.axis === 'x' ? platform.speed : 0, z: platform.axis === 'x' ? 0 : platform.speed };
}

function spring(player, source, kind) {
  player.springCount = ((player.springCount || 0) + 1) & 65535;
  player.springSource = source.id;
  player.springKind = kind;
  player.springControl = .65;
  player.grounded = false; player.coyoteTime = 0; player.jumpBuffer = 0;
}

export function obstaclePose(obstacle, timeSeconds) {
  let { x, z } = obstacle;
  let y = obstacle.y || 0;
  let rotation = 0;
  const angle = timeSeconds * (obstacle.speed || 0) + (obstacle.phase || 0);
  if (obstacle.type === 'spinner') rotation = angle;
  if (obstacle.type === 'gate') y += (Math.sin(angle) + 1) * obstacle.range / 2;
  if (obstacle.type === 'pendulum') { if (obstacle.axis === 'z') z += Math.sin(angle) * obstacle.range; else x += Math.sin(angle) * obstacle.range; y += Math.abs(Math.sin(angle)) * 1.8; }
  if (['bumper', 'log', 'slider'].includes(obstacle.type) && obstacle.range) {
    if (obstacle.axis === 'z') z += Math.sin(angle) * obstacle.range;
    else x += Math.sin(angle) * obstacle.range;
  }
  let warning = false;
  if (obstacle.type === 'crusher') {
    const phase = ((timeSeconds + obstacle.phase) % obstacle.period + obstacle.period) % obstacle.period;
    warning = phase >= obstacle.period - 1;
    y += phase < 1 ? 0 : phase < 1.6 ? (phase - 1) / .6 * obstacle.range : obstacle.range;
  }
  return { x, y, z, rotation, active: true, warning };
}

export function createRacer(index = 0) {
  const slot = clamp(Math.floor(Number(index) || 0), 0, 29);
  const x = (slot % 6 - 2.5) * 2.4;
  const z = 2 + Math.floor(slot / 6) * 2.1;
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, checkpoint: -1, progress: 0, finished: false, eliminated: false, fallCount: 0, spawnX: x, spawnZ: z, jumpHeld: false, diveHeld: false, diveCooldown: 0, hitCooldown: 0, bounceCooldown: 0, bumpTime: 0, ghostTime: 0, coyoteTime: 0, jumpBuffer: 0, jumpCount: 0, landCount: 0 };
}

export function supportAt(course, x, z, timeSeconds, ceiling = Infinity) {
  let support = null;
  for (const platform of course.platforms) {
    const p = platformPose(platform, timeSeconds), cos = Math.cos(p.rotation || 0), sin = Math.sin(p.rotation || 0);
    const dx = x - p.x, dz = z - p.z, lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    const y = p.y + (p.rise ? clamp(lz / p.run, -.5, .5) * p.rise : 0);
    const inside = p.type === 'rotating' ? Math.hypot(lx / (p.w / 2 + .15), lz / (p.d / 2 + .15)) < 1 : Math.abs(lx) < p.w / 2 + .15 && Math.abs(lz) < p.d / 2 + .15;
    if (y <= ceiling && (!support || y >= support.y) && inside && platformActive(p, timeSeconds, course.collapsed)) support = { ...p, y };
  }
  return support;
}

export function stepPlayer(player, input = {}, course, timeSeconds, delta, settle = true) {
  if (player.finished || player.eliminated) return;
  const dt = clamp(Number(delta) || 1 / 30, 0.001, 0.06);
  let ix = clamp(Number(input.x) || 0, -1, 1);
  let iz = clamp(Number(input.z) || 0, -1, 1);
  const magnitude = Math.hypot(ix, iz);
  if (magnitude > 1) { ix /= magnitude; iz /= magnitude; }
  const jump = !!input.jump && !player.jumpHeld;
  const dive = !!input.dive && !player.diveHeld;
  player.jumpHeld = !!input.jump; player.diveHeld = !!input.dive;
  for (const key of ['diveCooldown', 'hitCooldown', 'bounceCooldown', 'bumpTime', 'ghostTime', 'springControl']) player[key] = Math.max(0, (player[key] || 0) - dt);
  if (player.grounded && player.supportId) {
    const platform = course.platforms.find(p => p.id === player.supportId);
    if (platform?.type === 'moving') {
      const before = platformPose(platform, Math.max(0, timeSeconds - dt)), after = platformPose(platform, timeSeconds);
      player.x += after.x - before.x; player.y += after.y - before.y; player.z += after.z - before.z;
    }
    if (platform?.type === 'rotating') {
      const angle = platform.speed * dt, cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = player.x - platform.x, dz = player.z - platform.z;
      player.x = platform.x + dx * cos + dz * sin;
      player.z = platform.z - dx * sin + dz * cos;
    }
  }
  const floor = supportAt(course, player.x, player.z, timeSeconds, player.y + 0.08);
  player.grounded = !!floor && Math.abs(player.y - floor.y) < 0.1 && player.vy === 0;
  player.coyoteTime = player.grounded ? 0.1 : Math.max(0, (player.coyoteTime || 0) - dt);
  player.jumpBuffer = jump ? 0.12 : Math.max(0, (player.jumpBuffer || 0) - dt);
  const ice = player.grounded && floor.type === 'ice';
  player.surface = player.grounded ? ({ ice: 1, conveyor: 2, rotating: 3, trampoline: 4 }[floor.type] || 0) : 0;
  const acceleration = player.grounded ? 16 : player.springControl > 0 ? .8 : 5.5;
  const smoothing = 1 - Math.exp(-acceleration * dt);
  if (ice) {
    // 진행 관성을 유지한 채 힘을 더하므로 코너에서 실제로 옆으로 미끄러집니다.
    const drag = Math.exp(-.65 * dt);
    player.vx = player.vx * drag + ix * 8 * dt;
    player.vz = player.vz * drag + iz * 8 * dt;
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 11.5) { player.vx *= 11.5 / speed; player.vz *= 11.5 / speed; }
  } else {
    player.vx += (ix * 10 - player.vx) * smoothing;
    player.vz += (iz * 10 - player.vz) * smoothing;
  }
  if (magnitude > 0.1) player.yaw = Math.atan2(ix, iz);
  if (player.jumpBuffer > 0 && player.coyoteTime > 0) {
    player.vy = 10.4; player.grounded = false; player.coyoteTime = 0; player.jumpBuffer = 0; player.jumpCount++;
  }
  if (dive && player.diveCooldown <= 0) {
    const direction = magnitude > 0.1 ? Math.atan2(ix, iz) : player.yaw;
    player.vx = Math.sin(direction) * 18; player.vz = Math.cos(direction) * 18;
    player.vy = player.grounded ? 5.5 : Math.min(player.vy, 1);
    player.grounded = false; player.diveCooldown = 1.2;
    player.coyoteTime = 0; player.jumpBuffer = 0;
  }
  let driftX = 0; let driftZ = 0;
  if (player.grounded && floor.type === 'conveyor') {
    const belt = conveyorVelocity(floor); driftX = belt.x; driftZ = belt.z;
  }
  for (const obstacle of course.obstacles) {
    if (obstacle.type !== 'fan') continue;
    if (course.rule === 'survival' && timeSeconds < 3) continue;
    if (Math.abs(player.x - obstacle.x) < obstacle.w / 2 && Math.abs(player.z - obstacle.z) < obstacle.d / 2 && player.y < obstacle.h) {
      const force = obstacle.force * (0.7 + 0.3 * Math.sin(timeSeconds * obstacle.speed + obstacle.phase));
      if (obstacle.axis === 'x') player.vx += force * dt;
      else player.vz += force * dt;
    }
  }
  const previousY = player.y;
  const wasAirborne = !player.grounded;
  player.x += (player.vx + driftX) * dt; player.z += (player.vz + driftZ) * dt;
  player.vy -= 25 * dt; player.y += player.vy * dt;

  // 위에서 내려오는 착지만 인정하므로 계단은 점프해서 올라야 합니다.
  const landing = supportAt(course, player.x, player.z, timeSeconds, previousY + 0.1);
  player.grounded = false;
  if (landing && player.vy <= 0 && player.y <= landing.y && previousY >= landing.y - 0.1) {
    player.y = landing.y; player.vy = 0; player.grounded = true; player.supportId = landing.id;
    if (wasAirborne) player.landCount++;
    if (landing.type === 'trampoline' && player.bounceCooldown <= 0) {
      player.vy = landing.force || 17;
      player.vx += landing.pushX || 0; player.vz += landing.pushZ || 0;
      player.bounceCooldown = .75;
      spring(player, landing, 2);
    } else if (player.jumpBuffer > 0) {
      player.vy = 10.4; player.grounded = false; player.coyoteTime = 0; player.jumpBuffer = 0; player.jumpCount++;
    }
  }

  resolveCourseContacts(player, course, timeSeconds);
  if (settle) settlePlayer(player, course, timeSeconds);
}

function resolveCourseContacts(player, course, timeSeconds, hazards = true) {
  // 높은 발판의 옆면 충돌도 처리해 계단 내부로 뚫고 들어가지 않게 합니다.
  for (const platform of course.platforms) {
    const p = platformPose(platform, timeSeconds);
    if (p.rise || p.y <= player.y + 0.3 || p.y - 0.8 >= player.y + 1.65 || !platformActive(p, timeSeconds, course.collapsed)) continue;
    resolveBox(player, p.x, p.z, p.w, p.d, p.rotation || 0, p.type === 'rotating');
  }
  for (const obstacle of course.obstacles) {
    if (course.rule === 'survival' && timeSeconds < 3) continue;
    if (obstacle.type === 'fan') continue;
    const pose = obstaclePose(obstacle, timeSeconds);
    if (obstacle.type === 'bouncer') {
      if (hazards && player.bounceCooldown <= 0 && player.y >= pose.y - 0.2 && player.y <= pose.y + 0.5 && player.vy <= 0 && Math.abs(player.x - pose.x) < obstacle.w / 2 && Math.abs(player.z - pose.z) < obstacle.d / 2) {
        player.vy = obstacle.force; player.vx += obstacle.pushX || 0; player.vz += obstacle.pushZ || 0; player.grounded = false; player.bounceCooldown = 0.7;
        spring(player, obstacle, 2);
      }
      continue;
    }
    if (player.y >= pose.y + obstacle.h || player.y + 1.65 <= pose.y) continue;
    const incomingX = player.vx, incomingZ = player.vz;
    const hit = resolveBox(player, pose.x, pose.z, obstacle.w, obstacle.d, pose.rotation, ['bumper', 'pendulum', 'cushion'].includes(obstacle.type));
    if (hazards && hit && obstacle.type === 'cushion' && player.hitCooldown <= 0) {
      const closing = Math.max(0, -incomingX * hit.x - incomingZ * hit.z);
      const rebound = Math.min(25, 10 + closing * 1.05);
      player.vx += hit.x * rebound; player.vz += hit.z * rebound;
      const speed = Math.hypot(player.vx, player.vz);
      if (speed > 28) { player.vx *= 28 / speed; player.vz *= 28 / speed; }
      player.vy = Math.min(9, 5 + closing * .2); player.hitCooldown = .55;
      spring(player, obstacle, 1);
      continue;
    }
    if (hazards && hit && obstacle.type !== 'wall' && obstacle.type !== 'gate' && player.hitCooldown <= 0) {
      player.vx += hit.x * (obstacle.type === 'bumper' ? 15 : 10);
      player.vz += hit.z * (obstacle.type === 'bumper' ? 15 : 10);
      player.vy = Math.max(player.vy, 4.5); player.grounded = false; player.hitCooldown = 0.3;
      player.coyoteTime = 0;
    }
  }
}

function settlePlayer(player, course, timeSeconds) {
  const floor = supportAt(course, player.x, player.z, timeSeconds, player.y + .12);
  if (player.grounded && !floor) player.grounded = false;
  if (player.grounded && floor?.type === 'collapse' && (course.rule !== 'survival' || timeSeconds >= 3)) {
    course.collapsed ||= {};
    const previous = course.collapsed[floor.id];
    if (previous === undefined || (floor.recover > 0 && timeSeconds >= previous + floor.delay + floor.recover)) course.collapsed[floor.id] = timeSeconds;
  }
  if (course.rule !== 'survival') {
    const next = course.checkpoints[player.checkpoint + 1];
    if (player.grounded && next && Math.hypot(player.x-next.x,player.z-next.z) <= (next.radius || 5) && Math.abs(player.y-next.y)<.6) player.checkpoint++;
    const target = course.checkpoints[player.checkpoint + 1] || course.finish;
    const previous = course.checkpoints[player.checkpoint] || { x:player.spawnX, z:player.spawnZ };
    if (target) {
      const length = Math.max(1, Math.hypot(target.x-previous.x,target.z-previous.z));
      const along = ((player.x-previous.x)*(target.x-previous.x)+(player.z-previous.z)*(target.z-previous.z))/(length*length);
      player.progress = (player.checkpoint+1+clamp(along,0,.99))/(course.checkpoints.length+1);
    }
    const f = course.finish;
    if (f && player.grounded && player.checkpoint === course.checkpoints.length-1 && Math.hypot(player.x-f.x,player.z-f.z)<=f.radius && Math.abs(player.y-f.y)<.6) {
      player.finished = true; player.finishTime = timeSeconds; player.progress = 1; player.vx = 0; player.vz = 0;
    }
  }
  const bounds=course.bounds || {x:70,minZ:-30,maxZ:course.length+30};
  if (player.y < (course.rule==='survival' ? -3 : -11) || Math.abs(player.x)>bounds.x || player.z<bounds.minZ || player.z>bounds.maxZ) {
    if (course.rule === 'survival') { player.eliminated=true; player.eliminatedAt=timeSeconds; player.vx=0; player.vz=0; return; }
    const point = course.checkpoints[player.checkpoint] || { x: player.spawnX, y: 0, z: player.spawnZ };
    player.x = point.x; player.y = point.y + .15; player.z = point.z;
    player.vx = 0; player.vy = 0; player.vz = 0; player.grounded = false; player.supportId = null;
    player.surface = 0; player.springControl = 0;
    player.fallCount++; player.hitCooldown = .8; player.ghostTime = .85;
    player.coyoteTime = 0; player.jumpBuffer = 0;
  }
}

// 모든 참가자를 먼저 이동시킨 뒤 같은 시점에서 몸통 충돌과 완주를 판정합니다.
export function stepPlayers(players, inputs, course, timeSeconds, delta) {
  const dt = clamp(Number(delta) || 1 / 30, 0.001, 0.06);
  const steps = Math.ceil(dt / (1 / 90));
  for (let step = 0; step < steps; step++) {
    const time = timeSeconds - dt + (step + 1) * dt / steps;
    players.forEach((p, i) => stepPlayer(p, inputs[i], course, time, dt / steps, false));
    // ponytail: 최대 30명이므로 쌍 비교로 충분. 인원 제한을 크게 늘리면 공간 분할한다.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < players.length; i++) {
        const a = players[i];
        if (a.finished || a.eliminated || a.ghostTime > 0 || a.y < -2) continue;
        for (let j = i + 1; j < players.length; j++) {
          const b = players[j];
          if (b.finished || b.eliminated || b.ghostTime > 0 || b.y < -2 || Math.abs(a.y - b.y) >= 1.65) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const distance = Math.hypot(dx, dz), overlap = 1.3 - distance;
          if (overlap <= 0) continue;
          const angle = (i * 17 + j * 7) * 2.39996;
          const nx = distance > 0.0001 ? dx / distance : Math.cos(angle);
          const nz = distance > 0.0001 ? dz / distance : Math.sin(angle);
          a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
          b.x += nx * overlap / 2; b.z += nz * overlap / 2;
          const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
          if (closing > 0) {
            const impulse = Math.min(9, closing * 0.56);
            a.vx -= nx * impulse; a.vz -= nz * impulse;
            b.vx += nx * impulse; b.vz += nz * impulse;
            if (closing > 2) { a.bumpTime = 0.22; b.bumpTime = 0.22; }
          }
        }
      }
      // 몸싸움으로 벽 안에 밀려 들어가지 않도록 환경 충돌을 다시 적용합니다.
      for (const p of players) if (!p.finished && !p.eliminated) resolveCourseContacts(p, course, time, false);
    }
    for (const p of players) if (!p.finished && !p.eliminated) settlePlayer(p, course, time);
  }
}

function resolveBox(player, x, z, w, d, rotation, circular) {
  const radius = 0.54;
  const cos = Math.cos(rotation); const sin = Math.sin(rotation);
  const dx = player.x - x; const dz = player.z - z;
  const lx = dx * cos - dz * sin; const lz = dx * sin + dz * cos;
  let nx; let nz; let penetration;
  if (circular) {
    const distance = Math.hypot(dx, dz);
    penetration = w / 2 + radius - distance;
    if (penetration <= 0) return null;
    nx = distance > 0.001 ? dx / distance : 1; nz = distance > 0.001 ? dz / distance : 0;
  } else {
    const overlapX = w / 2 + radius - Math.abs(lx); const overlapZ = d / 2 + radius - Math.abs(lz);
    if (overlapX <= 0 || overlapZ <= 0) return null;
    if (overlapX < overlapZ) { nx = Math.sign(lx) || 1; nz = 0; penetration = overlapX; }
    else { nx = 0; nz = Math.sign(lz) || -1; penetration = overlapZ; }
    const worldX = nx * cos + nz * sin; nz = -nx * sin + nz * cos; nx = worldX;
  }
  player.x += nx * penetration; player.z += nz * penetration;
  const inward = player.vx * nx + player.vz * nz;
  if (inward < 0) { player.vx -= inward * nx; player.vz -= inward * nz; }
  return { x: nx, z: nz };
}
