import { MAPS, createCourse, availableMaps } from './world.js';
import { CHARACTERS, COLORS } from './catalog.js';
import { GameScene } from './scene.js';
import { resultOrder, revealedCount, roundPoints } from './results.js';
import { hasNextRound, isSuccessful, placeLabel } from './match.js';
import { GameAudio } from './audio.js';
import { StateDecoder } from './network.js';
let network=new StateDecoder(),lastView='',lastInput='',lastInputAt=0;

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readStorage = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
const saveStorage = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch { /* 저장이 차단되어도 게임은 진행합니다. */ } };
const profile = readStorage(localStorage, 'jelly-profile') || { name: '', character: 'bean', color: 'coral' };
if (!CHARACTERS.some((c) => c.id === profile.character)) profile.character = 'bean';
if (!COLORS.some((c) => c.id === profile.color)) profile.color = 'coral';
let savedSession = readStorage(sessionStorage, 'jelly-session');
let socket, connecting, reconnectTimer, reconnectAttempts = 0, reconnectPending = false;
let room = null, myId = null, entryMode = 'create', selectedMap = 'random', filter = 'all', sceneMode = 'preview', sceneMap = '';
let latestState = null, stateAt = 0, toastTimer, requestTimer, scene, activeCourse;
let resultsTimer, resultsKey = '', revealStart = 0, shownResults = 0, orderedResults = [], skipReveal = false;
const sound = new GameAudio(readStorage(localStorage, 'camp-sound') !== false, readStorage(localStorage, 'camp-volume') ?? .75);
let soundState = null, watchId = null, watchOptionsKey = '', countdownSound = 0;
const queuedActions = { jump: false, dive: false };
const keys = new Set();
const touch = { x: 0, z: 0, jump: false, dive: false };

function updateSoundButtons() {
  document.querySelectorAll('[data-sound-toggle]').forEach(button => {
    button.textContent = sound.ready ? '♪ 소리 켜짐' : '♪ 소리 켜기';
    button.setAttribute('aria-pressed', String(sound.ready));
  });
}
document.querySelectorAll('[data-sound-toggle]').forEach(button => button.addEventListener('click', async () => {
  sound.enabled = !sound.ready; saveStorage(localStorage, 'camp-sound', sound.enabled);
  sound.setVolume(sound.volume);
  if (sound.enabled && await sound.unlock()) sound.play("confirm");
  updateSoundButtons();
}));
sound.onChange=updateSoundButtons;
$('#sound-volume').value=Math.round(sound.volume*100);
$('#volume-value').textContent=Math.round(sound.volume*100)+'%';
$('#sound-volume').addEventListener('input',event=>{ sound.setVolume(Number(event.target.value)/100); saveStorage(localStorage,'camp-volume',sound.volume); $('#volume-value').textContent=event.target.value+'%'; });
$('#sound-test').addEventListener('click',async()=>{ sound.enabled=true; saveStorage(localStorage,'camp-sound',true); if(await sound.unlock()) sound.play('confirm'); else toast('소리를 열지 못했어요. 브라우저의 사이트 소리 설정을 확인해 주세요.'); });
window.addEventListener('pointerdown', event => { if (!event.target.closest('[data-sound-toggle],#sound-test')) sound.unlock(); }, { passive: true });
window.addEventListener('keydown', () => sound.unlock());
updateSoundButtons();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}

try {
  scene = new GameScene($('#world-canvas'));
  scene.setMode('preview');
  scene.setCharacter(profile.character, profile.color);
} catch (error) {
  console.error(error);
  toast('3D 화면을 열지 못했어요. 최신 Chrome 또는 Edge에서 하드웨어 가속을 켜주세요.');
  $('#hero-visual').insertAdjacentHTML('beforeend', '<p style="position:absolute;top:40%;padding:25px;color:#315b40">3D 화면을 표시할 수 없습니다.<br>최신 브라우저의 하드웨어 가속을 확인해주세요.</p>');
}

const projectionCache = new WeakMap();
function mapProjection(course) {
  if (projectionCache.has(course)) return projectionCache.get(course);
  const bounds=course.platforms.map(p=>{const cos=Math.abs(Math.cos(p.rotation||0)),sin=Math.abs(Math.sin(p.rotation||0));return {x:p.x,z:p.z,ex:(cos*p.w+sin*p.d)/2+(p.axis==='x'?p.range||0:0),ez:(sin*p.w+cos*p.d)/2+(p.axis==='z'?p.range||0:0)};});
  const minX=Math.min(...bounds.map(p=>p.x-p.ex)),maxX=Math.max(...bounds.map(p=>p.x+p.ex)),minZ=Math.min(...bounds.map(p=>p.z-p.ez)),maxZ=Math.max(...bounds.map(p=>p.z+p.ez));
  const scale=Math.min(280/(maxX-minX),152/(maxZ-minZ)),x=160+(minX+maxX)/2*scale,y=100+(minZ+maxZ)/2*scale;
  const project = p=>({x:x-p.x*scale,y:y-p.z*scale,scale});
  projectionCache.set(course, project);
  return project;
}
function mapArt(map, index, course = createCourse(map.id)) {
  const project=mapProjection(course),scale=project({x:0,z:0}).scale;
  const tiles=course.platforms.map(p=>{ const n=project(p); return '<rect x="'+(-p.w*scale/2)+'" y="'+(-p.d*scale/2)+'" width="'+p.w*scale+'" height="'+p.d*scale+'" rx="1" transform="translate('+n.x+' '+n.y+') rotate('+(-(p.rotation||0)*180/Math.PI)+')" fill="'+(['collapse','disappear'].includes(p.type)?'#c5a15a':map.colors.floor)+'" stroke="#344839" stroke-width=".7"/>'; }).join('');
  const flags=course.checkpoints.map((p,i)=>{const n=project(p);return '<circle cx="'+n.x+'" cy="'+n.y+'" r="6" fill="#ead9a4"/><text x="'+n.x+'" y="'+(n.y+3)+'" text-anchor="middle" fill="#283f31" font-size="8">'+(i+1)+'</text>';}).join('');
  const f=course.finish?project(course.finish):null;
  const start=project({x:0,z:6});
  return '<svg viewBox="0 0 320 190" role="img" aria-label="'+escapeHTML(map.name)+' 코스 모양"><rect width="320" height="190" fill="'+map.colors.sky+'"/>'+tiles+flags+(f?'<circle cx="'+f.x+'" cy="'+f.y+'" r="5" fill="#b85c37"/>':'')+'<circle class="map-player" r="5" fill="#fff1cf" stroke="#283f31" stroke-width="2" cx="'+start.x+'" cy="'+start.y+'"/><text x="12" y="20" fill="#23382b" font-size="12">'+map.rules.map(r=>r==='survival'?'생존':'레이스').join(' · ')+'</text></svg>';
}
function mapOptions(settings) {
  const maps=availableMaps(settings.matchMode,settings.roundRule);
  const select=$('#map-select'), value=settings.mapId;
  select.innerHTML='<option value="random">⤨ 랜덤으로 선택</option>'+maps.map(m=>'<option value="'+m.id+'">'+m.emoji+' '+m.name+'</option>').join('');
  select.value=maps.some(m=>m.id===value)?value:'random';
}

