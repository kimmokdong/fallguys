// 화면에 필요한 상태만 전송합니다. 서버의 물리 계산 값은 변경하지 않습니다.
const HEADER = 16, PLAYER = 38, TILE = 6;
const packedFrames=new WeakMap();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = n => Number.isFinite(n) ? n : 0;
const same = (a, b) => a && a.every((value, i) => value === b[i]);
export function packPlayer(p) {
  const bytes = new Uint8Array(PLAYER), v = new DataView(bytes.buffer);
  v.setUint8(0, p.netId);
  v.setUint8(1, Number(!!p.grounded) | Number(!!p.finished) << 1 | Number(!!p.eliminated) << 2);
  ['x','y','z'].forEach((key,i) => v.setFloat32(2+i*4, Math.round(finite(p[key])*100)/100, true));
  ['vx','vy','vz'].forEach((key,i) => v.setInt16(14+i*2, clamp(Math.round(finite(p[key])*100),-32768,32767), true));
  v.setInt16(20, Math.round(Math.atan2(Math.sin(finite(p.yaw)),Math.cos(finite(p.yaw)))*10000), true);
  v.setUint16(22, Math.round(clamp(finite(p.progress),0,1)*65535), true);
  ['diveCooldown','bumpTime','hitCooldown'].forEach((key,i)=>v.setUint8(24+i,clamp(Math.round(finite(p[key])*100),0,255)));
  v.setInt8(27, clamp(p.checkpoint ?? -1,-128,127));
  ['jumpCount','landCount','fallCount'].forEach((key,i)=>v.setUint16(28+i*2,finite(p[key]) & 65535,true));
  v.setUint32(34, Math.round(Math.max(0,finite(p.finishTime))*1000),true);
  return bytes;
}

export class StateEncoder {
  constructor() { this.previous=new Map(); this.sentAt=new Map(); this.collapsed={}; this.epoch=null; this.lastFull=-Infinity; this.lastPacket=-Infinity; }
  encode(state, focusId, { now=Date.now(), full=false, hidden=false }={}) {
    full ||= this.epoch!==state.epoch || now-this.lastFull>=2000;
    if(hidden && !full && now-this.lastPacket<333) return null;
    const focus=state.players.find(p=>p.id===focusId && !p.eliminated) || state.players.find(p=>!p.finished && !p.eliminated);
    let packed=packedFrames.get(state);
    if(!packed) {packed=state.players.map(packPlayer);packedFrames.set(state,packed);}
    const updates=[];
    for(const [i,p] of state.players.entries()) {
      const bytes=packed[i], previous=this.previous.get(p.netId);
      // 완주·탈락·낙하 복귀는 거리에 관계없이 즉시 반영합니다.
      const critical=!previous || bytes[1]!==previous[1] || bytes[32]!==previous[32] || bytes[33]!==previous[33];
      const near=!focus || p.id===focusId || Math.hypot(p.x-focus.x,p.z-focus.z)<=42;
      if(!full && ((!near && !critical && now-(this.sentAt.get(p.netId)??-Infinity)<333) || same(previous,bytes))) continue;
      updates.push(bytes); this.previous.set(p.netId,bytes); this.sentAt.set(p.netId,now);
    }
    const tiles=[];
    for(const [id,time] of Object.entries(state.collapsed||{})) if(full || this.collapsed[id]!==time) tiles.push([Number(id.slice(1)),time]);
    if(!full) for(const id of Object.keys(this.collapsed)) if(!(id in (state.collapsed||{}))) tiles.push([Number(id.slice(1)),NaN]);
    if(!full && !updates.length && !tiles.length && now-this.lastPacket<333) return null;
    if(full) { this.lastFull=now; this.previous=new Map(updates.map(bytes=>[bytes[0],bytes])); }
    this.epoch=state.epoch; this.collapsed={...state.collapsed}; this.lastPacket=now;
    const bytes=new Uint8Array(HEADER+updates.length*PLAYER+tiles.length*TILE),v=new DataView(bytes.buffer);
    v.setUint8(0,0x4a); v.setUint8(1,1); v.setUint8(2,Number(full)); v.setUint8(3,updates.length); v.setUint16(4,tiles.length,true);
    v.setUint32(8,state.epoch,true); v.setFloat32(12,state.time,true);
    let offset=HEADER;
    for(const update of updates) { bytes.set(update,offset); offset+=PLAYER; }
    for(const [id,time] of tiles) { v.setUint16(offset,id,true); v.setFloat32(offset+2,time,true); offset+=TILE; }
    return bytes;
  }
}

export class StateDecoder {
  constructor() { this.roster=new Map(); this.players=new Map(); this.collapsed={}; this.epoch=null; }
  setRoom(room) {
    const epoch=room.startsAt==null?null:room.startsAt>>>0;
    if(this.epoch!==epoch) { this.players.clear(); this.collapsed={}; this.epoch=epoch; }
    this.roster=new Map(room.players.map(p=>[p.netId,p]));
    for(const [slot,p] of this.players) if(this.roster.get(slot)?.id!==p.id || !this.roster.get(slot)?.participating) this.players.delete(slot);
  }
  decode(data) {
    const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length<HEADER || v.getUint8(0)!==0x4a || v.getUint8(1)!==1) throw new Error('잘못된 상태 패킷');
    const count=v.getUint8(3),tileCount=v.getUint16(4,true),epoch=v.getUint32(8,true),time=v.getFloat32(12,true),full=!!v.getUint8(2);
    if(count>30 || bytes.length!==HEADER+count*PLAYER+tileCount*TILE || !Number.isFinite(time)) throw new Error('잘못된 상태 패킷 길이');
    if(epoch!==this.epoch) return null;
    const next=full?new Map():new Map(this.players),collapsed=full?{}:{...this.collapsed};
    let offset=HEADER;
    for(let i=0;i<count;i++,offset+=PLAYER) {
      const slot=v.getUint8(offset),entry=this.roster.get(slot),flags=v.getUint8(offset+1);
      if(!entry) continue;
      const p={id:entry.id,netId:slot,grounded:!!(flags&1),finished:!!(flags&2),eliminated:!!(flags&4),sampleTime:time};
      ['x','y','z'].forEach((key,j)=>p[key]=v.getFloat32(offset+2+j*4,true));
      if(![p.x,p.y,p.z].every(Number.isFinite)) throw new Error('잘못된 좌표');
      ['vx','vy','vz'].forEach((key,j)=>p[key]=v.getInt16(offset+14+j*2,true)/100);
      p.yaw=v.getInt16(offset+20,true)/10000;p.progress=v.getUint16(offset+22,true)/65535;
      ['diveCooldown','bumpTime','hitCooldown'].forEach((key,j)=>p[key]=v.getUint8(offset+24+j)/100);
      p.checkpoint=v.getInt8(offset+27);
      ['jumpCount','landCount','fallCount'].forEach((key,j)=>p[key]=v.getUint16(offset+28+j*2,true));
      if(p.finished) p.finishTime=v.getUint32(offset+34,true)/1000;
      next.set(slot,p);
    }
    for(let i=0;i<tileCount;i++,offset+=TILE) { const id='p'+v.getUint16(offset,true),value=v.getFloat32(offset+2,true);if(Number.isNaN(value))delete collapsed[id];else if(Number.isFinite(value))collapsed[id]=value;else throw new Error('잘못된 발판 시간'); }
    this.players=next;this.collapsed=collapsed;
    return {type:'state',epoch,time,collapsed,players:[...next.values()]};
  }
}
