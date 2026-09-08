import { MAPS, createCourse } from './world.js';
import { CHARACTERS, COLORS } from './catalog.js';
import { GameScene } from './scene.js';
import { resultOrder, revealedCount, roundPoints } from './results.js';
import { GameAudio } from './audio.js';

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
let latestState = null, stateAt = 0, toastTimer, requestTimer, scene, finishZ = 144;
let resultsTimer, resultsKey = '', revealStart = 0, shownResults = 0, orderedResults = [], skipReveal = false;
const sound = new GameAudio(readStorage(localStorage, 'camp-sound') !== false);
let soundState = null, watchId = null, watchOptionsKey = '', countdownSound = 0;
const queuedActions = { jump: false, dive: false };
const keys = new Set();
const touch = { x: 0, z: 0, jump: false, dive: false };

function updateSoundButtons() {
  document.querySelectorAll('[data-sound-toggle]').forEach(button => {
    button.textContent = sound.enabled ? '♪ 소리 켜짐' : '♪ 소리 꺼짐';
    button.setAttribute('aria-pressed', String(sound.enabled));
  });
}
document.querySelectorAll('[data-sound-toggle]').forEach(button => button.addEventListener('click', () => {
  sound.enabled = !sound.enabled; saveStorage(localStorage, 'camp-sound', sound.enabled);
  sound.unlock(); updateSoundButtons();
}));
window.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
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

function mapArt(map, index) {
  const floor = map.colors.floor, accent = map.colors.accent;
  let obstacles = '';
  const spinner = (x, y, angle) => `<g transform="translate(${x} ${y}) rotate(${angle})"><rect x="-52" y="-5" width="104" height="11" rx="5" fill="${accent}"/><rect x="-5" y="-27" width="10" height="54" rx="5" fill="${accent}"/><circle r="10" fill="#bba477"/><circle r="5" fill="${accent}"/></g>`;
  const bumper = (x, y) => `<ellipse cx="${x}" cy="${y + 6}" rx="15" ry="8" fill="#45446e20"/><path d="M${x - 14} ${y - 12}v14a14 7 0 0028 0v-14" fill="${accent}"/><ellipse cx="${x}" cy="${y - 12}" rx="14" ry="7" fill="#bba47799"/><ellipse cx="${x}" cy="${y - 12}" rx="8" ry="4" fill="${accent}"/>`;
  if ([1, 0, 11].includes(index)) obstacles = spinner(138, 110, -15) + spinner(190, 61, 28) + bumper(228, 134) + bumper(85, 58);
  else if ([2, 8, 9].includes(index)) obstacles = [0, 1, 2, 3, 4, 5].map((n) => `<g transform="translate(${83 + (n % 2) * 95} ${142 - n * 20})"><path d="M0 0l45 -7 24 13-45 8z" fill="${accent}" opacity="${index === 8 && n % 3 === 0 ? '.28' : '1'}"/><path d="M0 0v8l24 13v-8z" fill="#bba47755"/></g>`).join('');
  else if ([4, 6].includes(index)) obstacles = [62, 116].map((y) => [82, 143, 204].map((x, i) => `<g transform="translate(${x} ${y})"><path d="M0 18v-34h43v34" fill="none" stroke="#bba477" stroke-width="5"/><path d="M4 -13h35v${i === 1 ? 12 : 27}h-35z" fill="${accent}"/><path d="M6 -8h31M6 -1h31" stroke="#bba47766" stroke-width="3"/></g>`).join('')).join('');
  else if (index === 7) obstacles = [90, 155, 220].map((x, i) => `<path d="M${x} 13l${i % 2 ? -15 : 17} 75" stroke="#785b40" stroke-width="4"/><circle cx="${x + (i % 2 ? -15 : 17)}" cy="88" r="20" fill="${accent}"/><circle cx="${x + 10}" cy="81" r="7" fill="#bba47755"/>`).join('');
  else if (index === 5) obstacles = [68, 223].map((x, i) => `<g transform="translate(${x} ${i ? 65 : 119})"><circle r="24" fill="#bba477"/><circle r="19" fill="${accent}"/>${[0, 90, 180, 270].map((angle) => `<ellipse cy="-8" rx="5" ry="11" transform="rotate(${angle})" fill="#bba47799"/>`).join('')}<circle r="5" fill="${floor}"/><path d="M26 -6h24M26 3h36M26 12h20" stroke="#bba47799" stroke-width="3" stroke-linecap="round"/></g>`).join('');
  else obstacles = [0, 1, 2, 3, 4, 5].map((n) => bumper(91 + (n % 3) * 60, 65 + Math.floor(n / 3) * 57)).join('');
  return `<svg viewBox="0 0 320 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="320" height="190" fill="${map.colors.sky}"/><circle cx="281" cy="34" r="33" fill="#bba47722"/><ellipse cx="43" cy="36" rx="33" ry="12" fill="#bba47755"/><ellipse cx="271" cy="160" rx="35" ry="10" fill="#bba47744"/><g transform="translate(0 6)"><path d="M52 156L84 29h156l39 127-117 25z" fill="#51547723"/><path d="M48 141L80 20h160l39 121-118 24z" fill="${floor}"/><path d="M48 141v9l113 24v-9z" fill="#3f437127"/><path d="M161 165l118-24v9l-118 24z" fill="#3f437140"/><path d="M55 138L84 27M272 138L236 27" stroke="#344839" stroke-width="5" stroke-linecap="round"/><path d="M149 139L153 39M172 141L167 39" stroke="#bba47733" stroke-width="2" stroke-dasharray="7 7"/>${obstacles}<g transform="translate(142 150)"><ellipse cy="7" rx="10" ry="4" fill="#57546630"/><rect x="-7" y="-14" width="14" height="20" rx="7" fill="#b85c37"/><rect x="-5" y="-10" width="10" height="7" rx="4" fill="#d9d2bc"/><circle cx="-2" cy="-6.5" r="1"/><circle cx="2" cy="-6.5" r="1"/></g></g></svg>`;
}

