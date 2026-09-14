import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';
const brotli=promisify(brotliCompress),gz=promisify(gzip),cache=new Map();
const accepts=(header,name)=>header.split(',').some(part=>{const [token,...params]=part.trim().split(';');return token===name && !params.some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));});
// 압축 결과는 파일 변경 전까지 재사용합니다. 동시 접속도 같은 작업을 공유합니다.
async function asset(path,info,encoding) {
  const key=path+':'+info.mtimeMs+':'+info.size+':'+encoding;
  if(!cache.has(key)) {
    const pending=readFile(path).then(async data=>{
      const body=encoding==='br'?await brotli(data,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}):encoding==='gzip'?await gz(data,{level:6}):data;
      return {body,etag:'"'+createHash('sha256').update(body).digest('hex').slice(0,24)+'"'};
    });
    cache.set(key,pending);pending.catch(()=>cache.delete(key));
    if(cache.size>32) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
export async function serveAsset(req,res,path,info,type,musicHash) {
  const compressible=/^(text\/|application\/(javascript|json))/.test(type);
  const accepted=String(req.headers['accept-encoding']||'');
  const encoding=compressible?(accepts(accepted,'br')?'br':accepts(accepted,'gzip')?'gzip':''):'';
  const {body,etag:hash}=await asset(path,info,encoding),etag=musicHash?'"'+musicHash+'"':hash;
  const headers={'Content-Type':type,'ETag':etag,'Cache-Control':musicHash?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'};
  if(compressible) headers.Vary='Accept-Encoding';
  if(encoding) headers['Content-Encoding']=encoding;
  if(req.headers['if-none-match']?.split(',').some(x=>x.trim()==='*'||x.trim().replace(/^W\//,'')===etag)) {res.writeHead(304,headers).end();return;}
  let start=0,end=body.length-1,status=200;
  if(type==='audio/mpeg') {
    headers['Accept-Ranges']='bytes';
    if(req.headers.range && (!req.headers['if-range']||req.headers['if-range']===etag)) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(match && (match[1]||match[2])) {
        start=match[1]?Number(match[1]):Math.max(0,body.length-Number(match[2]));
        end=match[1]&&match[2]?Math.min(Number(match[2]),body.length-1):body.length-1;
      } else start=body.length;
      if(start>end) {res.writeHead(416,{...headers,'Content-Range':`bytes */${body.length}`}).end();return;}
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${body.length}`;
    }
  }
  headers['Content-Length']=end-start+1;
  res.writeHead(status,headers).end(req.method==='HEAD'?undefined:body.subarray(start,end+1));
}
