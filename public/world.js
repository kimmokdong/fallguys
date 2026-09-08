// 브라우저와 서버가 같은 코스·장애물 시간을 사용합니다. 이동 판정은 서버에서 실행합니다.
const palette = (sky, floor, accent) => ({ sky, floor, accent });

export const MAPS = [
  { id: 'jelly-garden', name: '젤리 정원', subtitle: '첫 달리기는 말랑하게', description: '통통 범퍼와 회전 막대를 지나 결승선으로 달려요.', emoji: '🌷', difficulty: 1, colors: palette('#8d9c8b', '#638364', '#b85c37'), tags: ['범퍼', '회전봉', '입문'] },
  { id: 'spin-city', name: '빙글빙글 시티', subtitle: '회전 타이밍이 생명', description: '다섯 개의 회전 구간에서 빈틈을 찾고 점프하세요.', emoji: '🌀', difficulty: 2, colors: palette('#8d9c8b', '#5d7553', '#b85c37'), tags: ['회전봉', '연속 점프'] },
  { id: 'cloud-hop', name: '구름 징검다리', subtitle: '발밑을 조심하세요', description: '지그재그 구름 발판과 점프 패드를 건너는 하늘 코스.', emoji: '☁️', difficulty: 2, colors: palette('#8d9c8b', '#799075', '#c5a15a'), tags: ['틈새', '발판', '점프패드'] },
  { id: 'ice-express', name: '아이스 익스프레스', subtitle: '브레이크가 필요해', description: '미끄러운 얼음 위에서 움직이는 눈덩이를 피하세요.', emoji: '🧊', difficulty: 2, colors: palette('#8b9d96', '#4c7a78', '#b85c37'), tags: ['빙판', '이동 범퍼'] },
  { id: 'neon-factory', name: '네온 팩토리', subtitle: '벨트를 거슬러 달려', description: '방향이 다른 컨베이어와 압축 게이트가 기다려요.', emoji: '⚙️', difficulty: 2, colors: palette('#697d72', '#637665', '#c5a15a'), tags: ['컨베이어', '게이트'] },
  { id: 'wind-valley', name: '바람 골짜기', subtitle: '돌풍을 이겨내요', description: '양옆의 송풍기가 밀어내는 좁은 능선을 달리세요.', emoji: '🌬️', difficulty: 2, colors: palette('#a4a18b', '#8c835c', '#b85c37'), tags: ['돌풍', '좁은 길'] },
  { id: 'door-festival', name: '문 열려라 축제', subtitle: '열린 문을 찾아라', description: '세 갈래 게이트가 서로 다른 박자로 열리고 닫혀요.', emoji: '🚪', difficulty: 1, colors: palette('#a3a58b', '#8c9369', '#b85c37'), tags: ['타이밍', '게이트', '갈림길'] },
  { id: 'pendulum-port', name: '진자 항구', subtitle: '좌우로 흔들리는 위기', description: '커다란 진자가 가로지르는 부두를 건너세요.', emoji: '⚓', difficulty: 2, colors: palette('#889d96', '#5a7c72', '#c5a15a'), tags: ['진자', '좁은 길'] },
  { id: 'blink-trail', name: '반짝 사라진 길', subtitle: '발판에도 리듬이 있어', description: '주황색 경고가 뜨면 1초 안에 발판이 사라져요. 안전한 섬에서 타이밍을 보세요.', emoji: '✨', difficulty: 3, colors: palette('#384d44', '#637f68', '#c5a15a'), tags: ['사라지는 발판', '타이밍'] },
  { id: 'candy-climb', name: '캔디 계단', subtitle: '달콤한 정상까지', description: '점프로 사탕 계단을 오르고 마지막 미끄럼 구간을 내려와요.', emoji: '🍬', difficulty: 2, colors: palette('#a4a18d', '#928468', '#b85c37'), tags: ['높이차', '계단', '점프'] },
  { id: 'pinball-park', name: '핀볼 파크', subtitle: '통통 튀는 대모험', description: '범퍼 사이를 누비고 점프 패드를 타고 날아오르세요.', emoji: '🎯', difficulty: 2, colors: palette('#929f86', '#638663', '#c5a15a'), tags: ['범퍼', '점프패드', '통통'] },
  { id: 'chaos-crown', name: '왕관 대소동', subtitle: '모든 실력을 한 번에', description: '얼음, 돌풍, 회전봉, 발판과 진자가 총출동하는 마지막 도전.', emoji: '👑', difficulty: 3, colors: palette('#7d8d7b', '#6d7d58', '#b85c37'), tags: ['종합', '긴 코스', '고난도'] },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createCourse(mapId) {
  const info = MAPS.find((map) => map.id === mapId) || MAPS[0];
  const course = { ...info, width: 24, length: 152, platforms: [], obstacles: [], checkpoints: [] };
  const platform = (x, z, w, d, y = 0, extra = {}) => course.platforms.push({ x, z, w, d, y, type: 'normal', ...extra });
  const obstacle = (type, x, z, w, d, h, extra = {}) => course.obstacles.push({ id: `${info.id}-${course.obstacles.length}`, type, x, z, w, d, h, y: 0, speed: 1, phase: 0, range: 0, axis: 'x', ...extra });
  const checkpoint = (z, y = 0, x = 0) => course.checkpoints.push({ x, z, y });
  const runway = () => platform(0, course.length / 2, 24, course.length + 12);
  const bumper = (x, z, size = 2.4, extra = {}) => obstacle('bumper', x, z, size, size, 2.2, extra);
  const spinner = (x, z, w = 17, speed = 1.2, phase = 0) => obstacle('spinner', x, z, w, 0.8, 0.8, { y: 0.25, speed, phase });
  const wall = (x, z, w, d = 1.1, h = 2.5) => obstacle('wall', x, z, w, d, h);
  const gate = (x, z, w = 7.4, phase = 0) => obstacle('gate', x, z, w, 1.2, 3, { range: 4.5, speed: 1.5, phase });
  const fan = (x, z, w, d, force, axis = 'x', phase = 0) => obstacle('fan', x, z, w, d, 4, { force, axis, phase, speed: 1.3 });
  const bounce = (x, z, w = 4, d = 4) => obstacle('bouncer', x, z, w, d, 0.22, { force: 13.5 });

  switch (info.id) {
    case 'jelly-garden':
      runway();
      [-7, 0, 7].forEach((x) => bumper(x, 31));
      [-3.5, 3.5].forEach((x) => bumper(x, 44, 3));
      spinner(0, 65, 17, 0.9);
      wall(-6.5, 86, 11); wall(6.5, 102, 11);
      [-7, 0, 7].forEach((x, i) => bumper(x, 122, 2.4, { range: 2.2, speed: 1.5, phase: i * 2 }));
      checkpoint(53); checkpoint(110);
      break;
    case 'spin-city':
      runway();
      [32, 56, 82, 106, 130].forEach((z, i) => {
        spinner(i % 2 ? -3 : 3, z, i === 4 ? 21 : 17, (i % 2 ? -1 : 1) * (1.1 + i * 0.18), i);
        if (i < 4) bumper(i % 2 ? 8 : -8, z + 7, 2);
      });
      checkpoint(68); checkpoint(117);
      break;
    case 'cloud-hop':
      platform(0, 8, 24, 24);
      [28, 41, 54, 82, 95, 108].forEach((z, i) => platform(i % 2 ? 3.5 : -3.5, z, 11, 10));
      platform(0, 67, 24, 10); platform(0, 122, 24, 12); platform(0, 142, 24, 22);
      bounce(-3.5, 29); bounce(3.5, 95);
      bumper(0, 66); spinner(0, 140, 17, 0.8);
      checkpoint(69); checkpoint(124);
      break;
    case 'ice-express':
      platform(0, 8, 24, 24); platform(0, 81, 24, 122, 0, { type: 'ice' }); platform(0, 147, 24, 16);
      [33, 52, 78, 99, 122].forEach((z, i) => bumper(0, z, 3.4, { range: 8, speed: 0.75 + i * 0.12, phase: i * 1.7 }));
      wall(-8, 64, 7); wall(8, 110, 7);
      checkpoint(65); checkpoint(110);
      break;
    case 'neon-factory':
      runway();
      [-8, 0, 8].forEach((x, i) => platform(x, 78, 7.6, 116, 0.015, { type: 'conveyor', axis: 'z', speed: i === 1 ? 4 : -4 }));
      [43, 83, 123].forEach((z, row) => [-8, 0, 8].forEach((x, i) => gate(x, z, 7.4, i * 2.1 + row)));
      wall(0, 62, 7); wall(-8, 103, 7); wall(8, 103, 7);
      checkpoint(69, 0.015); checkpoint(111, 0.015);
      break;
    case 'wind-valley':
      platform(0, 8, 24, 24); platform(0, 78, 13, 116); platform(0, 143, 24, 20);
      [34, 59, 91, 119].forEach((z, i) => fan(0, z, 13, 16, i % 2 ? -24 : 24, 'x', i));
      bumper(-3, 46, 2.5); bumper(3, 104, 2.5); spinner(0, 77, 10, 1.1);
      checkpoint(68); checkpoint(107);
      break;
    case 'door-festival':
      runway();
      [34, 60, 90, 119].forEach((z, row) => {
        [-8, 0, 8].forEach((x, i) => gate(x, z, 7.4, i * Math.PI * 2 / 3 + row * 0.8));
        [-12, -4, 4, 12].forEach((x) => obstacle('wall', x, z, 0.6, 2.2, 5, { color: '#f4e7ff' }));
      });
      checkpoint(73); checkpoint(132);
      break;
    case 'pendulum-port':
      platform(0, 8, 24, 24); platform(0, 78, 15, 116); platform(0, 144, 24, 22);
      [33, 54, 80, 105, 125].forEach((z, i) => obstacle('pendulum', 0, z, 3.5, 3.5, 3.5, { y: 0.1, range: 7.2, speed: 1.3 + i * 0.12, phase: i * 1.4 }));
      checkpoint(66); checkpoint(114);
      break;
    case 'blink-trail':
      platform(0, 8, 24, 24);
      [28, 41, 54, 82, 95, 108].forEach((z, row) => [-7, 0, 7].forEach((x, lane) => platform(x, z, 6.7, 10, 0, { type: 'disappear', period: 4.8, phase: lane * 1.6 + row * 0.5 })));
      platform(0, 67, 24, 10); platform(0, 122, 24, 12); platform(0, 142, 24, 22);
      checkpoint(68); checkpoint(122);
      break;
    case 'candy-climb':
      platform(0, 8, 24, 24);
      [25, 35, 45, 55, 65].forEach((z, i) => platform(0, z, 20 - i, 10, (i + 1) * 0.8));
      platform(0, 78, 24, 16, 4); spinner(0, 79, 17, 0.9); course.obstacles.at(-1).y += 4;
      [91, 101, 111, 121, 131].forEach((z, i) => platform(0, z, 17 + i, 10, (4 - i) * 0.8));
      platform(0, 144, 24, 18);
      bumper(-5, 100, 2.5); course.obstacles.at(-1).y = 2.4;
      bumper(5, 120, 2.5); course.obstacles.at(-1).y = 0.8;
      checkpoint(73, 4); checkpoint(139);
      break;
    case 'pinball-park':
      runway();
      [31, 52, 81, 108, 128].forEach((z, row) => [-7, 0, 7].forEach((x, i) => bumper(x + (row % 2 ? 2 : -1), z + (i % 2 ? 6 : 0), 2.7, { range: row % 2 ? 1.3 : 0, speed: 1.7, phase: i })));
      bounce(0, 43, 5, 4); bounce(-5, 68); bounce(5, 98);
      checkpoint(70); checkpoint(118);
      break;
    case 'chaos-crown':
      course.length = 214;
      platform(0, 8, 24, 24); platform(0, 36, 24, 32, 0, { type: 'ice' });
      platform(0, 68, 16, 32); platform(0, 100, 24, 32, 0, { type: 'conveyor', speed: -3, axis: 'z' });
      platform(-3.5, 123, 12, 10); platform(3.5, 137, 12, 10); platform(0, 152, 24, 14);
      platform(0, 178, 17, 38); platform(0, 207, 24, 22);
      bumper(0, 35, 3, { range: 8, speed: 1.3 }); fan(0, 66, 16, 22, 20);
      spinner(0, 94, 18, 1.8); [-8, 0, 8].forEach((x, i) => gate(x, 111, 7.4, i * 2));
      [170, 188].forEach((z, i) => obstacle('pendulum', 0, z, 3.3, 3.3, 3.3, { range: 7, speed: 1.8, phase: i * 2 }));
      checkpoint(54); checkpoint(103); checkpoint(152);
      break;
  }
  // 마지막 캠프에서 넓은 우회로와 짧은 점프길 중 하나를 고른다.
  const forkZ = course.length + 10;
  platform(0, forkZ - 6, 26, 18);
  checkpoint(forkZ - 8);
  const safePoints = [[8, 0], [8, 8], [3, 8], [3, 20], [10, 20], [10, 32], [3, 32], [3, 44], [8, 44], [8, 48]].map(([x, z]) => ({ x, z: forkZ + z }));
  for (let i = 1; i < safePoints.length; i++) {
    const a = safePoints[i - 1], b = safePoints[i];
    platform((a.x + b.x) / 2, (a.z + b.z) / 2, Math.abs(b.x - a.x) + 4.8, Math.abs(b.z - a.z) + 4.8, 0, { route: 'safe' });
  }
  const gap = info.difficulty === 1 ? 3 : info.difficulty === 2 ? 3.6 : 4;
  for (let i = 0; i < 5; i++) platform(-7, forkZ + 3 + i * 10.5, 3.6, 10.5 - gap, 0, { route: 'shortcut' });
  platform(0, forkZ + 55, 26, 19);
  course.routes = { startZ: forkZ, endZ: forkZ + 48, safePoints, shortcutX: -7, gap };
  course.finishZ = forkZ + 56;
  course.length = course.finishZ + 8;
  return course;
}

export function platformTiming(platform, timeSeconds) {
  if (platform.type !== 'disappear') return { active: true, remaining: Infinity, warning: false };
  const phase = ((timeSeconds + (platform.phase || 0)) % platform.period + platform.period) % platform.period;
  const active = phase < platform.period * 0.7;
  const remaining = (active ? platform.period * 0.7 : platform.period) - phase;
  return { active, remaining, warning: active && remaining <= 1 };
}

export function platformActive(platform, timeSeconds) {
  return platformTiming(platform, timeSeconds).active;
}

export function obstaclePose(obstacle, timeSeconds) {
  let { x, z } = obstacle;
  let y = obstacle.y || 0;
  let rotation = 0;
  const angle = timeSeconds * obstacle.speed + obstacle.phase;
  if (obstacle.type === 'spinner') rotation = angle;
  if (obstacle.type === 'gate') y += (Math.sin(angle) + 1) * obstacle.range / 2;
  if (obstacle.type === 'pendulum') { x += Math.sin(angle) * obstacle.range; y += Math.abs(Math.sin(angle)) * 1.8; }
  if (obstacle.type === 'bumper' && obstacle.range) {
    if (obstacle.axis === 'z') z += Math.sin(angle) * obstacle.range;
    else x += Math.sin(angle) * obstacle.range;
  }
  return { x, y, z, rotation, active: true };
}

export function createRacer(index = 0) {
  const slot = clamp(Math.floor(Number(index) || 0), 0, 29);
  const x = (slot % 6 - 2.5) * 2.4;
  const z = 2 + Math.floor(slot / 6) * 2.1;
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, checkpoint: -1, finished: false, fallCount: 0, spawnX: x, spawnZ: z, jumpHeld: false, diveHeld: false, diveCooldown: 0, hitCooldown: 0, bounceCooldown: 0, bumpTime: 0, ghostTime: 0, coyoteTime: 0, jumpBuffer: 0, jumpCount: 0, landCount: 0 };
}