function renderMaps() {
  $('#map-grid').innerHTML = MAPS.map((map, i) => filter !== 'all' && map.difficulty !== Number(filter) ? '' : `<button class="map-card ${selectedMap === map.id ? 'selected' : ''}" data-map="${map.id}" aria-pressed="${selectedMap === map.id}" aria-label="${escapeHTML(map.name)} 맵 선택"><div class="map-art">${mapArt(map, i)}<span class="map-number">MAP ${String(i + 1).padStart(2, '0')}</span>${selectedMap === map.id ? '<span class="map-picked">선택됨 ✓</span>' : ''}</div><div class="map-info"><div class="map-title"><h3>${map.name}</h3><span class="difficulty" aria-label="난이도 ${map.difficulty}">${'●'.repeat(map.difficulty)}${'○'.repeat(3 - map.difficulty)}</span></div><p>${map.subtitle}</p><div class="map-tags">${map.tags.slice(0, 2).map((t) => `<span>${t}</span>`).join('')}<i>↗</i></div></div></button>`).join('');
}
renderMaps();
$('#map-select').insertAdjacentHTML('beforeend', MAPS.map((m) => `<option value="${m.id}">${m.emoji} ${m.name}</option>`).join(''));
$('#map-grid').addEventListener('click', (event) => { const card = event.target.closest('[data-map]'); if (card) { selectedMap = card.dataset.map; renderMaps(); toast(`${MAPS.find((m) => m.id === selectedMap).name} 선택! 방을 만들면 이 맵으로 시작해요.`); } });
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === button)); renderMaps(); }));
$('#random-map').addEventListener('click', () => { selectedMap = 'random'; renderMaps(); toast('랜덤 모드! 시작할 때 12개 맵 중 하나를 골라드려요.'); });