function renderMaps() {
  $('#map-grid').innerHTML = MAPS.map((map, i) => filter !== 'all' && map.difficulty !== Number(filter) ? '' : `<button class="map-card ${selectedMap === map.id ? 'selected' : ''}" data-map="${map.id}" aria-pressed="${selectedMap === map.id}" aria-label="${escapeHTML(map.name)} 맵 선택"><div class="map-art">${mapArt(map, i)}<span class="map-number">MAP ${String(i + 1).padStart(2, '0')}</span>${selectedMap === map.id ? '<span class="map-picked">선택됨 ✓</span>' : ''}</div><div class="map-info"><div class="map-title"><h3>${map.name}</h3><span class="difficulty" aria-label="난이도 ${map.difficulty}">${'●'.repeat(map.difficulty)}${'○'.repeat(3 - map.difficulty)}</span></div><p>${map.subtitle}</p><div class="map-tags">${map.tags.slice(0, 2).map((t) => `<span>${t}</span>`).join('')}<i>↗</i></div></div></button>`).join('');
}
renderMaps();
$('#map-select').insertAdjacentHTML('beforeend', MAPS.map((m) => `<option value="${m.id}">${m.emoji} ${m.name}</option>`).join(''));
$('#map-grid').addEventListener('click', (event) => { const card = event.target.closest('[data-map]'); if (card) { selectedMap = card.dataset.map; renderMaps(); toast(`${MAPS.find((m) => m.id === selectedMap).name} 선택! 방을 만들면 이 맵으로 시작해요.`); } });
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === button)); renderMaps(); }));
$('#random-map').addEventListener('click', () => { selectedMap = 'random'; renderMaps(); toast('랜덤 모드! 시작할 때 모드에 맞는 맵을 골라드려요.'); });

