// 실제 HTTP·WebSocket 서버 테스트에서 함께 쓰는 도구입니다. 고정 시간 대기 대신 메시지와 조건을 기다립니다.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { StateDecoder } from '../public/network.js';

export async function setup(t, options = {}) {
  const app = createGameServer({ countdownMs: 20, reconnectGraceMs: 1_000, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}

export function socketUrl(url, compact = true) {
  return url.replace('http:', 'ws:') + (compact ? '/?v=2' : '');
}

export async function client(url, compact = true, options = {}) {
  const socket = new WebSocket(socketUrl(url, compact), options);
  const decoder = new StateDecoder();
  const messages = [];
  const waiters = new Set();
  socket.on('error', () => {});
  socket.on('message', (raw, isBinary) => {
    const message = isBinary ? decoder.decode(raw) : JSON.parse(raw);
    if (!message) return;
    if (message.type === 'room') decoder.setRoom(message.room);
    messages.push(message);
    for (const check of [...waiters]) check();
  });
  await once(socket, 'open');
  return {
    socket, messages,
    send: (message) => socket.send(JSON.stringify(message)),
    wait(predicate, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error('메시지 대기 시간 초과')); }, timeoutMs);
        function check() {
          const index = messages.findIndex(predicate);
          if (index < 0) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(messages.splice(index, 1)[0]);
        }
        waiters.add(check);
        check();
      });
    },
  };
}

// 연결이 수립되기 전에 거절되면 HTTP 상태 코드를, 연결되면 'open'을 돌려줍니다.
export function attempt(url, options = {}, compact = true) {
  return new Promise((resolve) => {
    const socket = new WebSocket(socketUrl(url, compact), options);
    socket.on('unexpected-response', (request, response) => { resolve(response.statusCode); socket.terminate(); });
    socket.on('open', () => { resolve('open'); socket.terminate(); });
    socket.on('error', () => resolve('error'));
  });
}

export const roomWhere = (condition) => (message) => message.type === 'room' && condition(message.room);
export const ofType = (type) => (message) => message.type === type;

export async function prepareRoom(clients, host, total) {
  for (const member of clients) member.send({ type: 'ready', ready: true });
  await host.wait(roomWhere((r) => r.players.length === total && r.players.every((p) => p.id === r.hostId || p.ready)));
}

// 같은 소켓의 요청은 순서대로 처리됩니다. 알 수 없는 요청의 오류 응답이 오면 앞선 요청도 모두 처리된 것입니다.
export async function barrier(member) {
  member.send({ type: '__barrier__' });
  await member.wait((m) => m.type === 'error' && /지원하지|먼저 방을|너무 잦아요/.test(m.message));
}

export async function waitFor(condition, label = '조건', timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${label} 대기 시간 초과`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