function setConnection(online) {
  $('#connection-dot').className = online ? '' : 'off';
  $('#connection-label').textContent = online ? '플레이 준비 완료' : '서버에 연결 중';
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('서버 연결 시간이 초과됐어요. 서버 실행 상태를 확인해주세요.')); }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout); setConnection(true); reconnectAttempts = 0; connecting = null; resolve();
      const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
      if (savedSession?.token && savedSession.code === code) { reconnectPending = true; send({ type: 'join', code, name: profile.name || '젤리', token: savedSession.token, character: profile.character, color: profile.color }); }
    });
    socket.addEventListener('message', (event) => {
      try { onMessage(JSON.parse(event.data)); } catch (error) { console.error('메시지 처리 오류', error); }
    });
    socket.addEventListener('close', (event) => {
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
  socket.send(JSON.stringify(data)); return true;
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
    if (entryMode === 'create' && selectedMap !== 'random') { send({ type: 'settings', mapId: selectedMap }); selectedMap = 'random'; }
    entryMode = 'join';
  } else if (message.type === 'room') {
    const previousRoom = room;
    room = message.room;
    renderRoom(previousRoom);
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

function updateProfile() {
  const c = CHARACTERS.find((item) => item.id === profile.character);
  $('#entry-avatar').innerHTML = scene ? `<img src="${scene.portrait(c.id, profile.color)}" alt="${escapeHTML(c.name)}">` : c.emoji;
  $('#entry-avatar').style.background = `${COLORS.find((color) => color.id === profile.color).hex}35`;
  $('#entry-character-name').textContent = c.name;
  scene?.setCharacter(profile.character, profile.color);
  saveStorage(localStorage, 'jelly-profile', profile);
}

function renderCharacters() {
  const scroll = $('#character-grid').scrollTop;
  const active = document.activeElement;
  const focus = active?.dataset.color ? `[data-color="${active.dataset.color}"]` : active?.dataset.character ? `[data-character="${active.dataset.character}"]` : null;
  previewCharacter();
  const random = room?.settings.characterMode === 'random';
  $('#character-help').textContent = random ? '랜덤 캐릭터 · 색상은 자유롭게' : `${CHARACTERS.length}종 · ${COLORS.length}색`;
  $('#color-picker').innerHTML = COLORS.map((c) => `<button class="color-swatch ${profile.color === c.id ? 'selected' : ''}" style="background:${c.hex}" data-color="${c.id}" aria-label="${c.name}" aria-pressed="${profile.color === c.id}" title="${c.name}"></button>`).join('');
  $('#character-grid').innerHTML = CHARACTERS.map((c) => `<button class="character-option ${profile.character === c.id ? 'selected' : ''}" data-character="${c.id}" aria-label="${c.name} 캐릭터" aria-pressed="${profile.character === c.id}" ${random ? 'disabled' : ''}><img class="char-model" src="${scene?.portrait(c.id, profile.color) || ''}" alt="" width="96" height="96"><span>${c.name}</span></button>`).join('');
  $('#character-grid').scrollTop = scroll;
  if (focus) $(focus)?.focus({ preventScroll:true });
}
function openCharacters() { renderCharacters(); $('#character-dialog').showModal(); if (room?.phase === 'lobby') send({ type: 'choosing', choosing: true }); }
$('#character-dialog').addEventListener('close', () => { if (room?.phase === 'lobby') send({ type: 'choosing', choosing: false }); });
function previewCharacter() {
  const character = CHARACTERS.find(c => c.id === profile.character);
  $('#character-preview-image').src = scene?.portrait(profile.character, profile.color) || '';
  $('#character-preview-name').textContent = character.name + ' · ' + COLORS.find(c => c.id === profile.color).name;
}
['#hero-character', '#lobby-character', '#entry-customize'].forEach((id) => $(id).addEventListener('click', openCharacters));
$('#color-picker').addEventListener('click', (event) => { const button = event.target.closest('[data-color]'); if (button) { profile.color = button.dataset.color; renderCharacters(); updateProfile(); if (room) send({ type: 'customize', color: profile.color }); } });
$('#character-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-character]'); if (button && !button.disabled) { profile.character = button.dataset.character; renderCharacters(); updateProfile(); if (room) send({ type: 'customize', character: profile.character }); } });
$('#character-done').addEventListener('click', () => $('#character-dialog').close());