function supportAt(course, x, z, timeSeconds, ceiling = Infinity) {
  let support = null;
  for (const p of course.platforms) {
    if (p.y <= ceiling && (!support || p.y >= support.y) && Math.abs(x - p.x) < p.w / 2 + 0.15 && Math.abs(z - p.z) < p.d / 2 + 0.15 && platformActive(p, timeSeconds)) support = p;
  }
  return support;
}

export function stepPlayer(player, input = {}, course, timeSeconds, delta, settle = true) {
  if (player.finished) return;
  const dt = clamp(Number(delta) || 1 / 30, 0.001, 0.06);
  let ix = clamp(Number(input.x) || 0, -1, 1);
  let iz = clamp(Number(input.z) || 0, -1, 1);
  const magnitude = Math.hypot(ix, iz);
  if (magnitude > 1) { ix /= magnitude; iz /= magnitude; }
  const jump = !!input.jump && !player.jumpHeld;
  const dive = !!input.dive && !player.diveHeld;
  player.jumpHeld = !!input.jump; player.diveHeld = !!input.dive;
  for (const key of ['diveCooldown', 'hitCooldown', 'bounceCooldown', 'bumpTime', 'ghostTime']) player[key] = Math.max(0, (player[key] || 0) - dt);
  const floor = supportAt(course, player.x, player.z, timeSeconds, player.y + 0.08);
  player.grounded = !!floor && Math.abs(player.y - floor.y) < 0.1 && player.vy === 0;
  player.coyoteTime = player.grounded ? 0.1 : Math.max(0, (player.coyoteTime || 0) - dt);
  player.jumpBuffer = jump ? 0.12 : Math.max(0, (player.jumpBuffer || 0) - dt);
  const ice = player.grounded && floor.type === 'ice';
  const acceleration = ice ? 2.2 : player.grounded ? 16 : 5.5;
  const smoothing = 1 - Math.exp(-acceleration * dt);
  player.vx += (ix * 10 - player.vx) * smoothing;
  player.vz += (iz * 10 - player.vz) * smoothing;
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
    if (floor.axis === 'x') driftX = floor.speed;
    else driftZ = floor.speed;
  }
  for (const obstacle of course.obstacles) {
    if (obstacle.type !== 'fan') continue;
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
    player.y = landing.y; player.vy = 0; player.grounded = true;
    if (wasAirborne) player.landCount++;
    if (player.jumpBuffer > 0) {
      player.vy = 10.4; player.grounded = false; player.coyoteTime = 0; player.jumpBuffer = 0; player.jumpCount++;
    }
  }

  resolveCourseContacts(player, course, timeSeconds);
  if (settle) settlePlayer(player, course, timeSeconds);
}

