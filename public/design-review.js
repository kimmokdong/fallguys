import * as THREE from 'three';
import { GameScene } from './scene.js';
import { MAPS, createRacer, stepPlayers, obstaclePose } from './world.js';

// 검토 페이지에서만 사용하는 팔레트. 실제 방·게임의 스타일과 서버 상태는 변경하지 않는다.
const THEMES = {
  sport: { letter: 'A', name: '트랙 클럽', english: 'TRACK CLUB', logo: 'JELLY / RUSH', kicker: 'THE EVERYBODY SPORTS CLUB', title: '같이 뛰자.<br><em>제대로 놀자.</em>', description: '순위는 잠깐, 웃음은 오래.<br>친구 30명과 함께하는 우당탕 운동회.', stamp: "NO. 01<br>LET’S GO!", sky: '#8cabb3', floor: '#386473', alternate: '#426b70', hazard: '#df6430', helper: '#c1a24a', edge: '#202f37', trim: '#beaf88', paper: '#d9ceb1', trees: '#516d67', floors: ['#386473', '#50797d', '#567f88'], note: '놀이공원보다, 우리들의 운동회.', detail: '버밀리언 오렌지와 짙은 잉크색, 큰 글자와 트랙 선으로 경쾌한 스포츠 인상을 만듭니다. 귀여운 캐릭터는 살리고, 사이트는 그래픽 포스터처럼 구성했습니다.', floorNote: '청회색 코스 위에 주황 장애물, 짙은 낙하 경계선을 놓습니다. 밝은 장식은 좁은 표시 띠에만 사용합니다.' },
  forest: { letter: 'B', name: '캠프 젤리', english: 'CAMP JELLY', logo: 'Camp Jelly.', kicker: 'A LITTLE ADVENTURE WITH FRIENDS', title: '숲길 따라,<br><em>웃음 따라.</em>', description: '서두르지 않아도 괜찮아.<br>말랑한 친구들과 떠나는 작은 모험.', stamp: 'CAMP<br>MEMBER', sky: '#8d9c8b', floor: '#638364', alternate: '#768363', hazard: '#b85c37', helper: '#c5a15a', edge: '#344839', trim: '#bba477', paper: '#d0c4a4', trees: '#3c654e', floors: ['#5d7553', '#799075', '#4c7a78'], note: '손으로 만든 장난감 같은 세계.', detail: '초록·황토·테라코타와 둥근 프레임으로 따뜻한 캠핑 분위기를 만듭니다. 잔디색 발판과 목재색 단면, 코스 바깥의 나무로 공간에 재료감을 더했습니다.', floorNote: '녹색 바닥과 갈색 측면을 구분하고, 움직이는 장애물은 구운 주황색으로 통일합니다. 숲 배경은 채도를 낮춥니다.' },
  arcade: { letter: 'C', name: '애프터 아워즈', english: 'AFTER HOURS', logo: 'JR_ AFTER HOURS', kicker: 'INSERT FRIENDS. PRESS PLAY.', title: '오늘 밤,<br><em>한 판 더.</em>', description: '마지막 판이라고 했잖아.<br>멈출 수 없는 우리들의 아케이드 레이스.', stamp: 'PLAYER<br>READY_', sky: '#243940', floor: '#385765', alternate: '#3c6467', hazard: '#d46d30', helper: '#a5ba4c', edge: '#97bbc0', trim: '#8b9c9a', paper: '#bfc9b7', trees: '#294b53', floors: ['#385765', '#42676c', '#376777'], note: '빛나는 화면 대신, 선명한 신호.', detail: '차콜 배경과 라임색 버튼, 얇은 격자와 고정폭 숫자로 야간 아케이드 분위기를 만듭니다. 번지는 발광 효과 없이 HUD와 장애물에만 색을 집중했습니다.', floorNote: '청록 바닥보다 어두운 공간을 배경으로 두고, 발판 가장자리는 회청색 선으로 드러냅니다. 위험물은 주황색입니다.' },
};
const STUDIES = ['spin-city', 'cloud-hop', 'ice-express'];
const STUDY_NOTES = ['회전봉의 움직임과 위험물 띠', '흰 바닥 대신, 낙하 경계가 보이는 발판', '빙판과 일반 발판의 색·무광 질감 차이'];
const $ = selector => document.querySelector(selector);
let themeId = new URLSearchParams(location.search).get('theme');
if (!THEMES[themeId]) themeId = 'sport';
let view = 'site', mapId = 'jelly-garden', galleryMap = STUDIES[0];
const keys = new Set();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