function switchScreen(mode) {
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
  const host = room.hostId === myId;
  const me = room.players.find((p) => p.id === myId);
  const previewChanged = me && (profile.character !== me.character || profile.color !== me.color || previous?.settings.characterMode !== room.settings.characterMode);
  if (me) { profile.character = me.character; profile.color = me.color; updateProfile(); }
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
    $('#self-portrait').src = scene?.portrait(profile.character, profile.color) || '';
    const state = playerStatus(me);
    $('#self-status').textContent = state.text; $('#self-status').className = 'camp-status ' + state.kind;
    $('#host-badge').textContent = host ? '경기 설정 ⚙' : '경기 정보';
    $('#map-select').value = room.settings.mapId;
    $('#character-mode').value = room.settings.characterMode;
    $('#duration-select').value = room.settings.duration;
    $('#match-mode').value = room.settings.matchMode || 'single';
    $('#rounds-select').value = room.settings.rounds || 3;
    $('#rounds-settings').hidden = room.settings.matchMode !== 'series';
    document.querySelectorAll('#settings-form select').forEach(s => { s.disabled = !host; });
    const map = MAPS.find(m => m.id === room.settings.mapId);
    $('#selected-map-preview').textContent = map ? map.description : '시작할 때 코스를 골라요.';
    $('#course-name').textContent = map?.name || '랜덤 맵';
    $('#course-meta').textContent = (room.settings.matchMode === 'series' ? room.settings.rounds + '판 점수전' : '한 판 승부') + ' · ' + room.settings.duration / 60 + '분';
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
      return '<article class="player-card ' + (!p.connected ? 'disconnected' : '') + '"><img class="player-portrait" src="' + (scene?.portrait(p.character,p.color) || '') + '" alt="' + escapeHTML(c.name) + '"><strong class="player-name" title="' + escapeHTML(p.name) + '">' + escapeHTML(p.name) + (p.id === room.hostId ? '<small>방장</small>' : '') + '</strong><span class="camp-status ' + status.kind + '">' + status.text + '</span>' + (host ? '<button class="manage-player" data-player="' + p.id + '" aria-label="' + escapeHTML(p.name) + ' 참가자 관리">⋮</button>' : '') + '</article>';
    }).join('') + (room.players.length < 30 ? '<button class="player-card empty-player" id="empty-invite">＋ 친구 초대</button>' : '');
    $('#results-overlay').hidden = true;
  } else {
    switchScreen('game');
    if (sceneMode !== 'race' || sceneMap !== room.mapId || previous?.phase === 'lobby') {
      scene?.setMode('race', { mapId: room.mapId, playerId: myId });
      scene?.setPlayers(room.players);
      sceneMode = 'race'; sceneMap = room.mapId; resetInput();
      finishZ = createCourse(room.mapId).finishZ;
    }
    if (previous?.startsAt !== room.startsAt) {
      scene?.beginRound(room.startsAt); soundState = null; watchId = null; watchOptionsKey = ''; countdownSound = 0;
    }
    if (room.phase === 'playing' && previous?.phase === 'countdown') sound.play('go');
    const map = MAPS.find((m) => m.id === room.mapId);
    $('#intro-map-name').textContent = map?.name || '캠프 레이스';
    $('#intro-map-tip').textContent = map?.description || '';
    $('#game-map-name').textContent = map?.name || '레이스';
    const series = room.settings.matchMode === 'series';
    const myScore = room.scores?.find((row) => row.id === myId)?.score || 0;
    $('#game-map-label').textContent = series ? `ROUND ${room.round} / ${room.settings.rounds} · 누적 ${myScore}점` : `CAMP JELLY · ${room.players.length} PLAYERS`;
    $('#results-overlay').hidden = room.phase !== 'results';
    if (room.phase === 'results') renderResults();
    else { clearInterval(resultsTimer); resultsKey = ''; }
    renderRaceState();
  }
}