function setConnection(online) {
  $('#connection-dot').className = online ? '' : 'off';
  $('#connection-label').textContent = online ? '플레이 준비 완료' : '서버에 연결 중';
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/?v=2`);
    socket.binaryType='arraybuffer'; network=new StateDecoder(); lastView=''; lastInput='';
    const timeout = setTimeout(() => { socket.close(); reject(new Error('서버 연결 시간이 초과됐어요. 서버 실행 상태를 확인해주세요.')); }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout); setConnection(true); reconnectAttempts = 0; connecting = null; resolve();
      const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
      if (savedSession?.token && savedSession.code === code) { reconnectPending = true; send({ type: 'join', code, name: profile.name || '젤리', token: savedSession.token, character: profile.character, color: profile.color }); }
    });
    socket.addEventListener('message', (event) => {
      try { const message=typeof event.data==='string'?JSON.parse(event.data):network.decode(event.data); if(message) onMessage(message); } catch (error) { console.error('메시지 처리 오류', error); }
    });
    socket.addEventListener('close', (event) => {
      sound.setMusicPlaying(false);
      clearTimeout(timeout); connecting = null; setConnection(false); resetInput();
      $('#entry-submit').disabled = false;
      reject(new Error('서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.'));
      if (event.code === 4001) { clearTimeout(reconnectTimer); reconnectPending = false; goHome(); toast('다른 창에서 같은 플레이어로 접속했어요. 이 창은 대기 화면으로 돌아갑니다.'); return; }
      if (room && reconnectAttempts === 0) toast('연결이 잠시 끊겼어요. 같은 자리로 다시 연결하고 있습니다.');
      if (++reconnectAttempts <= 10) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => connect().catch(() => {}), Math.min(1000 * reconnectAttempts, 5000)); }
    });
    socket.addEventListener('error', () => setConnection(false));
  });
  return connecting;
}

function send(data) {
  if (socket?.readyState !== WebSocket.OPEN) { if (data.type !== 'input') toast('서버 연결을 기다려주세요.'); return false; }
  const payload=JSON.stringify(data),now=performance.now();
  if(data.type==='input') { if(payload===lastInput && now-lastInputAt<250) return true;lastInput=payload;lastInputAt=now; }
  socket.send(payload); return true;
}

function onMessage(message) {
  if (message.type === 'welcome') {
    reconnectPending = false;
    myId = message.id;
    savedSession = { code: message.code, token: message.token };
    saveStorage(sessionStorage, 'jelly-session', savedSession);
    history.replaceState(null, '', `?room=${message.code}`);
    clearTimeout(requestTimer);
    $('#entry-submit').disabled = false;
    $('#entry-dialog').close();
    if ($('#character-dialog').open) send({ type: 'choosing', choosing: true });
    if (entryMode === 'create' && selectedMap !== 'random') { send({ type: 'settings', matchMode:'single', roundRule:MAPS.find(m=>m.id===selectedMap).rules[0], mapId: selectedMap }); selectedMap = 'random'; }
    entryMode = 'join';
  } else if (message.type === 'room') {
    const previousRoom = room;
    room = message.room;
    network.setRoom(room);
    renderRoom(previousRoom);
    syncView();
  } else if (message.type === 'state') {
    latestState = message; stateAt = performance.now(); scene?.updateState(message); renderRaceState();
  } else if (message.type === 'error') {
    toast(message.message);
    if (room?.phase === 'lobby') renderRoom(room);
    clearTimeout(requestTimer); $('#entry-submit').disabled = false;
    if (reconnectPending) {
      const code = savedSession?.code || new URLSearchParams(location.search).get('room') || '';
      reconnectPending = false; goHome();
      if (code) history.replaceState(null, '', `?room=${code}`);
      showEntry('join', code);
    } else if (!room && savedSession) {
      savedSession = null; saveStorage(sessionStorage, 'jelly-session', null);
      showEntry('join', new URLSearchParams(location.search).get('room') || '');
    }
  } else if (message.type === 'left') { goHome(); }
  else if (message.type === 'kicked') { goHome(); toast(message.message); }
}

function showEntry(mode, code = '') {
  if (room) return;
  entryMode = mode;
  $('#entry-title').textContent = mode === 'create' ? '새로운 캠프를 열어요.' : '반가워요! 이름을 알려줘요.';
  $('#entry-description').textContent = mode === 'create' ? '어떤 이름으로 함께할까요?' : code ? `초대받은 캠프 · ${code}` : '초대 코드와 이름을 입력해요.';
  $('#code-field').hidden = mode === 'create' || Boolean(code);
  $('#entry-code').required = mode === 'join';
  $('#entry-code').value = code;
  $('#entry-name').value = profile.name;
  $('#entry-submit').textContent = mode === 'create' ? '방 만들기 →' : '입장하기 →';
  $('#entry-submit').disabled = false;
  updateProfile();
  if (!$('#entry-dialog').open) $('#entry-dialog').showModal();
  setTimeout(() => $('#entry-name').focus(), 60);
}

$('#entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#entry-name').value.trim();
  if (!name) { $('#entry-name').setCustomValidity('이름을 입력해주세요.'); $('#entry-name').reportValidity(); return; }
  $('#entry-name').setCustomValidity(''); profile.name = name;
  saveStorage(localStorage, 'jelly-profile', profile);
  $('#entry-submit').disabled = true;
  try {
    await connect();
    send({ type: entryMode, name, character: profile.character, color: profile.color, ...(entryMode === 'join' ? { code: $('#entry-code').value.trim().toUpperCase() } : {}) });
    requestTimer = setTimeout(() => { $('#entry-submit').disabled = false; toast('응답이 늦어지고 있어요. 연결 상태를 확인해주세요.'); }, 8000);
  } catch (error) { toast(error.message); $('#entry-submit').disabled = false; }
});
$('#entry-name').addEventListener('input', () => $('#entry-name').setCustomValidity(''));
$('#create-button').addEventListener('click', () => showEntry('create'));
$('#join-button').addEventListener('click', () => showEntry('join'));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#guide-button').addEventListener('click', () => $('#guide-dialog').showModal());
$('#nav-home').addEventListener('click', (event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#nav-maps').addEventListener('click', () => { if (room) $('#settings-dialog').showModal(); else $('#maps-dialog').showModal(); });

const emptyPortrait = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
let portraitTask = null;
function portraitImage(character, color, attributes = '') {
  const key = character + ':' + color, cached = scene?.portraits.get(key);
  return '<img ' + attributes + ' src="' + (cached || emptyPortrait) + '"' + (scene && !cached ? ' data-portrait="' + key + '"' : '') + '>';
}
function setPortrait(image, character, color) {
  const key = character + ':' + color, cached = scene?.portraits.get(key);
  if (cached) { if (image.src !== cached) image.src = cached; delete image.dataset.portrait; }
  else { image.src = emptyPortrait; image.dataset.portrait = key; }
  queuePortraits();
}
// 캐릭터를 한꺼번에 30장 촬영하지 않고 화면이 그려진 뒤 한 장씩 처리합니다.
function queuePortraits() {
  if (!scene || document.hidden || portraitTask !== null) return;
  const next = () => {
    portraitTask = null;
    if (document.hidden) return;
    const images = [...document.querySelectorAll('img[data-portrait]')];
    const first = images.find(image => image.getClientRects().length);
    if (!first) return;
    const key = first.dataset.portrait;
    let url = emptyPortrait;
    try { url = scene.portrait(...key.split(':')); } catch (error) { console.error('캐릭터 사진 생성 오류', error); }
    for (const image of images) if (image.dataset.portrait === key) { image.src = url; delete image.dataset.portrait; }
    queuePortraits();
  };
  portraitTask = window.requestIdleCallback ? requestIdleCallback(next, { timeout: 250 }) : setTimeout(next, 24);
}
function syncSceneActivity() {
  const mode = document.body.dataset.screen || 'home';
  scene?.setActive((mode === 'home' || (mode === 'game' && room?.phase !== 'results')) && !document.querySelector('dialog[open]'));
  queuePortraits();
}
const dialogObserver = new MutationObserver(syncSceneActivity);
for (const dialog of document.querySelectorAll('dialog')) dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
document.addEventListener('visibilitychange', () => { if (!document.hidden) queuePortraits(); });

function updateProfile() {
  const c = CHARACTERS.find((item) => item.id === profile.character);
  $('#entry-avatar').innerHTML = scene ? portraitImage(c.id, profile.color, `alt="${escapeHTML(c.name)}"`) : c.emoji;
  $('#entry-avatar').style.background = `${COLORS.find((color) => color.id === profile.color).hex}35`;
  $('#entry-character-name').textContent = c.name;
  scene?.setCharacter(profile.character, profile.color);
  saveStorage(localStorage, 'jelly-profile', profile);
  queuePortraits();
}

function renderCharacters() {
  const scroll = $('#character-grid').scrollTop;
  const active = document.activeElement;
  const focus = active?.dataset.color ? `[data-color="${active.dataset.color}"]` : active?.dataset.character ? `[data-character="${active.dataset.character}"]` : null;
  previewCharacter();
  const random = room?.settings.characterMode === 'random';
  $('#character-help').textContent = random ? '랜덤 캐릭터 · 색상은 자유롭게' : `${CHARACTERS.length}종 · ${COLORS.length}색`;
  $('#color-picker').innerHTML = COLORS.map((c) => `<button class="color-swatch ${profile.color === c.id ? 'selected' : ''}" style="background:${c.hex}" data-color="${c.id}" aria-label="${c.name}" aria-pressed="${profile.color === c.id}" title="${c.name}"></button>`).join('');
  $('#character-grid').innerHTML = CHARACTERS.map((c) => `<button class="character-option ${profile.character === c.id ? 'selected' : ''}" data-character="${c.id}" aria-label="${c.name} 캐릭터" aria-pressed="${profile.character === c.id}" ${random ? 'disabled' : ''}>${portraitImage(c.id, profile.color, 'class="char-model" alt="" width="96" height="96"')}<span>${c.name}</span></button>`).join('');
  $('#character-grid').scrollTop = scroll;
  if (focus) $(focus)?.focus({ preventScroll:true });
  queuePortraits();
}
function openCharacters() { renderCharacters(); $('#character-dialog').showModal(); if (room?.phase === 'lobby') send({ type: 'choosing', choosing: true }); }
$('#character-dialog').addEventListener('close', () => { if (room?.phase === 'lobby') send({ type: 'choosing', choosing: false }); });
function previewCharacter() {
  const character = CHARACTERS.find(c => c.id === profile.character);
  setPortrait($('#character-preview-image'), profile.character, profile.color);
  $('#character-preview-name').textContent = character.name + ' · ' + COLORS.find(c => c.id === profile.color).name;
}
['#hero-character', '#lobby-character', '#entry-customize'].forEach((id) => $(id).addEventListener('click', openCharacters));
$('#color-picker').addEventListener('click', (event) => { const button = event.target.closest('[data-color]'); if (button) { profile.color = button.dataset.color; renderCharacters(); updateProfile(); if (room) send({ type: 'customize', color: profile.color }); } });
$('#character-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-character]'); if (button && !button.disabled) { profile.character = button.dataset.character; renderCharacters(); updateProfile(); if (room) send({ type: 'customize', character: profile.character }); } });
$('#character-done').addEventListener('click', () => $('#character-dialog').close());

function switchScreen(mode) {
  if (mode !== 'game') sound.setMusicPlaying(false);
  document.body.dataset.screen = mode;
  $('#nav-home').hidden = mode !== 'home';
  $('#nav-maps').textContent = mode === 'room' ? '경기 정보' : '맵 보기';
  if (mode === 'game') document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (mode !== 'game') { clearInterval(resultsTimer); resultsKey = ''; watchId = null; soundState = null; $('#course-intro').hidden = true; $('#spectator-panel').hidden = true; $('#game-screen').classList.remove('spectating'); }
  $('#home-screen').hidden = mode !== 'home';
  $('#room-screen').hidden = mode !== 'room';
  $('#game-screen').hidden = mode !== 'game';
  $('#site-header').hidden = mode === 'game';
  const canvas = $('#world-canvas');
  canvas.setAttribute('aria-label', mode === 'game' ? '3D 장애물 레이스 경기 화면' : '선택한 젤리 캐릭터 3D 미리보기');
  const container = $(mode === 'home' ? '#hero-visual' : mode === 'room' ? '#lobby-visual' : '#game-canvas-slot');
  if (canvas.parentElement !== container) container.appendChild(canvas);
  syncSceneActivity();
}

function playerStatus(player) {
  if (!player?.connected) return { kind: 'offline', text: '연결 끊김' };
  if (player.choosing) return { kind: 'choosing', text: '캐릭터 고르는 중' };
  return player.ready || player.id === room?.hostId ? { kind: 'ready', text: '준비 완료' } : { kind: 'waiting', text: '대기 중' };
}
let managedPlayerId = null;
$('#open-settings').addEventListener('click', () => $('#settings-dialog').showModal());
$('#player-grid').addEventListener('click', event => {
  if (event.target.closest('#empty-invite')) { $('#copy-invite').click(); return; }
  const button = event.target.closest('[data-player]');
  if (!button || room?.hostId !== myId) return;
  const player = room.players.find(p => p.id === button.dataset.player);
  if (!player) return;
  managedPlayerId = player.id; $('#manage-name').textContent = player.name + ' · ' + playerStatus(player).text;
  $('#manage-dialog').showModal();
});
$('#kick-player').addEventListener('click', () => { if (send({ type:'kick', playerId:managedPlayerId })) $('#manage-dialog').close(); });

function renderRoom(previous) {
  sound.setMusicPlaying(room.phase === 'playing', room.phase === 'countdown');
  const host = room.hostId === myId;
  const me = room.players.find((p) => p.id === myId);
  const previewChanged = me && (profile.character !== me.character || profile.color !== me.color || previous?.settings.characterMode !== room.settings.characterMode);
  if (me && previewChanged) { profile.character = me.character; profile.color = me.color; updateProfile(); }
  if ($('#character-dialog').open && previewChanged) renderCharacters();
  scene?.setPlayers(room.players);
  if (room.phase === 'lobby') {
    switchScreen('room');
    if (sceneMode !== 'preview' || !previous) { scene?.setMode('preview'); scene?.setCharacter(profile.character, profile.color); sceneMode = 'preview'; }
    latestState = null;
    $('#room-code').textContent = room.code;
    $('#room-count').textContent = room.players.length + ' / 30';
    $('#room-description').textContent = host ? '내가 연 캠프' : (room.players.find(p => p.id === room.hostId)?.name || '친구') + '의 캠프';
    $('#self-role').textContent = host ? '나 · 방장' : '나';
    $('#self-name').textContent = me?.name || profile.name;
    if (!$('#self-portrait')) $('#lobby-visual').insertAdjacentHTML('beforeend', '<img id="self-portrait" alt="내 캐릭터">');
    setPortrait($('#self-portrait'), profile.character, profile.color);
    const state = playerStatus(me);
    $('#self-status').textContent = state.text; $('#self-status').className = 'camp-status ' + state.kind;
    $('#host-badge').textContent = host ? '경기 설정 ⚙' : '경기 정보';
    mapOptions(room.settings);
    $('#map-select').value = room.settings.mapId;
    $('#character-mode').value = room.settings.characterMode;
    $('#match-mode').value = room.settings.matchMode;
    $('#round-rule').value=room.settings.roundRule; $('#rule-settings').hidden=room.settings.matchMode!=='single';
    $('#map-select-label').textContent=room.settings.matchMode==='elimination'?'첫 라운드 맵':'플레이할 맵';
    $('#mode-help').textContent=room.settings.matchMode==='elimination'?'레이스 상위 절반 · 생존은 끝까지 버티기. 5명 이하가 되면 결승! 이후 맵은 자동으로 골라요.':room.settings.matchMode==='series'?'레이스 맵으로 매판 같은 배점이에요.':'레이스는 완주 순위, 생존은 버틴 시간으로 겨뤄요.';
    $('#rounds-select').value = room.settings.rounds || 3;
    $('#rounds-settings').hidden = room.settings.matchMode !== 'series';
    document.querySelectorAll('#settings-form select').forEach(s => { s.disabled = !host; });
    const map = MAPS.find(m => m.id === room.settings.mapId);
    $('#selected-map-preview').textContent = map ? map.description : '시작할 때 코스를 골라요.';
    $('#course-name').textContent = map?.name || '랜덤 맵';
    $('#course-meta').textContent = (room.settings.matchMode === 'series' ? room.settings.rounds + '판 점수전' : room.settings.matchMode==='elimination'?'탈락전':room.settings.roundRule==='survival'?'단판 생존':'단판 레이스') + ' · ' + room.settings.duration / 60 + '분';
    const ready = room.players.filter(p => p.connected && !p.choosing && (p.ready || p.id === room.hostId)).length;
    $('#ready-count').textContent = ready + '명 준비';
    $('#ready-toggle').hidden = host;
    $('#ready-toggle').disabled = Boolean(me?.choosing);
    $('#ready-toggle').textContent = me?.ready ? '준비 완료 · 취소' : '준비 완료 ✓';
    $('#ready-toggle').setAttribute('aria-pressed', String(!!me?.ready));
    $('#ready-help').textContent = host ? ready === room.players.length ? '모두 준비됐어요. 출발할까요?' : (room.players.length - ready) + '명 준비 전' : me?.ready ? '방장의 시작을 기다려요.' : '준비를 눌러주세요.';
    $('#start-game').hidden = !host;
    $('#start-game').disabled = !host || !scene || ready !== room.players.length;
    $('#player-grid').innerHTML = room.players.filter(p => p.id !== myId).map(p => {
      const c = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
      const status = playerStatus(p);
      return '<article class="player-card ' + (!p.connected ? 'disconnected' : '') + '">' + portraitImage(p.character, p.color, 'class="player-portrait" alt="' + escapeHTML(c.name) + '"') + '<strong class="player-name" title="' + escapeHTML(p.name) + '">' + escapeHTML(p.name) + (p.id === room.hostId ? '<small>방장</small>' : '') + '</strong><span class="camp-status ' + status.kind + '">' + status.text + '</span>' + (host ? '<button class="manage-player" data-player="' + p.id + '" aria-label="' + escapeHTML(p.name) + ' 참가자 관리">⋮</button>' : '') + '</article>';
    }).join('') + (room.players.length < 30 ? '<button class="player-card empty-player" id="empty-invite">＋ 친구 초대</button>' : '');
    $('#results-overlay').hidden = true;
    queuePortraits();
  } else {
    switchScreen('game');
    if (sceneMode !== 'race' || sceneMap !== room.mapId || previous?.startsAt !== room.startsAt) {
      scene?.setMode('race', { mapId: room.mapId, playerId: myId, rule:room.rule, reset:true });
      scene?.setPlayers(room.players);
      sceneMode = 'race'; sceneMap = room.mapId; resetInput();
      activeCourse = createCourse(room.mapId,room.rule);
      $('#course-map').innerHTML=mapArt(activeCourse,0,activeCourse);
      $('#intro-rule').textContent=activeCourse.tip; $('#controls-rule').textContent=activeCourse.tip;
    }
    if (previous?.startsAt !== room.startsAt) {
      latestState=null; scene?.beginRound(room.startsAt); sound.unlock(); soundState = null; watchId = null; watchOptionsKey = ''; countdownSound = 0;
    }
    if (room.phase === 'playing' && previous?.phase === 'countdown') sound.play('go');
    const map = MAPS.find((m) => m.id === room.mapId);
    $('#intro-map-name').textContent = map?.name || '캠프 레이스';
    $('#intro-map-tip').textContent = map?.description || '';
    $('#game-map-name').textContent = map?.name || '레이스';
    const series = room.settings.matchMode === 'series';
    const myScore = room.scores?.find((row) => row.id === myId)?.score || 0;
    $('#game-map-label').textContent = series ? `ROUND ${room.round} / ${room.settings.rounds} · 누적 ${myScore}점` : room.settings.matchMode==='elimination' ? (room.isFinal?'FINAL':'ROUND '+room.round)+' · '+(room.rule==='survival'?'생존':'레이스') : '단판 · '+(room.rule==='survival'?'생존':'레이스');
    $('#results-overlay').hidden = room.phase !== 'results';
    $('#game-screen').classList.toggle('game-results', room.phase === 'results');
    if (room.phase === 'results') renderResults();
    else { clearInterval(resultsTimer); resultsKey = ''; }
    renderRaceState();
  }
}

$('#ready-toggle').addEventListener('click', () => send({ type: 'ready', ready: !room.players.find(p => p.id === myId)?.ready }));
$('#settings-form').addEventListener('change', event => {
  const settings={mapId:$('#map-select').value,characterMode:$('#character-mode').value,matchMode:$('#match-mode').value,rounds:Number($('#rounds-select').value),roundRule:$('#round-rule').value};
  if(settings.matchMode==='series') settings.roundRule='race';
  if(event.target.id==='match-mode' || event.target.id==='round-rule') { mapOptions(settings); settings.mapId=$('#map-select').value; }
  send({type:'settings',...settings});
});
$('#start-game').addEventListener('click', () => { if (send({ type: 'start' })) $('#start-game').disabled = true; });
$('#copy-invite').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${room.code}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요! 친구들에게 보내주세요.'); }
  catch { const input = document.createElement('textarea'); input.value = url; document.body.appendChild(input); input.select(); const success = document.execCommand('copy'); input.remove(); if (success) toast('초대 링크를 복사했어요!'); else { window.prompt('아래 초대 링크를 복사해주세요.', url); } }
});

function goHome() {
  room = null; myId = null; latestState = null; savedSession = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  saveStorage(sessionStorage, 'jelly-session', null); history.replaceState(null, '', '/');
  sceneMode = 'preview'; sceneMap = ''; resetInput();
  switchScreen('home'); scene?.setMode('preview'); scene?.setCharacter(profile.character, profile.color); renderMaps();
}
function leaveRoom() { if (socket?.readyState === WebSocket.OPEN) send({ type: 'leave' }); else goHome(); }
$('#leave-room').addEventListener('click', leaveRoom);
$('#race-leave').addEventListener('click', leaveRoom);
$('#return-lobby').addEventListener('click', () => { if (send({ type: room && hasNextRound(room) ? 'next' : 'lobby' })) $('#return-lobby').disabled = true; });

let lastRankHTML = '', lastLeadersHTML = '';
function renderRaceState() {
  if(!room || room.phase==='lobby' || !latestState) return;
  const racers=[...latestState.players].sort((a,b)=>Number(a.eliminated)-Number(b.eliminated)||Number(b.finished)-Number(a.finished)||(a.finished?(a.finishTime??0)-(b.finishTime??0):(b.progress||0)-(a.progress||0)));
  const me=racers.find(p=>p.id===myId), alive=racers.filter(p=>!p.eliminated&&!p.finished), knockout=room.settings.matchMode==='elimination';
  $('#ranking-label').textContent=room.rule==='survival'?'남은 참가자':'실시간 순위';
  const rankHTML=room.rule==='survival'?alive.length+' <span>명 생존</span>':(me&&!me.eliminated?racers.indexOf(me)+1:'관전')+' <span>/ '+racers.length+'</span>';
  if (rankHTML !== lastRankHTML) { $('#my-rank').innerHTML = rankHTML; lastRankHTML = rankHTML; }
  const leadersHTML=racers.filter(p=>!p.eliminated).slice(0,5).map((p,i)=>'<div class="race-leader '+(p.id===myId?'me':'')+'"><span>'+(room.rule==='race'?(i+1)+'. ':'')+escapeHTML(room.players.find(r=>r.id===p.id)?.name||'젤리')+'</span><span>'+(p.finished?'✓':'')+'</span></div>').join('');
  if (leadersHTML !== lastLeadersHTML) { $('#race-leaders').innerHTML = leadersHTML; lastLeadersHTML = leadersHTML; }
  const passed=racers.filter(p=>p.finished).length;
  $('#round-objective').textContent=room.rule==='survival'?(room.isFinal?'마지막 한 명이 우승!':'떨어지면 탈락 · '+alive.length+'명 생존'):knockout?(room.isFinal?'가장 먼저 왕관에 도착하세요!':'통과 '+passed+' / '+room.quota+'명'):'번호 깃발을 지나 결승선까지!';
  $('#progress-start').textContent=room.rule==='survival'?'생존':'출발'; $('#progress-end').textContent=room.rule==='survival'?'시간까지 버티기':'⚑ 도착';
  $('#race-progress').style.width=room.rule==='survival'?Math.min(100,latestState.time/room.settings.duration*100)+'%':Math.round((me?.progress||0)*100)+'%';
  $('#race-status').hidden=true;
  if(me) {
    if(room.phase==='playing' && soundState) {
      if(me.eliminated&&!soundState.eliminated) sound.play('out');
      else if(me.finished&&!soundState.finished) sound.play('finish');
      else if(me.checkpoint>soundState.checkpoint) sound.play('checkpoint');
      else if(me.springCount != null && me.springCount !== (soundState.springCount || 0) && me.fallCount === soundState.fallCount) sound.play(me.springKind === 1 ? 'rebound' : 'spring');
      else if((me.jumpCount||0)>(soundState.jumpCount||0)) sound.play('jump');
      else if(me.diveCooldown>soundState.diveCooldown+.3) sound.play('dive');
      else if(me.bumpTime>soundState.bumpTime+.05||me.hitCooldown>soundState.hitCooldown+.15) sound.play('hit');
      else if((me.landCount||0)>(soundState.landCount||0)) sound.play('land');
      if(me.grounded && me.surface===1 && Math.hypot(me.vx,me.vz)>3) sound.play('skid');
      if(me.grounded && me.surface===2 && soundState.surface!==2) sound.play('belt');
    }
    soundState={...me};
  }
  const focus=racers.find(p=>p.id===(watchId||myId));
  if(focus && activeCourse) {
    const position=mapProjection(activeCourse)(focus);
    const dot=$('#course-map .map-player'); dot?.setAttribute('cx',position.x); dot?.setAttribute('cy',position.y);
  }
  updateSpectator(me,racers);
}

function syncView() {
  if(!room || socket?.readyState!==WebSocket.OPEN) return;
  const data={type:'view',watchId:watchId||null,hidden:document.hidden},key=JSON.stringify(data);
  if(key!==lastView) { lastView=key;send(data); }
}
function updateSpectator(me,racers) {
  const eliminated=room.players.find(p=>p.id===myId)?.eliminated || me?.eliminated || !me;
  const active=!!(eliminated || me?.finished) && ['playing','countdown'].includes(room.phase);
  const entering = active && $('#spectator-panel').hidden;
  $('#spectator-panel').hidden=!active; $('#game-screen').classList.toggle('spectating',active);
  if(!active) { if(room.phase==='results') scene?.followPlayer(null); return; }
  if (entering) resetInput();
  const candidates=room.players.filter(p=>p.id!==myId && racers.some(r=>r.id===p.id&&!r.finished&&!r.eliminated));
  if(!candidates.some(p=>p.id===watchId) && (eliminated||watchId!==myId)) watchId=candidates[0]?.id || null;
  const options=[...candidates,...(!eliminated?[{id:myId,name:'내 캐릭터'}]:[])];
  const key=options.map(p=>p.id+p.name).join('|');
  if(key!==watchOptionsKey) { $('#spectator-select').innerHTML=options.map(p=>'<option value="'+p.id+'">'+escapeHTML(p.name)+'</option>').join(''); watchOptionsKey=key; }
  $('#spectator-select').value=watchId||'';
  $('#spectator-status').textContent=eliminated?'탈락 · 친구 관전 중':room.settings.matchMode==='elimination'?'통과 확정 · 친구 관전 중':'완주! '+(me?.finishTime?.toFixed(2)||'')+'초';
  $('#spectator-self').hidden=eliminated;
  $('#spectator-prev').disabled=$('#spectator-next').disabled=candidates.length<2;
  scene?.followPlayer(watchId);
  syncView();
}
$('#spectator-select').addEventListener('change', event => { watchId = event.target.value; renderRaceState(); });
$('#spectator-self').addEventListener('click', () => { watchId = myId; renderRaceState(); });
for (const [id, direction] of [['spectator-prev', -1], ['spectator-next', 1]]) {
  $('#' + id).addEventListener('click', () => {
    const ids = [...$('#spectator-select').options].map(o => o.value);
    watchId = ids[(ids.indexOf(watchId) + direction + ids.length) % ids.length]; renderRaceState();
  });
}

function renderResults() {
  resetInput();
  $('#countdown').hidden = true; $('#course-intro').hidden = true; $('#spectator-panel').hidden = true; $('#game-screen').classList.remove('spectating');
  const key = `${room.code}:${room.startsAt}`;
  if (resultsKey !== key) {
    clearInterval(resultsTimer);
    resultsKey = key; shownResults = 0; skipReveal = false;
    const overall = room.settings.matchMode === 'series' && room.round >= room.settings.rounds;
    const tournamentFinal=room.settings.matchMode==='elimination' && room.matchOver;
    orderedResults = resultOrder(tournamentFinal ? room.standings : overall ? room.scores.map((r) => ({ ...r, status: 'finished', overall: true })) : room.results);
    revealStart = performance.now() - Math.max(0, Date.now() - (room.resultsAt || Date.now()));
    $('#result-title').textContent = overall ? `${room.settings.rounds}판의 승부, 최종 결과는?` : room.settings.matchMode === 'series' ? `${room.round} / ${room.settings.rounds} 라운드 결과` : '우리의 경기, 그 결과는?';
    $('#result-subtitle').textContent = overall ? '누적 점수가 낮은 순위부터… 최종 우승자를 만나요!' : '낮은 순위부터 차례차례… 마지막에 우승자를 만나요!';
    $('#results-list').style.setProperty('--columns', Math.min(orderedResults.length <= 12 ? 4 : 6, orderedResults.length));
    $('#results-list').style.setProperty('--rows', Math.max(1, Math.ceil(orderedResults.length / (orderedResults.length <= 12 ? 4 : 6))));
    $('#results-overlay').classList.toggle('crowded', orderedResults.length > 12);
    $('#spotlight-person').innerHTML = '<strong>누가 먼저 나올까?</strong>';
    $('#result-spotlight').classList.remove('winner');
    $('#results-list').innerHTML = orderedResults.map((r, i) => {
      const color = COLORS.find((c) => c.id === r.color) || COLORS[0];
      const character = CHARACTERS.find((c) => c.id === r.character) || CHARACTERS[0];
      const photo = scene ? portraitImage(character.id, color.id, `alt="${escapeHTML(character.name)} · ${escapeHTML(color.name)}" width="256" height="256"`) : `<span class="portrait-fallback">${character.emoji}</span>`;
      const place = placeLabel(r);
      const tied = r.rank!=null && orderedResults.filter(row=>row.rank===r.rank).length>1;
      const score = room.scores?.find((row) => row.id === r.id)?.score || 0;
      const points = roundPoints(r, room.results.length);
      const series=room.settings.matchMode==='series', knockout=room.settings.matchMode==='elimination';
      const value=series?(r.overall?r.score:score)+'점':knockout?(r.id===room.winnerId?'우승':r.qualified?'통과':'탈락'):room.rule==='survival'?(r.status==='survived'?'생존':Number(r.time||0).toFixed(1)+'초'):r.status==='finished'?Number(r.time).toFixed(2)+'초':'미완주';
      const detail=series?(r.overall?r.completed+'회 완주':'이번 판 +'+points+'점'):knockout?(r.eliminationRound?r.eliminationRound+'라운드 탈락':room.isFinal?'결승':room.round+'라운드'):room.rule==='survival'?(r.status==='survived'?'끝까지 버텼어요':'떨어져서 탈락'):'완주 기록';
      return `<article class="result-tile ${r.id === myId ? 'me' : ''} ${isSuccessful(r) && r.rank === 1 ? 'winner' : isSuccessful(r) && r.rank === 2 ? 'silver' : isSuccessful(r) && r.rank === 3 ? 'bronze' : ''}" role="listitem" aria-label="결과 공개 대기" data-index="${i}" style="--jelly-color:${color.hex};order:${orderedResults.length - i}"><div class="result-front" aria-hidden="true"><span class="tile-rank">${tied ? '공동 ' : ''}${place}</span>${r.id === myId ? '<span class="tile-me">나</span>' : ''}<div class="result-photo">${photo}</div><div class="tile-caption"><strong>${escapeHTML(r.name)}</strong><b class="result-value">${escapeHTML(value)}</b><small>${escapeHTML(detail)}</small></div></div><div class="result-back" aria-hidden="true"><span>?</span><small>${tied ? '공동 ' : ''}${place}</small></div></article>`;
    }).join('');
    $('#results-list').scrollTop = 0;
    queuePortraits();
    resultsTimer = setInterval(updateResultReveal, 80);
  }
  updateResultReveal();
}

function updateResultReveal() {
  if (room?.phase !== 'results') { clearInterval(resultsTimer); return; }
  const total = orderedResults.length;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = skipReveal || reducedMotion ? total : revealedCount(total, performance.now() - revealStart);
  const advanced = count > shownResults;
  const tiles = $('#results-list').children;
  for (let i = shownResults; i < count; i++) {
    const result = orderedResults[i], tile = tiles[i];
    tile.classList.add('revealed');
    tile.querySelector('.result-front').setAttribute('aria-hidden', 'false');
    tile.setAttribute('aria-label', `${placeLabel(result)} ${result.name}, ${tile.querySelector('.result-value').textContent}${result.id === myId ? ', 나' : ''}`);
  }
  if (advanced) {
    const last = orderedResults[count - 1];
    $('#result-subtitle').textContent = `${placeLabel(last)} · ${last.name}${last.id === myId ? ' (나)' : ''}`;
    const currentTile = tiles[count - 1];
    $('#result-spotlight').classList.toggle('winner', last.rank === 1 && isSuccessful(last) && (!last.overall || last.score > 0));
    $('#spotlight-person').innerHTML = '<b class="spot-place">' + escapeHTML(currentTile.querySelector('.tile-rank').textContent) + '</b>' + currentTile.querySelector('.result-photo').innerHTML + '<strong>' + escapeHTML(last.name) + '</strong><p>' + escapeHTML(currentTile.querySelector('.result-value').textContent)+' · '+escapeHTML(currentTile.querySelector('.tile-caption small').textContent) + '</p>';
    shownResults = count;
  }
  const done = count === total;
  $('#reveal-count').textContent = `${count} / ${total} 공개`;
  $('#reveal-bar').style.width = `${total ? count / total * 100 : 100}%`;
  $('#skip-results').hidden = done;
  $('#return-lobby').disabled = !done || room.hostId !== myId;
  const nextRound = hasNextRound(room);
  $('#return-lobby').textContent = nextRound ? `${room.round + 1} 라운드 시작하기 →` : '대기실로 돌아가기 →';
  $('#results-help').textContent = !done ? '두근두근, 다음 젤리는 누구일까요?' : nextRound ? `점수가 누적됐어요. 방장이 다음 라운드를 시작할 수 있어요.` : room.hostId === myId ? '다른 맵에서 한 판 더 달려볼까요?' : '방장이 대기실로 돌아가면 함께 이동해요.';
  if (done) {
    clearInterval(resultsTimer);
    const winners = orderedResults.filter(r => r.rank===1 && isSuccessful(r) && (!r.overall || r.score>0));
    const winner = winners[0];
    $('#result-title').textContent = winners.length > 1 ? `공동 우승! ${winner.name} 님 외 ${winners.length - 1}명` : winner ? `${winner.name} 님, ${winner.overall ? '최종 ' : nextRound ? `${room.round}라운드 ` : ''}우승!` : '다시 도전할 젤리, 모두 모여!';
    $('#result-subtitle').textContent=winner?'함께한 모든 젤리에게 박수!':'완주자 없이 끝났어요. 다시 도전해요!';
    if(room.settings.matchMode==='elimination') {
      $('#result-title').textContent=room.matchOver?(room.winnerId?(room.standings.find(r=>r.id===room.winnerId)?.name+' 님, 최종 우승!'):'이번 경기에는 우승자가 없어요'):room.tieBreak?'결승 동률 · 한 번 더 겨뤄요!':room.results.filter(r=>r.qualified).length+'명, 다음 라운드 진출!';
      $('#result-subtitle').textContent=room.matchOver?'다음 경기에는 모두 다시 함께해요.':room.tieBreak?'남은 참가자끼리 레이스 결승을 다시 진행해요.':room.rule==='survival'?'제한 시간까지 생존한 참가자는 모두 통과해요.':'완주 순위로 통과자가 정해졌어요.';
      $('#results-help').textContent=nextRound?'탈락한 친구도 끝까지 관전할 수 있어요.':'방장이 대기실로 돌아가면 함께 이동해요.';
    }
    if(room.settings.matchMode==='single' && room.rule==='survival') $('#result-title').textContent=winners.length>1?winners.length+'명, 끝까지 생존!':winner?winner.name+' 님, 생존 성공!':'모두 탈락! 다음에 다시 도전해요.';

  }
}
$('#skip-results').addEventListener('click', () => { skipReveal = true; updateResultReveal(); });

function resetInput() { keys.clear(); queuedActions.jump = false; queuedActions.dive = false; Object.assign(touch, { x: 0, z: 0, jump: false, dive: false }); $('#joystick-knob').style.transform = ''; if (room) send({ type: 'input', ...touch }); }
const controlKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE']);
window.addEventListener('keydown', (event) => { if (room && ['countdown', 'playing'].includes(room.phase) && controlKeys.has(event.code) && !document.querySelector('dialog[open]') && !['INPUT','SELECT'].includes(event.target.tagName) && !(event.target.tagName === 'BUTTON' && event.code === 'Space') && !$('#game-screen').classList.contains('spectating')) { event.preventDefault(); keys.add(event.code); if (!event.repeat && event.code === 'Space') queuedActions.jump = true; if (!event.repeat && event.code === 'KeyE') queuedActions.dive = true; } });
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { sound.syncMusic(); syncView(); if (document.hidden) resetInput(); else sound.unlock(); });
setInterval(() => {
  if (!room || room.phase !== 'playing' || document.hidden || $('#game-screen').classList.contains('spectating')) return;
  const left = keys.has('KeyA') || keys.has('ArrowLeft'), right = keys.has('KeyD') || keys.has('ArrowRight');
  const forward = keys.has('KeyW') || keys.has('ArrowUp'), back = keys.has('KeyS') || keys.has('ArrowDown');
  send({ type: 'input', x: Math.max(-1, Math.min(1, Number(left) - Number(right) + touch.x)), z: Math.max(-1, Math.min(1, Number(forward) - Number(back) + touch.z)), jump: keys.has('Space') || touch.jump || queuedActions.jump, dive: keys.has('KeyE') || touch.dive || queuedActions.dive });
  queuedActions.jump = false; queuedActions.dive = false;
}, 1000 / 30);
setInterval(() => {
  if (!room || !['countdown', 'playing'].includes(room.phase)) return;
  const remaining = latestState && room.phase === 'playing' ? Math.max(0, room.settings.duration - latestState.time - (performance.now() - stateAt) / 1000) : room.settings.duration;
  const seconds = Math.ceil(remaining);
  $('#game-timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const count = Math.ceil((room.startsAt - Date.now()) / 1000);
  $('#course-intro').hidden = room.phase !== 'countdown' || count <= 3;
  $('#countdown').hidden = room.phase !== 'countdown' || count > 3;
  if (room.phase === 'countdown' && count > 0 && count <= 3 && countdownSound !== count) { countdownSound = count; sound.play('count'); }
  $('#countdown').textContent = count > 0 ? String(count) : 'GO!';
}, 100);

let joystickPointer = null;
function moveJoystick(event) {
  if (event.pointerId !== joystickPointer) return;
  const rect = $('#joystick').getBoundingClientRect();
  let x = (event.clientX - rect.left - rect.width / 2) / 37, z = (event.clientY - rect.top - rect.height / 2) / 37;
  const length = Math.hypot(x, z); if (length > 1) { x /= length; z /= length; }
  touch.x = -x; touch.z = -z;
  $('#joystick-knob').style.transform = `translate(${x * 32}px,${z * 32}px)`;
}
$('#joystick').addEventListener('pointerdown', (event) => { joystickPointer = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); moveJoystick(event); });
$('#joystick').addEventListener('pointermove', moveJoystick);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#joystick').addEventListener(type, (event) => { if (joystickPointer === event.pointerId) { joystickPointer = null; touch.x = 0; touch.z = 0; $('#joystick-knob').style.transform = ''; } });
for (const action of ['jump', 'dive']) {
  $(`#touch-${action}`).addEventListener('pointerdown', (event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touch[action] = true; queuedActions[action] = true; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $(`#touch-${action}`).addEventListener(type, () => { touch[action] = false; });
}

updateProfile();
const initialCode = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (initialCode && savedSession?.code !== initialCode) showEntry('join', initialCode);
connect().catch((error) => toast(error.message));
