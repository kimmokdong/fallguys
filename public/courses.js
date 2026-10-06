// 맵의 동선과 규칙을 서버·화면에서 함께 사용합니다.
const palette = (floor, sky = '#8d9c8b', accent = '#b85c37') => ({ floor, sky, accent });
const map = (id, name, emoji, difficulty, description, tags, colors, rules = ['race'], final = false) => ({ id, name, emoji, difficulty, description, subtitle: tags.join(' · '), tags, colors, rules, final, maxPlayers: 30 });
export const MAPS = [
  map('jelly-garden', '젤리 정원', '🌷', 1, '젤리 쿠션에 달려들면 통통 튕겨요. 굽이치는 정원길의 번호 깃발을 지나세요.', ['S자 산책길', '탄성 쿠션'], palette('#638364')),
  map('spin-city', '빙글빙글 시티', '🌀', 2, '원판과 함께 몸이 돌아가요! 원하는 출구에서 내리고 회전봉은 점프로 피하세요.', ['회전 원판', '회전봉'], palette('#5d7553'), ['race', 'survival'], true),
  map('cloud-hop', '구름 징검다리', '☁️', 2, '노란 트램펄린은 높이 띄워줘요. 공중에서 방향을 잡아 다음 섬에 착지하세요.', ['공중 섬', '트램펄린'], palette('#799075')),
  map('ice-express', '아이스 익스프레스', '🧊', 2, '손을 떼도 쭉 미끄러져요. U자 코너 전에 반대 방향으로 브레이크를 잡으세요.', ['드리프트 빙판', '이동 장애물'], palette('#4c7a78', '#8b9d96')),
  map('neon-factory', '숲속 팩토리', '⚙️', 2, '화살표 방향으로 강하게 흐르는 벨트! 역방향은 점프하고 압축기 경고를 살피세요.', ['강력 컨베이어', '압축기'], palette('#637665', '#697d72', '#c5a15a')),
  map('wind-valley', '바람 골짜기', '🌬️', 2, '지그재그 능선을 따라가요. 바람을 맞으면 바위 뒤에서 숨을 고르세요.', ['지그재그 능선', '돌풍'], palette('#8c835c', '#a4a18b')),
  map('door-festival', '문 열려라 축제', '🚪', 1, '좌우 어느 길도 좋아요. 열린 문을 찾아 합류 지점의 깃발로 모이세요.', ['갈림길', '오르내리는 문'], palette('#8c9369', '#a3a58b')),
  map('pendulum-port', '진자 항구', '⚓', 2, '옆으로 뻗은 부두와 왕복 뗏목을 건너요. 진자가 지나간 뒤 출발하세요.', ['가로 부두', '왕복 뗏목'], palette('#5a7c72', '#889d96')),
  map('blink-trail', '반짝 사라진 길', '✨', 3, '밟은 발판은 주황색으로 변한 뒤 사라져요. 레이스에서는 잠시 후 돌아와요.', ['밟으면 붕괴', '타일 광장'], palette('#637f68', '#596d60', '#c5a15a'), ['race', 'survival'], true),
  map('candy-climb', '도토리 전망대', '🍬', 2, '전망대를 감아 오르는 경사길이에요. 위층으로 올라가 정상에서 완주하세요.', ['입체 오르막', '나선 동선'], palette('#928468', '#a4a18d')),
  map('pinball-park', '핀볼 파크', '🎯', 2, '젤리 쿠션의 탄성과 트램펄린을 이용해 날아가요. 번호 깃발은 차례로 지나세요.', ['탄성 쿠션', '트램펄린'], palette('#638663', '#929f86', '#c5a15a')),
  map('chaos-crown', '왕관 대소동', '👑', 3, '바깥 능선을 돌아 중앙 정상으로! 회전 다리 뒤 왕관에 먼저 닿으세요.', ['중앙 왕관', '입체 결승'], palette('#6d7d58', '#7d8d7b'), ['race'], true),
  map('leaf-square', '낙엽 마당', '🍂', 2, '발판을 밟으면 1초 뒤 사라져요. 빈자리로 움직이며 마지막까지 버티세요.', ['생존', '발판 붕괴'], palette('#988357', '#929780', '#b85c37'), ['survival'], true),
  map('log-lake', '통나무 호수', '🪵', 2, '낮은 통나무는 점프로! 서로 다른 방향에서 굴러오는 통나무를 피하세요.', ['생존', '굴러오는 통나무'], palette('#658572', '#81968b'), ['survival'], true),
  map('storm-island', '폭풍 섬', '🌪️', 3, '돌풍과 움직이는 벽이 밀어내요. 가장자리 발판은 경고 후 물에 잠겨요.', ['생존', '좁아지는 섬'], palette('#778365', '#7a8a80', '#c5a15a'), ['survival'], true),
  map('tide-tiles', '물결 징검마당', '🌊', 2, '초록 발판을 골라 점프하세요. 주황색 발판은 1초 뒤 잠겨요.', ['생존', '주기적인 침수'], palette('#4f7f77', '#8b9d96', '#c5a15a'), ['survival'], true),
  map('rocket-road', '로켓 고속도로', '🚀', 2, '노란 부스터를 밟으면 앞으로 휙 날아가요. 펀치 벽은 "펀치!" 경고가 뜨면 반대쪽으로 피하세요.', ['가속 패드', '펀치 벽'], palette('#6f7a6a', '#9aa39a', '#d08a3a')),
  map('choco-swamp', '초코 진흙탕', '🍫', 2, '가운데 진흙은 안전하지만 느리고 점프도 낮아요. 빠른 가장자리는 소용돌이가 물로 끌어당겨요.', ['끈적 진흙', '소용돌이'], palette('#6e7d5c', '#93998a', '#a0663c')),
  map('tiptoe-bridge', '진짜 발판 찾기', '🔍', 3, '똑같아 보여도 대부분 가짜 발판! 밟으면 바로 떨어져요. 앞사람이 지나간 길을 기억하세요.', ['가짜 발판', '기억력'], palette('#5f7b80', '#8fa0a3', '#c5a15a'), ['race'], true),
  map('sky-tower', '하늘 엘리베이터', '🛗', 2, '경사길로 돌아 올라가도 되고, 가운데 엘리베이터를 타면 지름길! 타이밍을 맞춰 올라타세요.', ['엘리베이터', '입체 지름길'], palette('#6a7f86', '#a7b4b6', '#c5a15a')),
  map('lava-rise', '용암 피라미드', '🌋', 3, '용암이 점점 차올라요! 계단을 점프해 꼭대기로 올라가고 굴러다니는 범퍼를 피하세요.', ['생존', '차오르는 용암'], palette('#7c6d58', '#a08c7c', '#e0612f'), ['survival'], true),
  map('triple-drop', '3층 붕괴 탑', '🥞', 3, '밟은 발판은 사라지고 아래층으로 떨어져요. 3층을 모두 잃으면 탈락! 빈자리를 남겨 두며 움직이세요.', ['생존', '3층 붕괴'], palette('#8a7f60', '#9b9f93', '#c5a15a'), ['survival'], true),
  map('whirlpool-bay', '소용돌이 만', '🐙', 2, '가운데 구멍이 모두를 빨아들여요. 바깥으로 달려 버티고 낮게 도는 막대는 점프로 넘으세요. 선착장은 20초 뒤 잠겨요.', ['생존', '소용돌이'], palette('#4d7a7d', '#86a0a0', '#c5a15a'), ['survival']),
  map('punch-arena', '펀치 링', '🥊', 2, '사방에서 펀치가 튀어나와요! 모서리 부스터는 탈출용이지만 잘못 타면 밖으로 날아가요. 막판엔 바깥 줄이 잠겨요.', ['생존', '펀치 벽'], palette('#7a7460', '#9d9a8c', '#d0603f'), ['survival']),
];