class ReviewScene extends GameScene {
  material(color, options = {}) {
    const theme = this.reviewTheme;
    if (theme) {
      if (this.paintingCourse) {
        if (color === '#ffbace') color = theme.hazard;
        if (color === '#ffe89a') color = theme.helper;
        const rgb = new THREE.Color(color);
        if (Math.min(rgb.r, rgb.g, rgb.b) > 0.67) color = theme.trim;
        if (['#819ce4', '#9a76e8', '#626595'].includes(color)) color = theme.edge;
      } else {
        if (color === '#ecf4fc') color = '#cbd0c5';
        if (color === '#fff9f1') color = '#d9d2bc';
      }
      options = { ...options, roughness: Math.max(options.roughness || 0.82, 0.55), metalness: 0 };
    }
    return super.material(color, options);
  }

  applyTheme(theme) {
    this.reviewTheme = theme;
    this.renderer.toneMappingExposure = 0.94;
    this.scene.children.forEach(light => {
      if (light.isHemisphereLight) { light.color.set('#dce5da'); light.groundColor.set('#55605b'); light.intensity = 1.6; }
      if (light.isDirectionalLight) { light.intensity = light === this.sun ? 2.25 : 0.55; light.color.set(light === this.sun ? '#f0dfc3' : '#abc5cc'); }
    });
    this.portraits.clear();
  }

  buildPreview() {
    const theme = this.reviewTheme;
    if (!theme) return super.buildPreview();
    this.mesh(this.content, 'cylinder', theme.edge, [0, -0.55, 0], [5.4, 0.85, 4]);
    this.mesh(this.content, 'cylinder', theme.floor, [0, -0.06, 0], [5.35, 0.14, 3.96]);
    this.ring(this.content, theme.trim, [0, 0.025, 0], [4.9, 3.6, 0.8], true);
    for (const [id, color, x, z, scale] of [['bunny', 'white', 0, 0.8, 1.48], ['dino', 'mint', -2.65, 0, 1.12], ['cat', 'orange', 2.5, -0.2, 1.12]]) {
      const model = this.avatar(id, color);
      model.position.set(x, 0, z); model.scale.setScalar(scale); model.rotation.y = -0.12;
      this.content.add(model);
      this.previewCharacters.push({ model, y: 0, phase: x, lead: id === 'bunny' });
    }
    for (const x of [-3.8, 3.8]) this.box(this.content, theme.hazard, [x, 1, -1.9], [0.5, 2, 0.5]);
    this.box(this.content, theme.hazard, [0, 2.1, -1.9], [8.1, 0.45, 0.6]);
    for (let i = 0; i < 9; i++) this.box(this.content, i % 2 ? theme.trim : theme.edge, [-3.2 + i * 0.8, 2.1, -1.57], [0.55, 0.38, 0.035]);
    if (theme === THEMES.forest) for (const x of [-4.3, 4.3]) this.tree(x, -0.5, -3.6, 0.8);
    else for (const x of [-4.5, 4.5]) {
      this.box(this.content, theme.edge, [x, 1.5, -3], [0.1, 3.5, 0.1]);
      this.box(this.content, theme.helper, [x - 0.5, 2.7, -3], [1.1, 0.7, 0.08]);
    }
    this.previewCamera();
  }

  previewCamera() {
    if (!this.reviewTheme) return super.previewCamera();
    this.camera.position.set(7.5, 6.2, 13.5);
    this.camera.lookAt(0, 1.35, 0);
  }

  tree(x, y, z, scale = 1) {
    const group = new THREE.Group();
    this.mesh(group, 'cylinder', '#68513a', [0, 1.5, 0], [0.3, 3, 0.3]);
    for (let i = 0; i < 3; i++) this.mesh(group, 'cone', this.reviewTheme?.trees || '#3c654e', [0, 2 + i * 1.1, 0], [2 - i * 0.4, 2.7, 2 - i * 0.4]);
    group.position.set(x, y, z); group.scale.setScalar(scale); this.content.add(group);
  }

  cloud(x, y, z) {
    if (!this.reviewTheme) return super.cloud(x, y, z);
    const theme = this.reviewTheme;
    if (theme === THEMES.forest) this.tree(x, y - 1.5, z, 1.5);
    else {
      const height = theme === THEMES.arcade ? 8 + Math.sin(z) * 3 : 2;
      this.box(this.content, theme.trees, [x, y - height / 2, z], [4, height, 5]);
      this.box(this.content, theme.helper, [x, y + 0.06, z], [4, 0.12, 0.3]);
    }
  }

