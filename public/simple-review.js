import { GameScene } from './scene.js';
import { CHARACTERS, COLORS } from './catalog.js';
import { MAPS } from './world.js';

// 검토 전용 상태. 실제 방에 연결하거나 기존 프로필을 저장하지 않는다.
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  leaf: '<path d="M20 3C10 2 3 7 4 14c1 7 10 7 13 1 2-4 1-7 3-12Z"/><path d="m5 20 8-10"/>',
  back: '<path d="m14 6-6 6 6 6"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', invite: '<path d="m14 4 6 6-6 6M20 10H9a5 5 0 0 0-5 5v5"/>',
  shirt: '<path d="m8 4-5 4 3 4 2-2v10h8V10l2 2 3-4-5-4c0 3-8 3-8 0Z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 4c3 0 4 3 4 6"/>',
  shuffle: '<path d="M3 5h3c4 0 8 14 12 14h3m-5-4 5 4-5 3M3 19h3c2 0 3-2 5-6m3-5c2-3 3-3 7-3m-5-3 5 3-5 4"/>',
  gear: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  offline: '<path d="m3 3 18 18M5 9c4-4 10-4 14 0m-11 4c2-2 6-2 8 0M11 18h2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9c0-4 7-4 6 0-.5 2-3 2-3 5m0 3h.01"/>',
  door: '<path d="M10 3H4v18h6m5-14 5 5-5 5M9 12h11"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