export const availableMaps = (mode, rule = 'race') => MAPS.filter(m => mode === 'elimination' || m.rules.includes(mode === 'series' ? 'race' : rule));

export function createCourse(mapId, rule = 'race') {
  const info = MAPS.find(m => m.id === mapId) || MAPS[0];
  rule = info.rules.includes(rule) ? rule : info.rules[0];
  const c = { ...info, rule, platforms: [], obstacles: [], checkpoints: [], path: [], collapsed: {} };
  let platformId = 0;
  const p = (x, z, w, d, y = 0, extra = {}) => { const item = { id: 'p' + platformId++, x, z, w, d, y, type: 'normal', rotation: 0, ...extra }; c.platforms.push(item); return item; };
  const o = (type, x, z, w, d, h, extra = {}) => c.obstacles.push({ id: 'o' + c.obstacles.length, type, x, z, w, d, h, y: 0, speed: 1, phase: 0, range: 0, axis: 'x', ...extra });
  const spin = (x, z, width, speed = 1.1, y = .25) => o('spinner', x, z, width, .65, .65, { speed, y });
  const bumper = (x, z, extra = {}) => o('bumper', x, z, 2.5, 2.5, 2.2, extra);
  const cushion = (x, z, size = 3.6) => o('cushion', x, z, size, size, 2.6);
  const trampoline = (x, z, w, d, extra = {}) => p(x, z, w, d, .04, { type: 'trampoline', force: 17, ...extra });
  const turntable = (x, z, size, speed) => p(x, z, size, size, .04, { type: 'rotating', speed });
  const log = (x, z, width, axis = 'z', range = 12, phase = 0) => o('log', x, z, width, 1.2, 1, { axis, range, speed: .85, phase });
  const fan = (x, z, w, d, force, axis = 'x') => o('fan', x, z, w, d, 6, { force, axis, speed: 1.4 });
  // 펀치 벽은 발판 밖 받침에서 dir 방향으로 range만큼 튀어나옵니다.
  const puncher = (x, z, axis, dir, range, phase = 0, y = 0, period = 2.8, force = 20) => o('puncher', x, z, 3, 3, 2.4, { axis, dir, range, phase, period, y, force });
  const vortex = (x, z, size, force, y = 0) => o('vortex', x, z, size, size, 3, { force, y, speed: 1 });
  const booster = (x, z, dirX, dirZ, y = 0, size = 4) => p(x, z, size, size, y + .04, { type: 'boost', dirX, dirZ, power: 19 });
  const mud = (x, z, w, d, y = 0) => p(x, z, w, d, y + .03, { type: 'mud' });
  const lift = (x, z, size, low, high, speed = .9, phase = 0) => p(x, z, size, size, (low + high) / 2, { type: 'moving', axis: 'y', range: (high - low) / 2, speed, phase });
  const point = ([x, z, y = 0]) => ({ x, z, y });
  const bridge = (a, b, width = 10, extra = {}) => {
    const dx = b.x - a.x, dz = b.z - a.z, run = Math.hypot(dx, dz) - (a.y !== b.y ? width : 0);
    return p((a.x + b.x) / 2, (a.z + b.z) / 2, width, run + .8, (a.y + b.y) / 2, { rotation: Math.atan2(dx, dz), rise: b.y - a.y, run, ...extra });
  };
  const route = (nodes, width = 10, extra = {}) => {
    c.path = nodes.map(point);
    for (let i = 1; i < c.path.length; i++) bridge(c.path[i - 1], c.path[i], width, extra);
    for (const node of c.path) p(node.x, node.z, width, width, node.y, extra);
  };
  if (rule === 'survival') {
    const collapse = ['leaf-square', 'blink-trail'].includes(info.id);
    const custom = ['lava-rise', 'triple-drop', 'whirlpool-bay', 'punch-arena'].includes(info.id);
    const size = custom ? 0 : collapse ? 6 : 5;
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const edge = Math.min(row, col, size - 1 - row, size - 1 - col);
      const tile = p((col - (size - 1) / 2) * 4.8, 6 + (row - (size - 1) / 2) * 4.8, 4.8, 4.8);
      if (collapse) Object.assign(tile, { type: 'collapse', delay: 1, recover: 0 });
      if (info.id === 'tide-tiles') Object.assign(tile, { type: 'disappear', period: 6, phase: (col + row) % 3 * 1.8, warmup: 5 });
      if (info.id === 'storm-island') Object.assign(tile, { type: 'sink', sinkAt: 18 + edge * 18 });
    }
    if (info.id === 'spin-city') { c.platforms = []; turntable(0,6,29,.55); spin(0, 6, 22, .85); spin(0, 6, 19, -.7, 2.1); }
    if (info.id === 'log-lake') { log(0, 6, 23, 'z', 14); o('log', 0, 6, 1.2, 23, 1, { axis: 'x', range: 14, speed: .65, phase: 1.9 }); }
    if (info.id === 'storm-island') { fan(0, 6, 24, 24, 100); o('slider', 0, 6, 1, 15, 2, { range: 10, speed: .6 }); }
    if (info.id === 'tide-tiles') spin(0, 6, 17, .6);
    if (info.id === 'lava-rise') {
      // 출발 줄은 가장 낮은 바깥 단에 있고, 가운데로 갈수록 1.5씩 높아집니다.
      p(0, 27, 52, 52); p(0, 27, 32, 32, 1.5); p(0, 27, 20, 20, 3); p(0, 27, 10, 10, 4.5);
      c.flood = { start: 8, rate: .095, from: -1, max: 4.2, color: '#e0612f' };
      for (const [x, z, axis, phase] of [[0, 5, 'x', Math.PI / 2], [0, 48, 'x', 2], [-21, 27, 'z', 1], [21, 27, 'z', 3]]) bumper(x, z, { axis, range: 15, speed: .7, phase });
      for (const [x, z] of [[0, 14], [0, 40]]) bumper(x, z, { axis: 'x', range: 10, speed: -.9, y: 1.5, phase: 1 });
    }
    if (info.id === 'triple-drop') {
      // 위층에서 떨어지면 아래층 발판이 받아 줍니다. 아래층일수록 넓고 구멍 위치가 다릅니다.
      c.spawnY = 12;
      for (const [y, count, skip, color] of [[12, 6, '', '#9a8a5c'], [6, 6, '0,0 0,5 5,0 5,5', '#6f8f69'], [0, 7, '3,3', '#5f8191']]) {
        const holes = new Set(skip.split(' '));
        for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (!holes.has(row + ',' + col))
          p((col - (count - 1) / 2) * 4.8, 6 + (row - (count - 1) / 2) * 4.8, 4.8, 4.8, y, { type: 'collapse', delay: .8, recover: 0, color });
      }
    }
    if (info.id === 'whirlpool-bay') {
      // 선착장에서 출발해 20초 안에 소용돌이 만으로 건너가야 합니다.
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) p((col - 1) * 4.8, .8 + row * 4.8, 4.8, 4.8, 0, { type: 'sink', sinkAt: 20 });
      for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) if (Math.max(Math.abs(row - 3), Math.abs(col - 3)) > 1) p((col - 3) * 4.8, 29.6 + (row - 3) * 4.8, 4.8, 4.8);
      vortex(0, 29.6, 30, 55); spin(0, 29.6, 42, .55, .25);
    }
    if (info.id === 'punch-arena') {
      for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
        const edge = Math.min(row, col, 5 - row, 5 - col) === 0;
        p((col - 2.5) * 4.8, 6 + (row - 2.5) * 4.8, 4.8, 4.8, 0, edge ? { type: 'sink', sinkAt: 36 + (row + col) % 3 * 3 } : {});
      }
      // 한 변에 세 줄씩, 가운데 줄은 링 한복판을 지나도록 깊게 튀어나옵니다.
      for (const [i, side] of [-1, 1].entries()) for (const [j, offset] of [-6, 0, 6].entries()) {
        const range = offset ? 11 : 15;
        puncher(side * 16, 6 + offset, 'x', -side, range, i * 1.6 + j * 1.07, 0, 3.2, 25);
        puncher(offset, 6 + side * 16, 'z', -side, range, i * 1.6 + j * 1.07 + .53, 0, 3.2, 25);
      }
      for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) booster(x * 7.2, 6 + z * 7.2, -x * Math.SQRT1_2, -z * Math.SQRT1_2, 0, 3.6);
    }
    c.path = [{ x: 0, z: 6, y: 0 }];
    c.finish = null;
  } else {
    p(0, 6, 22, 16);
    switch (info.id) {
      case 'jelly-garden':
        route([[0,6],[0,28],[24,28],[24,52],[-4,52],[-4,76],[18,76]], 12);
        cushion(-3,20,3.2); bumper(5,27); spin(24,40,11,.8);
        o('slider',9,52,1,9,2.2,{axis:'z',range:3.5,speed:1.3});
        o('slider',7,76,1.1,9,2.2,{axis:'z',range:5,speed:1.1});
        break;
      case 'spin-city':
        route([[0,6],[0,32],[26,32],[26,6],[26,-18],[0,-18]], 12);
        spin(0,25,11); turntable(14,32,14,-1.15); turntable(26,15,14,1); spin(26,-10,11,-1.2); spin(8,-18,11,.7);
        break;
      case 'cloud-hop': {
        c.path = [[0,6],[0,22],[12,34],[26,34],[26,52],[10,64],[-5,64]].map(point);
        for (let i=1;i<c.path.length;i++) { const n=c.path[i]; p(n.x,n.z,12,12); }
        p(18.5,43,7,7,0,{type:'moving',axis:'x',range:7.5,speed:1.2,phase:0});
        trampoline(26,56,7,5,{pushX:-6,pushZ:6});
        break;
      }
      case 'ice-express':
        route([[0,6],[0,48],[28,48],[28,12],[52,12]], 15, {type:'ice'});
        log(0,33,10,'z',11); bumper(14,48,{axis:'x',range:8,speed:1.1}); log(28,31,10,'z',12,2); bumper(46,12);
        break;
      case 'neon-factory':
        route([[0,6],[0,44],[32,44],[32,9]],12,{type:'conveyor',axis:'z',speed:-7});
        c.platforms.filter(t=>t.z===44).forEach(t=>Object.assign(t,{axis:'x',speed:7}));
        for(const [x,z,phase] of [[0,24,0],[15,44,1],[32,23,2]]) o('crusher',x,z,8,4,2.5,{period:4.5,phase,range:5});
        break;
      case 'wind-valley':
        route([[0,6],[0,24],[23,40],[-2,57],[22,75],[-1,91]],8);
        fan(12,33,18,16,110); fan(11,49,20,15,-125); fan(9,66,19,14,120);
        for(const [x,z] of [[18,37],[3,53],[16,71]]) o('wall',x,z,2,3,2.5);
        break;
      case 'door-festival': {
        route([[0,6],[0,24]],12);
        const start=point([0,24]), join=point([0,58]);
        for(const side of [-1,1]) {
          const a=point([side*18,32]), b=point([side*18,51]);
          bridge(start,a,10); bridge(a,b,10); bridge(b,join,10);
          o('gate',side*18,41,10,1.2,3,{range:5,speed:1.5,phase:side===1?Math.PI:0});
        }
        p(0,58,14,14); bridge(join,point([0,78]),12);
        c.path.push(join,point([0,78]));
        o('slider',0,70,7,1,2.3,{axis:'x',range:7});
        break;
      }
      case 'pendulum-port':
        route([[0,6],[0,26],[24,26],[24,50],[48,50]],9);
        // 마지막 수로는 왕복하는 뗏목으로 건넙니다.
        c.platforms = c.platforms.filter(t => !(t.x===36 && t.z===50));
        p(36,50,12,8,0,{type:'moving',axis:'x',range:8,speed:.8});
        o('pendulum',0,19,3,3,2.3,{range:6,speed:1.4}); o('pendulum',15,26,3,3,2.3,{axis:'z',range:6,speed:1.2}); o('pendulum',24,41,3.5,3.5,2.4,{range:6,speed:1.1});
        break;
      case 'blink-trail':
        c.path=[[0,6],[0,24],[24,24],[24,48],[0,48]].map(point);
        for(let row=0;row<10;row++) for(let col=0;col<7;col++) p(col*4.8-2.4,10+row*4.8,4.8,4.8,0,{type:'collapse',delay:.85,recover:4});
        for(const n of c.path) p(n.x,n.z,8,8,0);
        break;
      case 'candy-climb':
        route([[0,6],[0,30],[22,30,2],[22,8,4],[42,8,6],[42,38,8],[12,38,10],[12,14,12]],10);
        o('slider',22,18,8,1,1.3,{y:3,axis:'x',range:5}); spin(42,25,9,.85,7.3); spin(20,38,8,-.8,9.7);
        break;
      case 'pinball-park':
        p(13,32,52,60); c.path=[[0,6],[-7,40],[30,55],[32,17],[10,32]].map(point);
        for(const [x,z] of [[4,20],[13,19],[4,37],[19,43],[30,35],[22,25],[-4,52]]) cushion(x,z);
        trampoline(-6,31,6,6,{pushZ:9}); trampoline(21,53,6,6,{pushX:9}); spin(10,32,9,1.1);
        break;
      case 'chaos-crown':
        route([[0,6],[0,32],[30,32],[30,0],[52,0,2],[52,52,4],[23,52,6],[23,20,8]],10);
        spin(0,25,9); o('gate',30,14,10,1,3,{range:5,speed:1.2}); fan(52,30,10,17,-105); spin(40,52,9,-1.1,5.3); spin(23,28,9,1.35,7.9);
        break;
      case 'rocket-road':
        route([[0,6],[0,46],[34,46],[34,96],[0,96],[0,126]],11);
        booster(0,18,0,1); booster(0,30,0,1); booster(10,46,1,0); booster(34,52,0,1); booster(0,104,0,1);
        // 직선 양쪽 받침에서 번갈아 튀어나오는 펀치 벽입니다.
        for(const [i,z] of [58,66,74,82,90].entries()) puncher(i%2?27:41,z,'x',i%2?1:-1,5.5,i*.55);
        o('crusher',17,96,8,4,2.5,{period:4.2,phase:1,range:5});
        o('slider',0,118,1,8,2.2,{axis:'x',range:4,speed:1.2});
        break;
      case 'choco-swamp':
        route([[0,6],[0,40],[-28,40],[-28,80],[0,80],[0,104]],14);
        // 가운데 진흙은 느리지만 안전하고, 좁은 가장자리는 소용돌이 쪽으로 끌려갑니다.
        mud(0,24,9,18); mud(-14,40,12,9); mud(-28,60,9,20); mud(-14,80,12,9); mud(0,92,9,12);
        vortex(13,24,18,45); vortex(-15,60,18,45); vortex(-12,92,16,40);
        log(0,24,12,'z',7); o('log',-14,80,1.2,12,1,{axis:'x',range:5,speed:.8,phase:1});
        break;
      case 'tiptoe-bridge': {
        // 진짜 길은 정해져 있고 나머지는 밟는 순간 떨어지는 가짜입니다. 5초 뒤 다시 숨습니다.
        const fields=[[16.4,'0,3 1,3 1,2 1,1 2,1 3,1 3,2 4,2 4,3 4,4 5,4 6,4 6,5 7,5','0,4 0,5 1,5 5,2 6,2 7,1'],
          [66.8,'0,1 1,1 1,2 2,2 2,3 3,3 3,4 3,5 4,5 5,5 5,4 6,4 6,3 7,3','0,5 1,5 4,3 4,2 5,2 7,0']];
        const cell=(z0,[row,col],dz=0)=>({x:(col-3)*4.8,z:z0+row*4.8+dz,y:0});
        c.waypoints=[];
        for(const [i,[z0,path,decoys]] of fields.entries()) {
          const cells=path.split(' ').map(k=>k.split(',').map(Number)), real=new Set([...path.split(' '),...decoys.split(' ')]);
          for(let row=0;row<8;row++) for(let col=0;col<7;col++)
            p((col-3)*4.8,z0+row*4.8,4.8,4.8,0,real.has(row+','+col)?{}:{type:'collapse',fake:true,delay:.12,recover:5});
          // 자동 주행 검증용 경로: 진짜 발판 중심만 밟고 섬으로 나갑니다.
          if(i) c.waypoints.push({x:-9.6,z:61,y:0});
          c.waypoints.push(...cells.map(k=>cell(z0,k)),cell(z0,cells.at(-1),5.5),i?{x:0,z:108.8,y:0}:{x:0,z:58.4,y:0});
        }
        p(0,58.4,34,12); p(0,108.8,34,12);
        c.path=[[0,6],[0,58.4],[0,108.8]].map(point);
        o('slider',0,58.4,1,6,2.2,{axis:'x',range:11,speed:.9});
        break;
      }
      case 'sky-tower':
        // 경사길 전체가 기본 동선이고, 두 엘리베이터는 같은 깃발 사이를 잇는 지름길입니다.
        route([[0,6],[0,30],[24,30,2],[24,54,4],[0,54,6],[-24,54,8],[-24,78,10],[0,78,12],[0,104,12]],10);
        c.waypoints=c.path.slice(1);
        c.path=[[0,6],[0,30],[0,54,6],[0,104,12]].map(point);
        lift(0,42,8,0,6); p(0,36.5,6,3); p(0,47.5,6,3,6);
        lift(0,66,8,6,12,.9,Math.PI); p(0,60.5,6,3,6); p(0,71.5,6,3,12);
        spin(24,54,9,-.9,4.25); spin(-24,54,9,1,8.25); spin(0,94,9,.9,12.25);
        booster(0,84,0,1,12);
        break;
    }
    c.checkpoints = c.path.slice(1,-1).map((n,i)=>({...n,radius:info.id==='pinball-park'?4:5,index:i}));
    c.finish = { ...c.path.at(-1), radius: 4 };
    // 공통 직선 구간 없이 각 맵의 동선에서 바로 완주합니다.
    p(c.finish.x,c.finish.z,10,10,c.finish.y);
  }
  const xs=c.platforms.map(t=>Math.abs(t.x)+Math.max(t.w,t.d)/2+(t.range||0));
  const zs=c.platforms.flatMap(t=>[t.z-Math.max(t.w,t.d)/2-(t.range||0),t.z+Math.max(t.w,t.d)/2+(t.range||0)]);
  c.bounds={x:Math.max(...xs)+20,minZ:Math.min(...zs)-20,maxZ:Math.max(...zs)+20};
  c.length=Math.max(...zs); c.finishZ=c.finish?.z ?? null;
  c.tip=rule==='survival'?'떨어지면 탈락 · 주황색 경고를 보고 이동해요.':'번호 깃발을 순서대로 · 떨어지면 마지막 깃발에서 다시!';
  return c;
}