  buildCourse() {
    const theme = this.reviewTheme;
    if (!theme) return super.buildCourse();
    this.paintingCourse = true;
    const floor = theme.floors[STUDIES.indexOf(this.mapId)] || theme.floor;
    this.course.colors = { sky: theme.sky, floor, accent: theme.alternate };
    this.course.platforms.forEach(p => { p.color = p.type === 'ice' ? theme.floors[2] : floor; });
    this.course.obstacles.forEach(o => { o.color = ['bouncer', 'fan'].includes(o.type) ? theme.helper : theme.hazard; });
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.sky, 70, 180);
    super.buildCourse();
    for (const { data: p, group } of this.platforms) {
      group.children[0].material = this.material(theme === THEMES.forest ? '#785b40' : theme.edge);
      group.children[1].material = this.material(theme.edge);
      for (const side of [-1, 1]) {
        this.box(group, theme.edge, [side * (p.w / 2 - 0.2), 0.055, 0], [0.17, 0.035, p.d - 0.12]);
        this.box(group, theme.edge, [0, 0.055, side * (p.d / 2 - 0.2)], [p.w - 0.12, 0.035, 0.17]);
      }
    }
    this.paintingCourse = false;
  }

  label(text, background, color, width) {
    if (this.reviewTheme && background === '#7c66ce') background = this.reviewTheme.edge;
    if (this.reviewTheme === THEMES.arcade && background === this.reviewTheme.edge) color = '#172d33';
    return super.label(text, background, color, width);
  }

  arch(z, text, color, width, y) {
    return super.arch(z, text, this.reviewTheme?.edge || color, width, y);
  }

  portrait(character, color) {
    if (!this.reviewTheme) return super.portrait(character, color);
    const key = `${character}:${color}`;
    if (this.portraits.has(key)) return this.portraits.get(key);
    // 결과 사진도 데모 인게임과 같은 광원·재질로 촬영한다.
    this.clearContent(); this.mode = 'portrait'; this.demoKind = null;
    this.scene.background = null; this.scene.fog = null;
    const avatar = this.avatar(character, color);
    avatar.traverse(object => { if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; } });
    avatar.userData.rightArm.rotation.z = 0.6;
    this.content.add(avatar);
    this.sun.position.set(-5, 9, 7); this.sun.target.position.set(0, 1, 0);
    const bounds = new THREE.Box3().setFromObject(avatar);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(center.x, center.y + 0.15, center.z + Math.max(size.x, size.y) / (2 * Math.tan(Math.PI * 32 / 360)) * 1.15 + size.z / 2);
    camera.lookAt(center);
    this.renderer.setSize(320, 320, false);
    this.renderer.render(this.scene, camera);
    const url = this.canvas.toDataURL('image/png');
    this.portraits.set(key, url);
    return url;
  }

  prepare(kind, id = mapId) {
    this.demoKind = kind;
    this.mapId = null; // 동일 맵도 팔레트 변경 후 다시 그린다.
    this.roster = [];
    this.setMode(kind === 'site' ? 'preview' : 'race', { mapId: id, playerId: kind === 'race' ? 'me' : undefined });
    if (kind === 'race') {
      this.racers = Array.from({ length: 6 }, (_, i) => ({ ...createRacer(i), id: i === 2 ? 'me' : `demo-${i}` }));
      this.setPlayers(this.racers.map((p, i) => ({ id: p.id, name: ['디노', '야옹', '토토', '곰곰', '우주콩', '로보'][i], character: ['dino', 'cat', 'bunny', 'bear', 'alien', 'robot'][i], color: i === 2 ? $('#character-color').value : ['mint', 'orange', 'white', 'yellow', 'blue', 'navy'][i] })));
      this.updateState({ time: 0, players: this.racers });
    } else if (kind === 'maps') {
      this.camera.position.set(26, 30, -10);
      this.camera.lookAt(0, 0, 31);
      this.sun.position.set(-16, 28, 23); this.sun.target.position.set(0, 0, 28);
    }
  }

  animate(now) {
    if (this.demoKind === 'race' && this.racers) {
      const dt = Math.min((now - this.lastFrame) / 1000, 0.04);
      const input = { x: Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight')), z: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')), jump: keys.has('Space'), dive: keys.has('ShiftLeft') || keys.has('ShiftRight') };
      stepPlayers(this.racers, this.racers.map(p => p.id === 'me' ? input : {}), this.course, now / 1000, dt);
      this.updateState({ time: now / 1000, players: this.racers });
      if (this.racers[2].finished) $('#race-status').textContent = '완주! 다른 맵을 고르거나 출발점으로 돌아가 보세요.';
    } else if (this.demoKind === 'maps') {
      this.stateTime = reducedMotion ? 0 : now / 1000; this.stateReceived = now;
    }
    super.animate(reducedMotion && this.demoKind === 'site' ? 1000 : now);
    if (reducedMotion && this.demoKind === 'site') this.lastFrame = now;
  }

  thumbnail(id) {
    this.prepare('maps', id);
    this.renderer.setSize(640, 400, false);
    this.camera.aspect = 1.6; this.camera.updateProjectionMatrix();
    // 장애물 배치까지 갱신한 뒤 같은 렌더러에서 즉시 캡처한다.
    for (const { data, group } of this.obstacles) {
      const pose = obstaclePose(data, 1);
      group.position.set(pose.x, pose.y ?? data.y ?? 0, pose.z);
      group.rotation.y = pose.rotation || 0;
    }
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }
}