function resolveCourseContacts(player, course, timeSeconds, hazards = true) {
  // 높은 발판의 옆면 충돌도 처리해 계단 내부로 뚫고 들어가지 않게 합니다.
  for (const p of course.platforms) {
    if (p.y <= player.y + 0.3 || p.y - 0.8 >= player.y + 1.65 || !platformActive(p, timeSeconds)) continue;
    resolveBox(player, p.x, p.z, p.w, p.d, 0, false);
  }
  for (const obstacle of course.obstacles) {
    if (obstacle.type === 'fan') continue;
    const pose = obstaclePose(obstacle, timeSeconds);
    if (obstacle.type === 'bouncer') {
      if (hazards && player.bounceCooldown <= 0 && player.y >= pose.y - 0.2 && player.y <= pose.y + 0.5 && player.vy <= 0 && Math.abs(player.x - pose.x) < obstacle.w / 2 && Math.abs(player.z - pose.z) < obstacle.d / 2) {
        player.vy = obstacle.force; player.grounded = false; player.bounceCooldown = 0.7;
        player.coyoteTime = 0;
      }
      continue;
    }
    if (player.y >= pose.y + obstacle.h || player.y + 1.65 <= pose.y) continue;
    const hit = resolveBox(player, pose.x, pose.z, obstacle.w, obstacle.d, pose.rotation, obstacle.type === 'bumper' || obstacle.type === 'pendulum');
    if (hazards && hit && obstacle.type !== 'wall' && obstacle.type !== 'gate' && player.hitCooldown <= 0) {
      player.vx += hit.x * (obstacle.type === 'bumper' ? 15 : 10);
      player.vz += hit.z * (obstacle.type === 'bumper' ? 15 : 10);
      player.vy = Math.max(player.vy, 4.5); player.grounded = false; player.hitCooldown = 0.3;
      player.coyoteTime = 0;
    }
  }
}

