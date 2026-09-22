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
];

export const availableMaps = (mode, rule = 'race') => MAPS.filter(m => mode === 'elimination' || m.rules.includes(mode === 'series' ? 'race' : rule));

export function createCourse(mapId, rule = 'race') {
  const info = MAPS.find(m => m.id === mapId) || MAPS[0];
  rule = info.rules.includes(rule) ? rule : info.rules[0];
  const c = { ...info, rule, width: 24, platforms: [], obstacles: [], checkpoints: [], path: [], collapsed: {} };
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
    const size = collapse ? 6 : 5;
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