const canvas = $('#review-canvas');
$('#site-canvas-slot').append(canvas); canvas.classList.add('mounted');
let scene;
try { scene = new ReviewScene(canvas); }
catch (error) { $('#site-canvas-slot').textContent = error.message; throw error; }
let revealTimer;
const thumbnails = new Map();

function makeGallery() {
  if (!thumbnails.has(themeId)) {
    const shots = STUDIES.map(id => scene.thumbnail(id));
    thumbnails.set(themeId, shots);
  }
  const shots = thumbnails.get(themeId);
  $('#map-gallery').innerHTML = STUDIES.map((id, i) => `<button class="map-card" data-map="${id}" aria-pressed="${id === galleryMap}"><img src="${shots[i]}" alt="${THEMES[themeId].name} 스타일의 ${MAPS.find(m => m.id === id).name}"><div><small>COURSE / 0${i + 1}</small><b>${MAPS.find(m => m.id === id).name}</b><p>${STUDY_NOTES[i]}</p></div></button>`).join('');
  $('#site-map-cards').innerHTML = STUDIES.map((id, i) => `<button class="mini-map" data-map="${id}"><img src="${shots[i]}" alt=""><span><b>${MAPS.find(m => m.id === id).name}</b><small>0${i + 1} / 코스 살펴보기 ↗</small></span></button>`).join('');
}

function revealResults() {
  clearInterval(revealTimer);
  const people = [['토토', 'bunny', 'white', 22], ['디노', 'dino', 'mint', 20], ['야옹', 'cat', 'orange', 17], ['로보', 'robot', 'navy', 14], ['곰곰', 'bear', 'yellow', 12], ['샤크', 'shark', 'blue', 10], ['셰프', 'chef', 'white', 8], ['개굴', 'frog', 'mint', 5]];
  $('#result-grid').innerHTML = people.map(([name, character, color, score], i) => `<article class="result-card ${i === 0 ? 'winner' : ''}" aria-label="아직 공개되지 않은 참가자"><div class="portrait"><img src="${scene.portrait(character, color)}" alt="" draggable="false"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span class="mystery">?</span></div><b class="result-name">${name}</b><span class="score">총 ${score}점 · 3라운드</span></article>`).join('');
  let count = 0;
  const cards = [...document.querySelectorAll('.result-card')];
  const reveal = () => {
    const index = cards.length - ++count;
    cards[index].classList.add('revealed');
    cards[index].setAttribute('aria-label', `${index + 1}위 ${people[index][0]}, ${people[index][3]}점`);
    $('#reveal-status').textContent = count === cards.length ? '오늘의 우승자, 토토! 모두 수고했어요.' : `${count} / 8 공개 · ${index + 1}위 ${people[index][0]}`;
    if (count === cards.length) clearInterval(revealTimer);
  };
  $('#reveal-status').textContent = '꼴찌부터 한 명씩 공개합니다.';
  if (reducedMotion) while (count < cards.length) reveal();
  else revealTimer = setInterval(reveal, 680);
}