function settlePlayer(player, course, timeSeconds) {
  if (player.grounded && !supportAt(course, player.x, player.z, timeSeconds, player.y + 0.08)) player.grounded = false;
  if (player.grounded) {
    for (let i = player.checkpoint + 1; i < course.checkpoints.length; i++) {
      const point = course.checkpoints[i];
      if (player.z >= point.z - 1 && Math.abs(player.y - point.y) < 0.4) player.checkpoint = i;
    }
    if (player.z >= course.finishZ && Math.abs(player.x) < course.width / 2) {
      player.finished = true; player.finishTime = timeSeconds; player.vx = 0; player.vz = 0;
    }
  }
  if (player.y < -11 || Math.abs(player.x) > 70 || player.z < -30 || player.z > course.length + 30) {
    const point = course.checkpoints[player.checkpoint] || { x: player.spawnX, y: 0, z: player.spawnZ };
    player.x = point.x; player.y = point.y + 0.15; player.z = point.z;
    player.vx = 0; player.vy = 0; player.vz = 0; player.grounded = false;
    player.fallCount++; player.hitCooldown = 0.8; player.ghostTime = 0.85;
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
        if (a.finished || a.ghostTime > 0 || a.y < -2) continue;
        for (let j = i + 1; j < players.length; j++) {
          const b = players[j];
          if (b.finished || b.ghostTime > 0 || b.y < -2 || Math.abs(a.y - b.y) >= 1.65) continue;
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
      for (const p of players) if (!p.finished) resolveCourseContacts(p, course, time, false);
    }
    for (const p of players) if (!p.finished) settlePlayer(p, course, time);
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