$('#ready-toggle').addEventListener('click', () => send({ type: 'ready', ready: !room.players.find(p => p.id === myId)?.ready }));
$('#settings-form').addEventListener('change', () => send({ type: 'settings', mapId: $('#map-select').value, characterMode: $('#character-mode').value, duration: Number($('#duration-select').value), matchMode: $('#match-mode').value, rounds: Number($('#rounds-select').value) }));
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
$('#return-lobby').addEventListener('click', () => { if (send({ type: room?.settings.matchMode === 'series' && room.round < room.settings.rounds ? 'next' : 'lobby' })) $('#return-lobby').disabled = true; });

function renderRaceState() {
  if (!room || room.phase === 'lobby' || !latestState) return;
  const racers = [...latestState.players].sort((a, b) => a.finished !== b.finished ? Number(b.finished) - Number(a.finished) : a.finished ? (a.finishTime ?? 0) - (b.finishTime ?? 0) : b.z - a.z);
  const me = latestState.players.find((p) => p.id === myId);
  const rank = racers.findIndex((p) => p.id === myId) + 1;
  $('#my-rank').innerHTML = `${rank || '–'} <span>/ ${racers.length}</span>`;
  $('#race-leaders').innerHTML = racers.slice(0, 5).map((p, i) => `<div class="race-leader ${p.id === myId ? 'me' : ''}"><span>${i + 1}. ${escapeHTML(room.players.find((r) => r.id === p.id)?.name || '젤리')}</span><span>${p.finished ? '✓' : ''}</span></div>`).join('');
  if (me) {
    $('#race-progress').style.width = `${Math.max(0, Math.min(100, me.z / finishZ * 100))}%`;
    $('#race-status').hidden = !me.finished || room.phase === 'results';
    if (room.phase === 'playing' && soundState) {
      if (me.finished && !soundState.finished) sound.play('finish');
      else if (me.checkpoint > soundState.checkpoint) sound.play('checkpoint');
      else if ((me.jumpCount || 0) > (soundState.jumpCount || 0)) sound.play('jump');
      else if ((me.landCount || 0) > (soundState.landCount || 0)) sound.play('land');
      else if (me.diveCooldown > soundState.diveCooldown + .3) sound.play('dive');
      else if (me.bumpTime > soundState.bumpTime + .05 || me.hitCooldown > soundState.hitCooldown + .15) sound.play('hit');
    }
    soundState = { ...me };
    updateSpectator(me, racers);
  }
}