function showView(next) {
  view = next; keys.clear(); clearInterval(revealTimer);
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `${view}-view`; });
  canvas.hidden = view === 'results';
  if (view !== 'results') {
    $(`#${view === 'maps' ? 'map' : view}-canvas-slot`).append(canvas);
    scene.prepare(view, view === 'maps' ? galleryMap : mapId);
    scene.lastFrame = performance.now(); scene.resize();
  } else { scene.demoKind = null; revealResults(); }
  $('#race-map-name').textContent = MAPS.find(m => m.id === mapId).name;
  $('.hud-rank > span').textContent = $('#character-color').value === 'white' ? '흰색 캐릭터에 주목!' : '내 캐릭터의 경계를 확인!';
  $('#map-detail-name').textContent = MAPS.find(m => m.id === galleryMap).name;
  $('#race-status').textContent = 'W A S D / 방향키 · 이동　SPACE · 점프　SHIFT · 다이빙';
  updateUrl();
}

function updateUrl() {
  const url = new URL(location.href); url.searchParams.set('theme', themeId); url.searchParams.set('view', view);
  history.replaceState(null, '', url);
}

function chooseTheme(id) {
  themeId = id;
  const theme = THEMES[id];
  $('.workspace').dataset.theme = id;
  document.querySelectorAll('[data-theme].direction').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === id));
  $('#mock-logo').textContent = theme.logo;
  $('#hero-kicker').textContent = theme.kicker;
  $('#hero-title').innerHTML = theme.title;
  $('#hero-description').innerHTML = theme.description;
  $('#art-stamp').innerHTML = theme.stamp;
  $('#note-number').textContent = `DIRECTION ${theme.letter} / ${theme.english}`;
  $('#note-title').textContent = theme.note;
  $('#note-description').textContent = theme.detail;
  $('#note-floor').textContent = theme.floorNote;
  $('#race-brand').textContent = `${theme.english} / PRACTICE`;
  $('#copy-status').textContent = '';
  scene.applyTheme(theme);
  makeGallery();
  showView(view);
}

$('#race-map').innerHTML = MAPS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
document.querySelectorAll('.direction').forEach(b => b.addEventListener('click', () => chooseTheme(b.dataset.theme)));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { showView(b.dataset.go); $('.view-bar').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' }); }));
$('#mock-logo').addEventListener('click', e => { e.preventDefault(); showView('site'); });
for (const selector of ['#map-gallery', '#site-map-cards']) $(selector).addEventListener('click', e => {
  const button = e.target.closest('[data-map]');
  if (!button) return;
  galleryMap = button.dataset.map;
  document.querySelectorAll('.map-card').forEach(b => b.setAttribute('aria-pressed', b.dataset.map === galleryMap));
  showView('maps');
});
$('#try-map').addEventListener('click', () => { mapId = galleryMap; $('#race-map').value = mapId; showView('race'); });
$('#race-map').addEventListener('change', e => { mapId = e.target.value; showView('race'); });
$('#character-color').addEventListener('change', () => showView('race'));
$('#reset-race').addEventListener('click', () => showView('race'));
$('#replay-results').addEventListener('click', revealResults);
const inputKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', e => {
  if (view !== 'race' || !inputKeys.has(e.code) || ['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || (e.target.tagName === 'BUTTON' && e.code === 'Space')) return;
  e.preventDefault(); keys.add(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
$('#race-canvas-slot').addEventListener('pointerdown', e => { if (e.target === canvas) $('#race-canvas-slot').focus({ preventScroll: true }); });
document.querySelectorAll('[data-key]').forEach(button => {
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => keys.delete(button.dataset.key));
});
$('#copy-choice').addEventListener('click', async () => {
  const theme = THEMES[themeId];
  const text = `${theme.letter}안 ${theme.name}이 마음에 들어요. ${location.href}`;
  try { await navigator.clipboard.writeText(text); $('#copy-status').textContent = '복사했어요. 대화창에 붙여넣고 원하는 수정사항을 덧붙여 주세요.'; }
  catch { $('#copy-status').textContent = `${theme.letter}안 ${theme.name} — 이 이름과 원하는 수정사항을 대화창에 적어 주세요.`; }
});
const initialView = new URLSearchParams(location.search).get('view');
if (['site', 'race', 'maps', 'results'].includes(initialView)) view = initialView;
chooseTheme(themeId);
// 썸네일의 일회성 렌더 이후 애니메이션 루프를 한 번만 이어간다.
cancelAnimationFrame(scene.frame);
scene.frame = requestAnimationFrame(scene.animate);
window.addEventListener('pagehide', () => { clearInterval(revealTimer); keys.clear(); });
