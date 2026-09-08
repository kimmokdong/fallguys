export const CHARACTERS = [
  ['bean', '젤리', '🫘'], ['cat', '야옹', '🐱'], ['bunny', '토토', '🐰'],
  ['bear', '곰곰', '🐻'], ['fox', '여우비', '🦊'], ['panda', '판다', '🐼'],
  ['frog', '개굴', '🐸'], ['penguin', '펭펭', '🐧'], ['chick', '삐약', '🐥'],
  ['dino', '디노', '🦖'], ['shark', '샤크', '🦈'], ['unicorn', '유니', '🦄'],
  ['robot', '로보', '🤖'], ['astronaut', '코스모', '🧑‍🚀'], ['alien', '우주콩', '👽'],
  ['ninja', '닌자', '🥷'], ['pirate', '해적콩', '🏴‍☠️'], ['wizard', '위즈', '🧙'],
  ['king', '킹젤리', '👑'], ['knight', '기사콩', '🛡️'], ['chef', '셰프', '🧑‍🍳'],
  ['mushroom', '버섯이', '🍄'], ['cactus', '선인콩', '🌵'], ['strawberry', '딸기', '🍓'],
  ['pineapple', '파인이', '🍍'], ['bee', '붕붕', '🐝'], ['butterfly', '나비', '🦋'],
  ['devil', '꼬마악마', '😈'], ['angel', '엔젤', '😇'], ['snowman', '눈사람', '⛄'],
].map(([id, name, emoji]) => ({ id, kind: id, name, emoji }));

export const COLORS = [
  { id: 'coral', hex: '#ff718b', name: '딸기 분홍' },
  { id: 'blue', hex: '#598dff', name: '소다 파랑' },
  { id: 'mint', hex: '#61dfba', name: '민트 초록' },
  { id: 'yellow', hex: '#ffcf54', name: '레몬 노랑' },
  { id: 'purple', hex: '#aa85f5', name: '포도 보라' },
  { id: 'orange', hex: '#ff9b51', name: '망고 주황' },
  { id: 'white', hex: '#ecf4fc', name: '우유 하양' },
  { id: 'navy', hex: '#586481', name: '밤하늘 남색' },
];
