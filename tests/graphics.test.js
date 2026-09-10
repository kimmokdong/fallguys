import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoGraphics, GRAPHICS_LEVELS, renderPixelRatio } from '../public/graphics.js';

const run = (graphics, ms, duration) => { for (let time = 0; time < duration; time += ms) graphics.sample(ms); };

test('자동 품질: 지속적인 저속만 낮추고 충분히 안정된 뒤 한 단계씩 복구한다', () => {
  const graphics = new AutoGraphics();
  run(graphics, 1000 / 60, 2000);
  graphics.sample(400); run(graphics, 1000 / 60, 3500);
  assert.equal(graphics.level, 1, '한 번의 멈춤으로 낮추지 않음');
  run(graphics, 40, 8000); assert.equal(graphics.level, 0);
  run(graphics, 1000 / 60, 8000); assert.equal(graphics.level, 0, '복구 대기');
  run(graphics, 1000 / 60, 10000); assert.equal(graphics.level, 1);
  run(graphics, 1000 / 60, 18000); assert.equal(graphics.level, 2);
  run(graphics, 40, 8000); assert.equal(graphics.level, 1, '한 단계만 하향');
  run(graphics, 40, 9000); assert.equal(graphics.level, 0);
});

test('탭 복귀와 비정상 시각은 측정에서 제외하고 품질 범위를 유지한다', () => {
  const graphics = new AutoGraphics();
  run(graphics, 40, 5000); graphics.sample(5000); graphics.sample(NaN); graphics.sample(-1);
  run(graphics, 1000 / 60, 3000); assert.equal(graphics.level, 1);
  for (let i = 0; i < 2; i++) { run(graphics, 40, 4000); graphics.reset(); }
  assert.equal(graphics.level, 1, '숨김 구간의 측정 누적 방지');
  run(graphics, 50, 60000); assert.equal(graphics.level, 0);
  run(graphics, 1000 / 60, 60000); assert.equal(graphics.level, 2);
});

test('고밀도 태블릿과 큰 모니터에서도 내부 픽셀 예산을 지킨다', () => {
  for (const [width,height,dpr] of [[1366,650,1],[1024,768,2],[1920,1080,1],[3840,2160,2]]) {
    let previous = 0;
    GRAPHICS_LEVELS.forEach((quality,level) => {
      const ratio = renderPixelRatio(width,height,dpr,level);
      assert.ok(ratio > 0 && ratio <= dpr && ratio >= previous);
      assert.ok(width*height*ratio*ratio <= quality.maxPixels + 1);
      previous = ratio;
    });
  }
});

// 브라우저 없이도 묶기 전후의 실제 좌표와 움직이는 부품 보존을 검증합니다.
import * as THREE from 'three';
import { GameScene } from '../public/scene.js';
test('부품을 묶어도 회전·크기·배치가 같고 경고 막대는 독립적으로 움직인다', () => {
  const geometry=new THREE.BoxGeometry(), material=new THREE.MeshStandardMaterial();
  const parent=new THREE.Group(); parent.position.set(3,2,-5); parent.rotation.y=.6; parent.scale.set(1.2,.8,1.5);
  const make=(x)=>{const mesh=new THREE.Mesh(geometry,material); mesh.position.set(x,.5,x*.2); mesh.rotation.z=.2; mesh.scale.set(.2,2,.5); mesh.userData.shape='box'; return mesh;};
  const first=make(0), second=make(2), warning=make(4); parent.add(first,second,warning); parent.updateMatrixWorld(true);
  const expected=[first.matrixWorld.clone(),second.matrixWorld.clone()];
  GameScene.prototype.batchLocalMeshes(parent,[warning]); parent.updateMatrixWorld(true);
  const batch=parent.children.find(mesh=>mesh.isInstancedMesh); assert.equal(batch.count,2); assert.equal(warning.parent,parent);
  expected.forEach((matrix,i)=>{const actual=new THREE.Matrix4();batch.getMatrixAt(i,actual);actual.premultiply(parent.matrixWorld); actual.elements.forEach((value,n)=>assert.ok(Math.abs(value-matrix.elements[n])<.00001));});
  warning.scale.x=3; assert.equal(batch.count,2); batch.dispose();
  const content=new THREE.Group(), roots=[new THREE.Group(),new THREE.Group()];
  roots.forEach((root,i)=>{root.userData.batchStatic=true;root.position.set(2+i,0,4);root.rotation.y=i*.3;root.add(make(i));content.add(root);});
  const dynamic=make(3);content.add(dynamic);content.updateMatrixWorld(true);
  const worldMatrices=roots.map(root=>root.children[0].matrixWorld.clone());
  GameScene.prototype.batchStaticMeshes.call({content});
  const worldBatch=content.children.find(mesh=>mesh.isInstancedMesh); assert.equal(worldBatch.count,2);assert.equal(dynamic.parent,content);
  worldMatrices.forEach((matrix,i)=>{const actual=new THREE.Matrix4();worldBatch.getMatrixAt(i,actual);actual.elements.forEach((value,n)=>assert.ok(Math.abs(value-matrix.elements[n])<.00001));});
  worldBatch.dispose();geometry.dispose();material.dispose();
});