function updateSpectator(me, racers) {
  const active = me.finished && room.phase === 'playing';
  $('#spectator-panel').hidden = !active;
  $('#game-screen').classList.toggle('spectating', active);
  if (!active) { if (room.phase === 'results') scene?.followPlayer(null); return; }
  $('#race-status').hidden = true;
  const candidates = room.players.filter(p => p.id !== myId && p.connected && racers.some(r => r.id === p.id && !r.finished));
  if (watchId !== myId && !candidates.some(p => p.id === watchId)) watchId = candidates[0]?.id || myId;
  const options = [...candidates, { id: myId, name: '내 캐릭터' }];
  const key = options.map(p => p.id + p.name).join('|');
  if (key !== watchOptionsKey) {
    $('#spectator-select').innerHTML = options.map(p => '<option value="' + p.id + '">' + escapeHTML(p.name) + '</option>').join('');
    watchOptionsKey = key;
  }
  $('#spectator-select').value = watchId;
  $('#spectator-status').textContent = '완주! ' + (me.finishTime?.toFixed(2) || '') + '초 · ' + candidates.length + '명이 달리고 있어요';
  $('#spectator-prev').disabled = $('#spectator-next').disabled = !candidates.length;
  scene?.followPlayer(watchId);
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
    orderedResults = resultOrder(overall ? room.scores.map((r) => ({ ...r, status: 'finished', overall: true })) : room.results);
    revealStart = performance.now() - Math.max(0, Date.now() - (room.resultsAt || Date.now()));
    $('#result-title').textContent = overall ? `${room.settings.rounds}판의 승부, 최종 결과는?` : room.settings.matchMode === 'series' ? `${room.round} / ${room.settings.rounds} 라운드 결과` : '우리의 레이스, 그 결과는?';
    $('#result-subtitle').textContent = overall ? '누적 점수가 낮은 순위부터… 최종 우승자를 만나요!' : '미완주부터 차례차례… 마지막에 우승자를 만나요!';
    $('#results-list').style.setProperty('--columns', Math.min(orderedResults.length <= 12 ? 4 : 6, orderedResults.length));
    $('#results-list').style.setProperty('--rows', Math.max(1, Math.ceil(orderedResults.length / (orderedResults.length <= 12 ? 4 : 6))));
    $('#results-overlay').classList.toggle('crowded', orderedResults.length > 12);
    $('#spotlight-person').innerHTML = '<strong>누가 먼저 나올까?</strong>';
    $('#result-spotlight').classList.remove('winner');
    $('#results-list').innerHTML = orderedResults.map((r, i) => {
      const color = COLORS.find((c) => c.id === r.color) || COLORS[0];
      const character = CHARACTERS.find((c) => c.id === r.character) || CHARACTERS[0];
      let portrait;
      try { portrait = scene?.portrait(character.id, color.id); } catch (error) { console.error('캐릭터 사진 생성 오류', error); }
      const place = r.status === 'finished' ? `${r.rank}위` : '미완주';
      const tied = r.overall && orderedResults.filter((row) => row.rank === r.rank).length > 1;
      const score = room.scores?.find((row) => row.id === r.id)?.score || 0;
      const points = roundPoints(r, room.results.length);
      const caption = r.overall ? `${r.score}점 · ${r.completed}회 완주` : room.settings.matchMode === 'series' ? `+${points}점 · 누적 ${score}점` : r.status === 'finished' ? `${Number(r.time).toFixed(2)}초` : '다음엔 꼭 완주!';
      return `<article class="result-tile ${r.id === myId ? 'me' : ''} ${r.rank === 1 ? 'winner' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : ''}" role="listitem" aria-label="결과 공개 대기" data-index="${i}" style="--jelly-color:${color.hex};order:${orderedResults.length - i}"><div class="result-front" aria-hidden="true"><span class="tile-rank">${tied ? '공동 ' : ''}${place}</span>${r.id === myId ? '<span class="tile-me">나</span>' : ''}<div class="result-photo">${portrait ? `<img src="${portrait}" alt="${escapeHTML(character.name)} · ${escapeHTML(color.name)}" width="256" height="256">` : `<span class="portrait-fallback">${character.emoji}</span>`}</div><div class="tile-caption"><strong>${escapeHTML(r.name)}</strong><small>${caption}</small></div></div><div class="result-back" aria-hidden="true"><span>?</span><small>${tied ? '공동 ' : ''}${place}</small></div></article>`;
    }).join('');
    $('#results-list').scrollTop = 0;
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
    tile.setAttribute('aria-label', `${result.status === 'finished' ? `${result.rank}위` : '미완주'} ${result.name}${result.id === myId ? ', 나' : ''}`);
  }
  if (advanced) {
    const last = orderedResults[count - 1];
    $('#result-subtitle').textContent = `${last.status === 'finished' ? `${last.rank}위` : '미완주'} · ${last.name}${last.id === myId ? ' (나)' : ''}`;
    const currentTile = tiles[count - 1];
    $('#result-spotlight').classList.toggle('winner', last.rank === 1 && last.status === 'finished' && (!last.overall || last.score > 0));
    $('#spotlight-person').innerHTML = '<b class="spot-place">' + escapeHTML(currentTile.querySelector('.tile-rank').textContent) + '</b>' + currentTile.querySelector('.result-photo').innerHTML + '<strong>' + escapeHTML(last.name) + '</strong><p>' + escapeHTML(currentTile.querySelector('.tile-caption small').textContent) + '</p>';
    shownResults = count;
  }
  const done = count === total;
  $('#reveal-count').textContent = `${count} / ${total} 공개`;
  $('#reveal-bar').style.width = `${total ? count / total * 100 : 100}%`;
  $('#skip-results').hidden = done;
  $('#return-lobby').disabled = !done || room.hostId !== myId;
  const nextRound = room.settings.matchMode === 'series' && room.round < room.settings.rounds;
  $('#return-lobby').textContent = nextRound ? `${room.round + 1} 라운드 시작하기 →` : '대기실로 돌아가기 →';
  $('#results-help').textContent = !done ? '두근두근, 다음 젤리는 누구일까요?' : nextRound ? `점수가 누적됐어요. 방장이 다음 라운드를 시작할 수 있어요.` : room.hostId === myId ? '다른 맵에서 한 판 더 달려볼까요?' : '방장이 대기실로 돌아가면 함께 이동해요.';
  if (done) {
    clearInterval(resultsTimer);
    const winners = orderedResults.filter((r) => r.rank === 1 && r.status === 'finished' && (!r.overall || r.score > 0));
    const winner = winners[0];
    $('#result-title').textContent = winners.length > 1 ? `공동 우승! ${winner.name} 님 외 ${winners.length - 1}명` : winner ? `${winner.name} 님, ${winner.overall ? '최종 ' : nextRound ? `${room.round}라운드 ` : ''}우승!` : '다시 도전할 젤리, 모두 모여!';
    $('#result-subtitle').textContent = winner ? '넘어져도 다시 달린 모든 젤리에게 박수!' : '오늘의 도전도 멋졌어요. 다음엔 결승선까지!';

  }
}
$('#skip-results').addEventListener('click', () => { skipReveal = true; updateResultReveal(); });

