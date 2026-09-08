import { GameScene } from './scene.js';
import { CHARACTERS, COLORS } from './catalog.js';
import { resultOrder, revealDelay } from './results.js';

// 결과 배치와 연출만 비교하는 예시 화면입니다. 실제 방에는 접속하지 않습니다.
const $ = selector => document.querySelector(selector);
const concepts = {
  podium: ['숲속 시상대', '아래 카드는 꼴찌부터 왼쪽 → 오른쪽. 마지막 세 자리는 시상대로.'],
  trail: ['정상으로 가는 길', '왼쪽 아래에서 출발해 숲길을 따라 올라가요. 오른쪽 위가 1위.'],
  spotlight: ['오늘의 주인공', '높은 순위는 위쪽에. 아래의 꼴찌부터 올라가며 공개하고, 마지막은 1위.'],
};
let scene;
try {
  scene = new GameScene($('#portrait-canvas'));
  cancelAnimationFrame(scene.frame);
  scene.resizeObserver.disconnect();
} catch (error) { console.warn('캐릭터 사진 대신 아이콘을 표시합니다.', error); }
const names = ['도토리','현승쌤','토토','바다','초코','구름','민트','콩이','모찌','나무','달콩','레몬','소나무','밤톨','산들','단풍','자몽','이슬','솔방울','새싹','단비','버찌','오디','두리','호두','하늘','보리','루루','여름','겨울'];
let design = Object.hasOwn(concepts, new URLSearchParams(location.search).get('design')) ? new URLSearchParams(location.search).get('design') : 'podium';
const requestedCount = Number(new URLSearchParams(location.search).get('count'));
let total = [12,26,30].includes(requestedCount) ? requestedCount : 12;
let rows = [], order = [], cursor = 0, timer, paused = false;
function portrait(row) {
  return scene ? `<img src="${scene.portrait(row.character,row.color)}" alt="${CHARACTERS.find(c=>c.id===row.character).name}" width="256" height="256">` : `<span class="fallback">${CHARACTERS.find(c=>c.id===row.character).emoji}</span>`;
}
function card(row, extra = '') {
  return `<article class="rank-card ${extra} ${row.rank===7?'is-me':''}" data-rank="${row.rank}" aria-label="${row.rank}위 · 아직 공개 전"><div class="card-back"><span>${row.rank}위</span><b>♧</b></div><div class="card-front" aria-hidden="true"><b class="rank-number">${row.rank}<small>위</small></b>${portrait(row)}<strong>${row.name}${row.rank===7?'<i>나</i>':''}</strong><span class="record">${row.time.toFixed(2)}초</span></div></article>`;
}
function build() {
  clearTimeout(timer); paused = false; cursor = 0;
  rows = Array.from({length:total},(_,i)=>({id:`p${i}`,rank:i+1,name:names[i],character:CHARACTERS[(i*7+1)%30].id,color:COLORS[(i*3+3)%COLORS.length].id,status:'finished',time:42.35+i*1.73}));
  order = resultOrder(rows);
  $('.result-stage').dataset.design = design;
  $('.result-stage').classList.toggle('crowded',total>12);
  $('#headline').textContent=concepts[design][0]; $('#concept-note').textContent=concepts[design][1]; $('#player-count').textContent=total;
  $('[data-design="'+design+'"]').focus({preventScroll:true});
  document.querySelectorAll('[data-design]').forEach(el=>{if(el.tagName==='BUTTON')el.setAttribute('aria-pressed',el.dataset.design===design)});
  document.querySelectorAll('[data-count]').forEach(el=>el.setAttribute('aria-pressed',Number(el.dataset.count)===total));
  if(design==='podium') {
    $('#board').innerHTML=`<div class="podium"><div class="podium-place second">${card(rows[1])}<span>2</span></div><div class="podium-place first"><span class="crown" aria-hidden="true">♛</span>${card(rows[0])}<span>1</span></div><div class="podium-place third">${card(rows[2])}<span>3</span></div></div><div class="gallery-heading"><span>함께 달린 친구들</span><span>${total}위 → 4위</span></div><div class="photo-grid">${order.filter(r=>r.rank>3).map(r=>card(r)).join('')}</div>`;
  } else if(design==='trail') {
    const columns=total===12?4:6, levels=Math.ceil(total/columns);
    // 아래 왼쪽에서 지그재그로 올라가므로 꼴찌가 화면 오른쪽 아래에 고정되지 않습니다.
    $('#board').innerHTML=`<div class="trail-label"><span>↑ 정상으로 한 걸음씩</span><b>1위 · 정상 ⚑</b></div><div class="trail-map">${Array.from({length:levels},(_,top)=>{
      const bottom=levels-1-top, group=order.slice(bottom*columns,(bottom+1)*columns);
      if(bottom%2===1)group.reverse();
      return `<div class="trail-row ${bottom%2?'leftward':'rightward'}" style="--level:${top};--start-column:${bottom%2?1:columns-group.length+1}">${group.map(r=>card(r)).join('')}</div>`;
    }).join('')}</div><span class="trail-start">${total}위 · 여기서 공개 시작 ↗</span>`;
  } else {
    // 자리는 1위부터 고정하고, 공개 순서만 꼴찌부터 역순으로 진행합니다.
    $('#board').innerHTML=`<div class="spotlight"><span class="spot-label">이번 레이스의 주인공</span><div id="spot-person"><span class="spot-mystery">♧</span><h2>누가 먼저 나올까?</h2></div></div><section class="album"><div class="gallery-heading"><span>우리의 완주 사진</span><span>↑ 높은 순위</span></div><div class="photo-grid">${rows.map(r=>card(r)).join('')}</div></section>`;
  }
  $('#announcement').textContent='꼴찌부터, 한 명씩 만나볼까요?'; $('#my-result').textContent='내 결과를 기다리는 중';
  $('#progress').textContent=`0 / ${total}`; $('#pause').disabled=true; $('#pause').textContent='일시정지';
  history.replaceState(null,'',`${location.pathname}?design=${design}&count=${total}`);
}
function reveal(row, animate=true) {
  const tile=$(`[data-rank="${row.rank}"]`);
  tile.classList.add('revealed'); if(!animate)tile.classList.add('instant');
  tile.setAttribute('aria-label',`${row.rank}위 ${row.name}, ${row.time.toFixed(2)}초`);
  tile.querySelector('.card-back').setAttribute('aria-hidden','true');tile.querySelector('.card-front').removeAttribute('aria-hidden');
  document.querySelector('.just-revealed')?.classList.remove('just-revealed');tile.classList.add('just-revealed');
  if(design==='spotlight') {
    $('.spotlight').classList.toggle('winner',row.rank===1);
    $('#spot-person').innerHTML=`<span class="spot-rank">${row.rank===1?'♛ ':''}${row.rank}<small>위</small></span>${portrait(row)}<h2>${row.name}${row.rank===7?' · 나':''}</h2><p>${row.time.toFixed(2)}초</p>`;
  }
  if(row.rank===7)$('#my-result').textContent=`내 결과 · 7위 민트 · ${row.time.toFixed(2)}초`;
  $('#announcement').textContent=row.rank===1?`오늘의 1위, ${row.name}!`:row.rank===2?'이제 마지막 한 명!':`${row.rank}위 · ${row.name}`;
}
function next() {
  if(cursor>=total)return;
  reveal(order[cursor++]); $('#progress').textContent=`${cursor} / ${total}`;
  if(cursor===total){$('#pause').disabled=true;return;}
  timer=setTimeout(next,revealDelay(cursor,total)-revealDelay(cursor-1,total));
}
function replay(){build();$('#pause').disabled=false;timer=setTimeout(next,650);}
document.querySelectorAll('[data-design]').forEach(button=>{if(button.tagName==='BUTTON')button.addEventListener('click',()=>{design=button.dataset.design;replay()})});
document.querySelectorAll('[data-count]').forEach(button=>button.addEventListener('click',()=>{total=Number(button.dataset.count);replay()}));
$('#replay').addEventListener('click',replay);
$('#pause').addEventListener('click',()=>{paused=!paused;clearTimeout(timer);$('#pause').textContent=paused?'계속 보기':'일시정지';if(!paused)timer=setTimeout(next,400)});
$('#reveal-all').addEventListener('click',()=>{clearTimeout(timer);while(cursor<total)reveal(order[cursor++],false);$('#progress').textContent=`${total} / ${total}`;$('#pause').disabled=true});
$('#lobby').addEventListener('click',()=>{location.href='/simple-review.html?screen=lobby'});
replay();