let scene;
try {
  scene = new GameScene($('#portrait-canvas'));
  // 기존 사진 렌더러만 이용하므로 미리보기의 연속 렌더링은 중단한다.
  cancelAnimationFrame(scene.frame);
  scene.resizeObserver.disconnect();
} catch (error) { console.warn('시안의 3D 사진 대신 캐릭터 아이콘을 표시합니다.', error); }
function avatar(character, color, className = '') {
  if (scene) return `<img class="${className}" src="${scene.portrait(character, color)}" alt="${CHARACTERS.find(c => c.id === character)?.name || '젤리'}" width="256" height="256">`;
  return `<span class="avatar-fallback ${className}" role="img" aria-label="캐릭터">${CHARACTERS.find(c => c.id === character)?.emoji || '🫘'}</span>`;
}
const me = { id: 'me', name: '민트', character: 'frog', color: 'mint', state: 'waiting', connected: true };
let view = 'home', role = 'guest', entryMode = 'invite', sheet = null, focusBeforeSheet, toastTimer;
let settings = { map: 'random', mode: 'single', rounds: '3', characters: 'choice', duration: '180' };
let people = [], sampleCount = 6;
const initial = [
  { name: '현승쌤', character: 'bear', color: 'orange', state: 'host' },
  { name: '도토리', character: 'cat', color: 'yellow', state: 'ready' },
  { name: '토토', character: 'bunny', color: 'coral', state: 'choosing' },
  { name: '바다', character: 'shark', color: 'blue', state: 'waiting' },
  { name: '민트', character: 'frog', color: 'mint', state: 'waiting', connected: false },
];
function resetPeople(count = 6) {
  sampleCount = count;
  people = Array.from({ length: count - 1 }, (_, index) => {
    const data = initial[index] || { name: ['구름', '콩이', '나무', '레몬', '모찌', '달콩'][index % 6] + (Math.floor(index / 6) + 1), character: CHARACTERS[(index + 2) % 30].id, color: COLORS[index % COLORS.length].id, state: 'ready' };
    return { id: `p${index}`, connected: true, ...data, ...(role === 'host' && index === 0 ? { name: '초코', state: 'ready' } : {}), ...(role === 'host' && data.connected === false ? { name: me.name, character: me.character, color: me.color } : {}) };
  });
}
resetPeople();
const status = player => {
  const state = !player.connected ? 'offline' : player.state;
  const [text, symbol] = { waiting: ['대기 중', 'clock'], choosing: ['캐릭터 고르는 중', 'shirt'], ready: ['준비 완료', 'check'], host: ['방장', 'leaf'], offline: ['연결 끊김', 'offline'] }[state];
  return `<span class="status ${state}">${icon(symbol)}${text}</span>`;
};
function showToast(text) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2800);
}
function header(title = '', back = '', trailing = '') {
  return `<header class="app-top"><div class="brand-wrap">${back ? `<button class="icon-button" data-action="${back}" aria-label="뒤로 가기">${icon('back')}</button>` : ''}<span class="app-brand"><i>${icon('leaf')}</i>캠프 젤리</span>${title ? `<span class="top-title">${title}</span>` : ''}</div>${trailing || `<button class="nav-button" data-action="help">${icon('help')}게임 방법</button>`}</header>`;
}
function home() {
  return `${header()}<main class="app-scroll"><section class="home-view"><div class="home-copy"><span class="mini-label">우리끼리 우당탕 레이스</span><h1>친구랑 모여,<br><em>한 판 달려!</em></h1><p>넘어져도 웃긴 우리들의 레이스.</p><div class="home-actions"><button class="primary" data-action="create">방 만들기 ${icon('arrow')}</button><button class="secondary" data-action="join">코드로 입장</button></div><div class="home-facts"><span>최대 <strong>30</strong>명</span><span>맵 <strong>12</strong>개</span><span>캐릭터 <strong>30</strong>종</span></div></div><div class="hero-art" aria-label="숲속 캠프의 게임 캐릭터 세 친구"><span class="board-heading">CAMP JELLY</span><span class="disc"></span>${avatar('frog', 'mint')}${avatar('cat', 'yellow', 'side-left')}${avatar('bunny', 'coral', 'side-right')}<span class="chalk-star">☀</span><span class="chalk-trail"></span><span class="board-tag">너만 오면 시작!</span></div></section></main>`;
}
function nameEntry() {
  const create = entryMode === 'create', code = entryMode === 'code';
  return `${header(create ? '방 만들기' : '친구 방 입장', 'home')}<main class="app-scroll"><section class="name-view"><div class="name-intro"><span class="invited">${icon(create ? 'leaf' : 'invite')}${create ? '새로운 캠프' : code ? '친구 방 입장' : '현승쌤의 방'}</span><h1 class="page-title">반가워요!<br>이름을 알려줘요.</h1><div class="name-art">${avatar(me.character, me.color)}</div></div><div class="entry-card"><form id="entry-form" class="entry-form">${code ? '<label for="invite-code">초대 코드</label><input id="invite-code" name="code" placeholder="예: JELLY6" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" required>' : ''}<label for="nickname">내 이름</label><input id="nickname" name="name" value="${escape(me.name)}" placeholder="친구가 알아볼 이름" maxlength="16" autocomplete="nickname" required><div class="field-row"><span id="name-count">${me.name.length}/16</span></div><p id="name-error" class="form-error" role="status"></p><button class="primary" type="submit">${create ? '방 만들기' : '입장하기'} ${icon('arrow')}</button></form></div></section></main>`;
}
const modeLabel = () => settings.mode === 'single' ? '한 판 승부' : `${settings.rounds}판 점수전`;
const mapLabel = () => settings.map === 'random' ? '랜덤 맵' : MAPS.find(m => m.id === settings.map)?.name;
const unready = () => people.filter(p => p.state !== 'host' && (!p.connected || p.state !== 'ready'));
function friendCard(player) {
  return `<article class="friend-card ${!player.connected ? 'disconnected' : ''} ${role === 'host' ? 'has-manage' : ''}">${avatar(player.character, player.color)}<div class="friend-info"><b class="friend-name" title="${escape(player.name)}">${escape(player.name)}</b>${status(player)}${!player.connected ? '<span class="friend-tag">30초 전 끊김</span>' : ''}</div>${role === 'host' ? `<button class="manage" data-manage="${player.id}" aria-label="${escape(player.name)} 참가자 관리${!player.connected ? ', 연결 끊김' : ''}"></button>` : ''}</article>`;
}
function lobby() {
  const host = role === 'host', ready = me.state === 'ready', pending = unready();
  const total = people.length + 1, readyCount = people.filter(p => p.connected && (p.state === 'ready' || p.state === 'host')).length + (host || ready ? 1 : 0);
  const disconnected = people.filter(p => !p.connected).length;
  return `${header('', '', `<button class="icon-button" data-action="leave" aria-label="방 나가기">${icon('door')}</button>`)}<main class="app-scroll"><div class="lobby-heading"><div><h1>대기실</h1><p>${host ? '내가 연 캠프' : '현승쌤의 캠프'} · <b>JELLY6</b></p></div><button class="invite-button" data-action="invite">${icon('invite')}초대</button></div><div class="lobby-grid"><section class="my-section" aria-label="내 캐릭터와 경기 정보"><article class="self-card">${avatar(me.character, me.color)}<div class="self-info"><span class="you">${host ? '나 · 방장' : '나'}</span><div class="self-name">${escape(me.name)}</div>${status(host ? { ...me, state: 'host' } : me)}<button class="edit-character" data-action="closet">${icon('shirt')}캐릭터 · 색상 ${icon('back').replace('viewBox', 'style="transform:rotate(180deg)" viewBox')}</button></div></article><button class="course-summary" data-action="${host ? 'settings' : 'details'}"><span class="course-icon">${icon(settings.map === 'random' ? 'shuffle' : 'leaf')}</span><span class="course-info"><b>${escape(mapLabel())}</b><small>${modeLabel()} · ${Number(settings.duration) / 60}분</small></span>${icon(host ? 'gear' : 'help')}</button></section><section class="friends-section"><div class="friends-heading"><h2>참가자 <span>${total}/30</span></h2><span>${readyCount}명 준비</span></div><div class="friends-grid">${people.map(friendCard).join('')}${total < 30 ? `<button class="empty-slot" data-action="invite">${icon('plus')}친구 초대</button>` : ''}</div></section></div></main><footer class="app-footer"><p class="footer-hint">${host ? pending.length ? `${pending.length - disconnected}명 준비 전${disconnected ? ` · <strong>${disconnected}명 연결 끊김</strong>` : ''}` : '<strong>모두 준비됐어요. 출발할까요?</strong>' : ready ? '방장의 시작을 기다려요.' : '준비를 눌러주세요.'}</p><div class="ready-footer"><button class="primary ${ready && !host ? 'ready-cancel' : 'lime'}" data-action="${host ? 'start' : 'ready'}" ${host && pending.length ? 'disabled' : ''}>${icon(host ? 'arrow' : 'check')}${host ? '시작하기' : ready ? '준비 완료 · 취소' : '준비 완료'}</button></div></footer>`;
}
function closet() {
  const character = CHARACTERS.find(c => c.id === me.character), color = COLORS.find(c => c.id === me.color), random = settings.characters === 'random';
  return `${header('캐릭터 선택', 'close-closet')}<main class="app-scroll"><div class="closet-heading"><h1>캐릭터 고르기</h1>${status(me)}</div><div class="closet-layout"><section class="closet-preview" aria-label="선택한 모습"><div class="closet-art">${avatar(me.character, me.color)}</div><div class="closet-name">${character.name}<span>${color.name}</span></div><div class="color-grid" role="group" aria-label="색상 고르기">${COLORS.map(c => `<button class="color-button" data-color="${c.id}" aria-label="${c.name}" aria-pressed="${me.color === c.id}" style="--swatch:${c.hex}"><i>${c.id === me.color ? icon('check') : ''}</i></button>`).join('')}</div>${random ? '<p class="random-note">랜덤 캐릭터 · 색상은 자유롭게</p>' : ''}</section><section><div class="characters-label"><b>캐릭터</b><span>30종</span></div><div class="character-grid">${CHARACTERS.map(c => `<button class="character-tile" data-character="${c.id}" aria-label="${c.name} 캐릭터" aria-pressed="${me.character === c.id}" ${random ? 'disabled' : ''}>${avatar(c.id, me.color)}<span>${c.name}</span></button>`).join('')}</div></section></div></main><footer class="app-footer"><p class="footer-hint">선택 후 준비를 눌러주세요.</p><button class="primary lime" data-action="close-closet">선택 완료 ${icon('check')}</button></footer>`;
}
function render(preserve = false) {
  const scroll = $('.character-grid')?.scrollTop || $('.friends-grid')?.scrollTop || 0;
  const previousFocus = document.activeElement;
  const focusKey = previousFocus?.dataset.color ? `[data-color="${previousFocus.dataset.color}"]` : previousFocus?.dataset.character ? `[data-character="${previousFocus.dataset.character}"]` : previousFocus?.dataset.action === 'ready' ? '[data-action="ready"]' : null;
  $('#app').innerHTML = ({ home, name: nameEntry, lobby, closet }[view])();
  $('#app').dataset.view = view;
  const list = $('.character-grid') || $('.friends-grid');
  if (list) list.scrollTop = preserve ? scroll : 0;
  if (preserve && focusKey) $(focusKey)?.focus({ preventScroll: true });
  const step = view === 'lobby' && role === 'host' ? 'host' : view;
  document.querySelectorAll('[data-step]').forEach(button => button.toggleAttribute('aria-current', false));
  $(`[data-step="${step}"]`).setAttribute('aria-current', 'step');
  $('.demo-tools').hidden = !['lobby', 'closet'].includes(view);
  $('#demo-ready').hidden = role !== 'host';
  document.querySelectorAll('[data-count]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.count) === sampleCount));
  if (view === 'name') $('#entry-form').addEventListener('submit', enter);
  history.replaceState(null, '', `${location.pathname}?screen=${step}`);
}
function go(next) { closeSheet(); view = next; $('#toast').hidden = true; render(); window.scrollTo(0, 0); }
function jump(step) {
  role = step === 'host' ? 'host' : 'guest';
  Object.assign(me, { name: role === 'host' ? '현승쌤' : '민트', character: role === 'host' ? 'bear' : 'frog', color: role === 'host' ? 'orange' : 'mint', state: step === 'closet' ? 'choosing' : 'waiting' });
  settings = { map: 'random', mode: 'single', rounds: '3', characters: 'choice', duration: '180' };
  resetPeople(); entryMode = 'invite'; go(step === 'host' ? 'lobby' : step);
}
function enter(event) {
  event.preventDefault(); const name = $('#nickname').value.trim();
  if (!name) { $('#name-error').textContent = '이름을 입력해 주세요.'; $('#nickname').focus(); return; }
  me.name = name; me.state = 'waiting'; role = entryMode === 'create' ? 'host' : 'guest';
  resetPeople(); go('lobby'); showToast(role === 'host' ? '캠프가 열렸어요. 친구들을 초대해요!' : `${name}님, 반가워요!`);
}
function closeSheet() {
  if (!sheet) return;
  $('#app').inert = false; $('#sheet-root').innerHTML = ''; sheet = null;
  if (focusBeforeSheet?.isConnected) focusBeforeSheet.focus({ preventScroll: true });
}
function openSheet(kind, player = null) {
  if (!sheet) focusBeforeSheet = document.activeElement;
  sheet = { kind, player };
  let title, body, actions;
  if (kind === 'settings') {
    title = '이번엔 어떻게 놀까?';
    body = `<label class="setting-field" for="map-setting">달릴 맵</label><select id="map-setting"><option value="random" ${settings.map === 'random' ? 'selected' : ''}>랜덤으로 고르기</option>${MAPS.map(m => `<option value="${m.id}" ${settings.map === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select><span class="setting-field">경기 방식</span><div class="segmented" role="group" aria-label="경기 방식"><button data-mode="single" aria-pressed="${settings.mode === 'single'}">한 판 승부</button><button data-mode="series" aria-pressed="${settings.mode === 'series'}">여러 판 점수전</button></div><div id="round-field" ${settings.mode === 'single' ? 'hidden' : ''}><label class="setting-field" for="round-setting">몇 판을 할까요?</label><select id="round-setting">${['3', '5', '7'].map(n => `<option value="${n}" ${settings.rounds === n ? 'selected' : ''}>${n}판</option>`).join('')}</select></div><label class="setting-field" for="character-setting">캐릭터</label><select id="character-setting"><option value="choice" ${settings.characters === 'choice' ? 'selected' : ''}>각자 고르기</option><option value="random" ${settings.characters === 'random' ? 'selected' : ''}>랜덤 배정</option></select><label class="setting-field" for="duration-setting">한 판 시간</label><select id="duration-setting">${[120,180,240,300].map(n => `<option value="${n}" ${settings.duration === String(n) ? 'selected' : ''}>${n / 60}분</option>`).join('')}</select><p class="setting-help">설정을 바꾸면 모두 다시 준비해야 해요.</p>`;
    actions = '<button class="primary" data-action="save-settings">설정 완료</button>';
  } else if (kind === 'manage') {
    title = '참가자 관리';
    body = `<div class="manage-profile">${avatar(player.character, player.color)}<div><b>${escape(player.name)}</b>${status(player)}<small>${!player.connected ? '30초 전 연결이 끊겼어요' : '현재 방에 접속해 있어요'}</small></div></div><p><strong>${escape(player.name)}</strong>님을 방에서 내보낼까요?</p>`;
    actions = '<button class="danger-button" data-action="kick">이 참가자 강퇴하기</button><button class="secondary" data-action="close-sheet">취소</button>';
  } else if (kind === 'invite') {
    title = '친구야, 여기로 와!';
    body = `<p>링크를 보내 친구를 초대하세요.</p><div class="code-box"><span>우리 방 코드</span><strong>JELLY6</strong></div><p class="setting-help">시안용 초대 링크로 이름 입력 화면을 체험해요.</p>`;
    actions = '<button class="primary" data-action="copy-invite">초대 링크 복사</button><button class="secondary" data-action="try-invite">초대받은 화면 보기</button>';
  } else if (kind === 'leave') {
    title = '캠프에서 나갈까요?'; body = '<p>다시 들어오려면 초대 링크나<br>방 코드가 필요해요.</p>';
    actions = '<button class="primary" data-action="confirm-leave">방 나가기</button><button class="secondary" data-action="close-sheet">계속 기다리기</button>';
  } else if (kind === 'start') {
    title = '다 모였어. 출발하자!'; body = `${avatar(me.character, me.color, 'end-art')}<p>다음은 코스 안내와 카운트다운이에요.<br>이번 시안은 경기 시작 전까지 체험해요.</p>`;
    actions = '<button class="primary" data-action="close-sheet">대기실 다시 보기</button>';
  } else if (kind === 'details') {
    title = '오늘의 레이스'; body = `<div class="sheet-list"><div>${icon('leaf')}<p><strong>${escape(mapLabel())}</strong><br>${settings.map === 'random' ? '시작할 때 코스를 골라요.' : '방장이 고른 코스로 출발해요.'}</p></div><div>${icon('clock')}<p><strong>${modeLabel()} · 한 판 ${Number(settings.duration) / 60}분</strong><br>${settings.mode === 'single' ? '완주 순위로 승부해요.' : '각 판의 점수를 합쳐 최종 순위를 정해요.'}</p></div><div>${icon('shirt')}<p><strong>${settings.characters === 'random' ? '캐릭터 랜덤 배정' : '캐릭터 각자 선택'}</strong><br>색상은 자유롭게 바꿀 수 있어요.</p></div></div>`; actions = '<button class="primary" data-action="close-sheet">알겠어요</button>';
  } else {
    title = '이렇게 놀면 돼요'; body = '<div class="sheet-list"><div><b>1</b><p><strong>방을 만들고 친구 초대</strong><br>링크를 열고 이름만 입력해요.</p></div><div><b>2</b><p><strong>내 모습을 고르고 준비 완료</strong><br>방장이 시작하면 함께 출발해요.</p></div><div><b>3</b><p><strong>넘어져도, 다시 달리기</strong><br>결승선까지 가면 성공!</p></div></div>'; actions = '<button class="primary" data-action="close-sheet">좋아, 해보자!</button>';
  }
  $('#sheet-root').innerHTML = `<div class="sheet-shade"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="sheet-heading"><h2 id="sheet-title">${title}</h2><button class="icon-button" data-action="close-sheet" aria-label="닫기">${icon('close')}</button></div>${body}<div class="sheet-actions">${actions}</div></section></div>`;
  $('#app').inert = true; $('.sheet').focus({ preventScroll: true });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) { if (event.target.classList.contains('sheet-shade')) closeSheet(); return; }
  if (button.dataset.step) return jump(button.dataset.step);
  if (button.dataset.count) { resetPeople(Number(button.dataset.count)); return render(true); }
  if (button.id === 'demo-ready') { people.forEach(p => { p.connected = true; if (p.state !== 'host') p.state = 'ready'; }); render(true); return showToast('시안 속 친구들이 모두 준비했어요.'); }
  if (button.dataset.color) { me.color = button.dataset.color; return render(true); }
  if (button.dataset.character) { me.character = button.dataset.character; return render(true); }
  if (button.dataset.manage && role === 'host') return openSheet('manage', people.find(p => p.id === button.dataset.manage));
  if (button.dataset.mode) { document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b === button)); $('#round-field').hidden = button.dataset.mode === 'single'; return; }
  switch (button.dataset.action) {
    case 'home': return go('home');
    case 'create': entryMode = 'create'; return go('name');
    case 'join': entryMode = 'code'; return go('name');
    case 'closet': me.state = 'choosing'; return go('closet');
    case 'close-closet': me.state = 'waiting'; return go('lobby');
    case 'ready': me.state = me.state === 'ready' ? 'waiting' : 'ready'; return render(true);
    case 'close-sheet': return closeSheet();
    case 'help': case 'invite': case 'settings': case 'details': case 'leave': return openSheet(button.dataset.action);
    case 'start': if (role === 'host' && !unready().length) openSheet('start'); return;
    case 'confirm-leave': me.state = 'waiting'; return go('home');
    case 'try-invite': entryMode = 'invite'; role = 'guest'; return go('name');
    case 'copy-invite': {
      const link = new URL(location.pathname, location.origin); link.search = '?screen=name';
      try { await navigator.clipboard.writeText(link.href); showToast('시안 초대 링크를 복사했어요.'); } catch { showToast('복사가 제한되어 있어요. 초대받은 화면 보기로 확인해 주세요.'); } return;
    }
    case 'kick': {
      if (role !== 'host' || !sheet?.player) return;
      const removed = sheet.player; people = people.filter(p => p.id !== removed.id);
      closeSheet(); render(true); showToast(`${removed.name}님을 내보냈어요.`); return;
    }
    case 'save-settings': {
      const next = { map: $('#map-setting').value, mode: $('[data-mode][aria-pressed=true]').dataset.mode, rounds: $('#round-setting').value, characters: $('#character-setting').value, duration: $('#duration-setting').value };
      const changed = JSON.stringify(settings) !== JSON.stringify(next); settings = next;
      if (changed) { me.state = 'waiting'; people.forEach(p => { if (p.state !== 'host') p.state = 'waiting'; }); }
      closeSheet(); render(true); showToast(changed ? '설정을 바꿨어요. 친구들이 다시 준비하면 출발해요.' : '설정을 확인했어요.'); return;
    }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'nickname') { $('#name-count').textContent = `${event.target.value.length}/16`; $('#name-error').textContent = ''; }
  if (event.target.id === 'invite-code') event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (sheet) closeSheet(); else if (view === 'closet') { me.state = 'waiting'; go('lobby'); } }
  if (event.key !== 'Tab' || !sheet) return;
  const focusable = [...$('.sheet').querySelectorAll('button:not(:disabled),select,input,a[href]')].filter(el => el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === $('.sheet'))) { last.focus(); event.preventDefault(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === $('.sheet'))) { first.focus(); event.preventDefault(); }
});
const params = new URLSearchParams(location.search);
jump(['home', 'name', 'lobby', 'closet', 'host'].includes(params.get('screen')) ? params.get('screen') : 'home');