function resetInput() { keys.clear(); queuedActions.jump = false; queuedActions.dive = false; Object.assign(touch, { x: 0, z: 0, jump: false, dive: false }); $('#joystick-knob').style.transform = ''; if (room) send({ type: 'input', ...touch }); }
const controlKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', (event) => { if (room && ['countdown', 'playing'].includes(room.phase) && controlKeys.has(event.code) && !document.querySelector('dialog[open]') && !['INPUT','SELECT'].includes(event.target.tagName) && !(event.target.tagName === 'BUTTON' && event.code === 'Space') && !$('#game-screen').classList.contains('spectating')) { event.preventDefault(); keys.add(event.code); if (!event.repeat && event.code === 'Space') queuedActions.jump = true; if (!event.repeat && event.code.startsWith('Shift')) queuedActions.dive = true; } });
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
setInterval(() => {
  if (!room || room.phase !== 'playing' || document.hidden || $('#game-screen').classList.contains('spectating')) return;
  const left = keys.has('KeyA') || keys.has('ArrowLeft'), right = keys.has('KeyD') || keys.has('ArrowRight');
  const forward = keys.has('KeyW') || keys.has('ArrowUp'), back = keys.has('KeyS') || keys.has('ArrowDown');
  send({ type: 'input', x: Math.max(-1, Math.min(1, Number(left) - Number(right) + touch.x)), z: Math.max(-1, Math.min(1, Number(forward) - Number(back) + touch.z)), jump: keys.has('Space') || touch.jump || queuedActions.jump, dive: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.dive || queuedActions.dive });
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
