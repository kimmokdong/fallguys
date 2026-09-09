import * as THREE from 'three';
import { createCourse, MAPS, obstaclePose, platformTiming, platformPose } from './world.js';
import { CHARACTERS, COLORS } from './catalog.js';

const WHITE = '#d9d2bc', INK = '#293b32', GOLD = '#c5a15a';
const CAMP = { floor: '#638364', wood: '#785b40', edge: '#344839', trim: '#bba477', hazard: '#b85c37', helper: '#c5a15a', trees: '#3c654e' };

// 동일한 형태와 재질을 공유하여 30명이 함께 있어도 모델 비용을 줄인다.
export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error('3D 화면을 시작할 수 없습니다. 브라우저의 하드웨어 가속을 켜거나 최신 Chrome / Edge에서 열어 주세요.', { cause: error });
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 280);
    this.materials = new Map();
    this.portraits = new Map();
    this.geometries = {
      sphere: new THREE.SphereGeometry(1, 16, 12),
      capsule: new THREE.CapsuleGeometry(0.63, 0.72, 4, 12),
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 24),
      cone: new THREE.ConeGeometry(1, 1, 12),
      torus: new THREE.TorusGeometry(1, 0.1, 6, 36),
    };
    this.scene.add(new THREE.HemisphereLight('#dce5da', '#55605b', 1.6));
    this.sun = new THREE.DirectionalLight('#f0dfc3', 2.25);
    this.sun.position.set(-12, 24, 13);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -25, right: 25, top: 30, bottom: -25, near: 1, far: 85 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#abc5cc', 0.55);
    fill.position.set(10, 8, -8);
    this.scene.add(fill);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.roster = [];
    this.players = new Map();
    this.characterId = CHARACTERS[0].id;
    this.colorId = COLORS[0].id;
    this.lastFrame = performance.now();
    this.stateTime = 0;
    this.stateReceived = performance.now();
    this.previewCharacters = [];
    this.decorations = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.setMode('preview');
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  material(color, options = {}) {
    if (color === '#ecf4fc') color = '#cbd0c5';
    if (this.paintingCourse && typeof color === 'string') {
      const rgb = new THREE.Color(color);
      if (Math.min(rgb.r, rgb.g, rgb.b) > 0.67) color = CAMP.trim;
    }
    const key = color + JSON.stringify(options);
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...options }));
    return this.materials.get(key);
  }

  mesh(parent, shape, color, position, scale, options = {}) {
    const mesh = new THREE.Mesh(this.geometries[shape], this.material(color, options));
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  sphere(parent, color, position, scale) { return this.mesh(parent, 'sphere', color, position, scale); }
  box(parent, color, position, scale) { return this.mesh(parent, 'box', color, position, scale); }

  ring(parent, color, position, scale, horizontal = false) {
    const ring = this.mesh(parent, 'torus', color, position, scale);
    if (horizontal) ring.rotation.x = Math.PI / 2;
    return ring;
  }

  avatar(characterId, colorId) {
    const kind = CHARACTERS.find(c => c.id === characterId)?.kind || 'bean';
    const color = COLORS.find(c => c.id === colorId)?.hex || COLORS[0].hex;
    const dark = '#' + new THREE.Color(color).multiplyScalar(0.62).getHexString();
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    this.mesh(body, 'capsule', color, [0, 1.17, 0], [1, 1, 0.88]);
    const leftFoot = this.sphere(body, dark, [-0.31, 0.19, 0.12], [0.24, 0.19, 0.34]);
    const rightFoot = this.sphere(body, dark, [0.31, 0.19, 0.12], [0.24, 0.19, 0.34]);
    const leftArm = this.sphere(body, color, [-0.68, 1.05, 0.02], [0.2, 0.39, 0.2]);
    const rightArm = this.sphere(body, color, [0.68, 1.05, 0.02], [0.2, 0.39, 0.2]);
    leftArm.rotation.z = -0.25;
    rightArm.rotation.z = 0.25;
    const faceColor = kind === 'robot' ? '#c9f9fa' : WHITE;
    this.sphere(body, faceColor, [0, 1.31, 0.49], [0.47, 0.45, 0.16]);
    for (const x of [-0.155, 0.155]) {
      this.sphere(body, INK, [x, 1.36, 0.638], [0.058, 0.115, 0.037]);
      this.sphere(body, '#ffffff', [x - 0.012, 1.404, 0.671], [0.014, 0.023, 0.009]);
    }
    this.sphere(body, '#ffd1d4', [-0.3, 1.18, 0.604], [0.067, 0.036, 0.026]);
    this.sphere(body, '#ffd1d4', [0.3, 1.18, 0.604], [0.067, 0.036, 0.026]);
    const cone = (c, p, s, tilt = 0) => {
      const m = this.mesh(body, 'cone', c, p, s);
      m.rotation.z = tilt;
      return m;
    };
    const roundEars = (c = color, inner = '#ffc3c9') => {
      for (const side of [-1, 1]) {
        this.sphere(body, c, [side * 0.47, 2.02, 0], [0.27, 0.3, 0.19]);
        this.sphere(body, inner, [side * 0.47, 2.03, 0.16], [0.145, 0.165, 0.045]);
      }
    };
    const pointedEars = (height = 0.58, c = color) => {
      for (const side of [-1, 1]) {
        cone(c, [side * 0.42, 2.1, 0], [0.24, height, 0.23], -side * 0.2);
        cone('#ffc3c9', [side * 0.42, 2.11, 0.17], [0.115, height * 0.56, 0.055], -side * 0.2);
      }
    };
    const wing = (c, side, size = 1) => {
      const w = this.sphere(body, c, [side * 0.79, 1.45, -0.25], [0.5 * size, 0.7 * size, 0.12]);
      w.rotation.z = -side * 0.52;
    };
    const belt = (c = INK, y = 0.81) => this.mesh(body, 'cylinder', c, [0, y, 0], [0.63, 0.13, 0.56]);
    switch (kind) {
      case 'cat':
        pointedEars();
        this.sphere(body, color, [0.27, 0.7, -0.7], [0.16, 0.48, 0.15]).rotation.x = 0.6;
        for (const side of [-1, 1]) for (let i = 0; i < 2; i++) this.box(body, dark, [side * 0.37, 1.19 + i * 0.09, 0.63], [0.2, 0.025, 0.025]).rotation.z = side * (i ? 0.18 : -0.18);
        break;
      case 'bunny':
        for (const side of [-1, 1]) {
          const ear = this.sphere(body, color, [side * 0.31, 2.35, 0], [0.18, 0.66, 0.17]);
          ear.rotation.z = -side * 0.17;
          this.sphere(body, '#ffc9d7', [side * 0.32, 2.36, 0.145], [0.087, 0.46, 0.046]).rotation.z = -side * 0.17;
        }
        this.sphere(body, WHITE, [0, 0.71, -0.59], [0.26, 0.26, 0.26]);
        break;
      case 'bear':
        roundEars(color, dark);
        this.sphere(body, '#ffe6c8', [0, 1.15, 0.655], [0.24, 0.15, 0.085]);
        this.sphere(body, INK, [0, 1.21, 0.723], [0.075, 0.054, 0.04]);
        break;
      case 'fox':
        pointedEars(0.75);
        this.sphere(body, color, [0.25, 0.83, -0.76], [0.3, 0.62, 0.34]).rotation.x = -0.7;
        this.sphere(body, WHITE, [0.25, 1.21, -1.04], [0.23, 0.28, 0.26]);
        this.sphere(body, INK, [0, 1.15, 0.681], [0.055, 0.045, 0.032]);
        break;
      case 'panda':
        roundEars(INK, '#636b81');
        for (const side of [-1, 1]) {
          this.sphere(body, INK, [side * 0.17, 1.38, 0.631], [0.14, 0.17, 0.034]).rotation.z = side * 0.3;
          this.sphere(body, WHITE, [side * 0.16, 1.4, 0.669], [0.031, 0.049, 0.016]);
        }
        belt(INK, 0.69);
        break;
      case 'frog':
        for (const side of [-1, 1]) {
          this.sphere(body, color, [side * 0.37, 1.98, 0.16], [0.27, 0.25, 0.26]);
          this.sphere(body, WHITE, [side * 0.37, 2.03, 0.355], [0.145, 0.13, 0.072]);
          this.sphere(body, INK, [side * 0.37, 2.03, 0.416], [0.065, 0.08, 0.03]);
        }
        break;
      case 'penguin':
        this.sphere(body, WHITE, [0, 0.88, 0.41], [0.43, 0.48, 0.18]);
        cone(GOLD, [0, 1.15, 0.72], [0.15, 0.25, 0.13]).rotation.x = Math.PI / 2;
        leftArm.scale.set(0.14, 0.5, 0.23);
        rightArm.scale.set(0.14, 0.5, 0.23);
        break;
      case 'chick':
        cone('#ffab43', [0, 1.17, 0.72], [0.16, 0.26, 0.12]).rotation.x = Math.PI / 2;
        for (let i = -1; i <= 1; i++) this.sphere(body, color, [i * 0.14, 2.12 + (1 - Math.abs(i)) * 0.1, 0], [0.095, 0.22, 0.12]).rotation.z = -i * 0.3;
        break;
      case 'dino':
        for (let i = 0; i < 5; i++) cone(GOLD, [0, 2.16 - i * 0.26, -0.22 - i * 0.08], [0.19, 0.32, 0.15]).rotation.x = -i * 0.25;
        cone(color, [0, 0.68, -0.91], [0.29, 1.1, 0.3]).rotation.x = -Math.PI / 2 - 0.2;
        this.sphere(body, '#e5fac9', [0, 0.78, 0.43], [0.36, 0.38, 0.14]);
        break;
      case 'shark':
        cone(color, [0, 1.53, -0.68], [0.4, 0.8, 0.22]).rotation.x = -Math.PI / 3;
        this.ring(body, WHITE, [0, 1.32, 0.61], [0.52, 0.49, 0.5]);
        for (let i = -2; i <= 2; i++) cone(WHITE, [i * 0.15, 1.67, 0.64], [0.065, 0.15, 0.045]).rotation.z = Math.PI;
        break;
      case 'unicorn':
        pointedEars(0.42);
        cone(GOLD, [0, 2.28, 0.24], [0.14, 0.77, 0.14], -0.07);
        ['#aa85f5', '#ff9ed0', '#61dfba'].forEach((c, i) => this.sphere(body, c, [0, 1.83 - i * 0.32, -0.49], [0.22, 0.31, 0.24]));
        break;
      case 'robot':
        for (const side of [-1, 1]) this.box(body, '#b5c5e0', [side * 0.63, 1.65, 0], [0.18, 0.34, 0.35]);
        this.box(body, INK, [0, 2.17, 0], [0.055, 0.39, 0.055]);
        this.sphere(body, GOLD, [0, 2.39, 0], [0.115, 0.115, 0.115]);
        this.box(body, '#d9e6f1', [0, 0.86, 0.5], [0.48, 0.22, 0.05]);
        for (let i = -1; i <= 1; i++) this.sphere(body, [GOLD, '#ff718b', '#61dfba'][i + 1], [i * 0.13, 0.86, 0.54], [0.04, 0.04, 0.02]);
        break;
      case 'astronaut':
        this.ring(body, '#e9f1ff', [0, 1.43, 0.36], [0.69, 0.7, 0.7]);
        this.mesh(body, 'sphere', '#b7eaff', [0, 1.44, 0.05], [0.73, 0.74, 0.69], { transparent: true, opacity: 0.2, roughness: 0.15, depthWrite: false });
        this.box(body, '#e5edff', [0, 1.18, -0.56], [0.77, 0.87, 0.34]);
        this.box(body, INK, [0, 0.77, 0.49], [0.36, 0.23, 0.08]);
        this.sphere(body, '#61dfba', [0.1, 0.78, 0.55], [0.052, 0.045, 0.022]);
        break;
      case 'alien':
        for (const side of [-1, 1]) {
          this.box(body, dark, [side * 0.32, 2.12, 0], [0.045, 0.5, 0.045]).rotation.z = -side * 0.38;
          this.sphere(body, '#d0ffac', [side * 0.41, 2.37, 0], [0.14, 0.14, 0.14]);
        }
        this.ring(body, '#cbd5f3', [0, 0.81, 0], [0.87, 0.65, 0.87], true);
        break;
      case 'ninja':
        this.mesh(body, 'cylinder', INK, [0, 1.78, 0], [0.605, 0.18, 0.56]);
        this.box(body, GOLD, [0, 1.78, 0.565], [0.19, 0.14, 0.04]);
        this.box(body, INK, [0.52, 1.52, -0.43], [0.18, 0.7, 0.05]).rotation.z = 0.7;
        belt();
        break;
      case 'pirate':
        this.box(body, INK, [0, 2, 0], [1.34, 0.15, 0.83]);
        this.sphere(body, INK, [0, 2.14, 0], [0.53, 0.29, 0.37]);
        this.sphere(body, WHITE, [0, 2.14, 0.36], [0.1, 0.12, 0.035]);
        this.sphere(body, INK, [-0.17, 1.37, 0.688], [0.13, 0.13, 0.035]);
        this.ring(body, GOLD, [0.66, 1.24, 0.09], [0.16, 0.2, 0.16]);
        belt('#f6ecd4');
        break;
      case 'wizard':
        this.mesh(body, 'cylinder', '#6659b5', [0, 1.94, 0], [0.79, 0.11, 0.71]);
        cone('#6659b5', [-0.05, 2.44, 0], [0.51, 1.04, 0.49], 0.13);
        this.sphere(body, GOLD, [-0.14, 2.96, 0], [0.12, 0.12, 0.12]);
        for (let i = 0; i < 3; i++) this.sphere(body, GOLD, [-0.2 + i * 0.2, 2.19 + (i % 2) * 0.27, 0.36 - (i % 2) * 0.07], [0.065, 0.065, 0.025]);
        break;
      case 'king':
        this.mesh(body, 'cylinder', GOLD, [0, 2.04, 0], [0.55, 0.19, 0.5]);
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          cone(GOLD, [Math.sin(a) * 0.43, 2.25, Math.cos(a) * 0.4], [0.13, 0.39, 0.13]);
          this.sphere(body, '#ff718b', [Math.sin(a) * 0.43, 2.43, Math.cos(a) * 0.4], [0.065, 0.065, 0.065]);
        }
        this.box(body, '#a77be1', [0, 1.09, -0.55], [0.82, 1.05, 0.09]);
        break;
      case 'knight':
        this.mesh(body, 'cylinder', '#aabed5', [0, 1.94, 0], [0.65, 0.16, 0.58]);
        this.box(body, '#c6d6e9', [0, 1.9, 0.23], [0.16, 0.51, 0.8]);
        this.sphere(body, '#ff718b', [0, 2.26, -0.04], [0.12, 0.29, 0.32]);
        this.sphere(body, '#c6d6e9', [-0.76, 0.93, 0.28], [0.32, 0.39, 0.08]);
        this.box(body, GOLD, [-0.76, 0.94, 0.37], [0.08, 0.43, 0.025]);
        break;
      case 'chef':
        this.mesh(body, 'cylinder', WHITE, [0, 2.02, 0], [0.51, 0.31, 0.47]);
        for (const [x, y] of [[-0.33, 2.27], [0, 2.4], [0.33, 2.27]]) this.sphere(body, WHITE, [x, y, 0], [0.34, 0.29, 0.33]);
        this.box(body, WHITE, [0, 0.82, 0.49], [0.56, 0.46, 0.045]);
        this.sphere(body, '#ff718b', [0, 1.03, 0.55], [0.19, 0.07, 0.06]);
        break;
      case 'mushroom':
        this.sphere(body, color, [0, 2.06, 0], [0.91, 0.43, 0.77]);
        this.mesh(body, 'cylinder', '#ffe6d6', [0, 1.99, 0], [0.89, 0.065, 0.75]);
        for (const [x, y, z, r] of [[-0.43, 2.26, 0.38, 0.18], [0.24, 2.36, 0.24, 0.2], [0.55, 2.2, -0.2, 0.14], [-0.21, 2.39, -0.33, 0.17]]) this.sphere(body, WHITE, [x, y, z], [r, 0.045, r]);
        break;
      case 'cactus':
        for (const side of [-1, 1]) {
          this.sphere(body, color, [side * 0.85, 1.15, 0], [0.3, 0.18, 0.22]);
          this.sphere(body, color, [side * 1.02, 1.44, 0], [0.18, 0.4, 0.19]);
        }
        for (let i = 0; i < 7; i++) this.box(body, '#e5ffd4', [(i % 3 - 1) * 0.36, 0.64 + Math.floor(i / 3) * 0.56, 0.5], [0.025, 0.12, 0.035]);
        for (let i = 0; i < 5; i++) this.sphere(body, '#ffacd9', [0.16 + Math.sin(i * 1.257) * 0.14, 2.07, Math.cos(i * 1.257) * 0.14], [0.14, 0.085, 0.14]);
        this.sphere(body, GOLD, [0.16, 2.12, 0], [0.09, 0.055, 0.09]);
        break;
      case 'strawberry':
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 0.4;
          this.sphere(body, '#63c48c', [Math.sin(a) * 0.23, 2.04, Math.cos(a) * 0.23], [0.16, 0.08, 0.37]).rotation.y = a;
        }
        for (let i = 0; i < 8; i++) this.sphere(body, '#ffe6ac', [(i % 3 - 1) * 0.3, 0.59 + Math.floor(i / 3) * 0.22, 0.49], [0.034, 0.06, 0.018]);
        break;
      case 'pineapple':
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2;
          cone('#63c48c', [Math.sin(a) * 0.18, 2.28 + (i % 2) * 0.16, Math.cos(a) * 0.18], [0.17, 0.85, 0.14], Math.sin(a) * -0.4).rotation.x = Math.cos(a) * 0.4;
        }
        for (let i = 0; i < 3; i++) this.ring(body, dark, [0, 0.57 + i * 0.17, 0], [0.57, 0.5, 0.6], true);
        break;
      case 'bee':
        belt(INK, 0.58); belt(INK, 0.88);
        wing('#e5faff', -1, 0.7); wing('#e5faff', 1, 0.7);
        for (const side of [-1, 1]) {
          this.box(body, INK, [side * 0.24, 2.09, 0], [0.04, 0.33, 0.04]).rotation.z = -side * 0.3;
          this.sphere(body, GOLD, [side * 0.29, 2.25, 0], [0.1, 0.1, 0.1]);
        }
        break;
      case 'butterfly':
        for (const side of [-1, 1]) {
          wing('#b298ff', side, 1.2);
          this.sphere(body, '#ffb6d3', [side * 0.87, 0.9, -0.23], [0.46, 0.4, 0.13]);
          this.sphere(body, GOLD, [side * 1.03, 1.57, -0.11], [0.22, 0.28, 0.036]);
          this.box(body, INK, [side * 0.2, 2.11, 0], [0.035, 0.4, 0.035]).rotation.z = -side * 0.3;
        }
        break;
      case 'devil':
        cone('#ffbc75', [-0.39, 2.14, 0], [0.15, 0.59, 0.15], 0.3);
        cone('#ffbc75', [0.39, 2.14, 0], [0.15, 0.59, 0.15], -0.3);
        wing(dark, -1, 0.7); wing(dark, 1, 0.7);
        cone(dark, [0.4, 0.9, -0.82], [0.14, 0.4, 0.14], -0.45);
        break;
      case 'angel':
        wing(WHITE, -1); wing(WHITE, 1);
        this.ring(body, GOLD, [0, 2.45, 0], [0.44, 0.44, 0.44], true);
        break;
      case 'snowman':
        this.mesh(body, 'cylinder', INK, [0, 2, 0], [0.72, 0.1, 0.62]);
        this.mesh(body, 'cylinder', INK, [0, 2.28, 0], [0.44, 0.55, 0.4]);
        this.mesh(body, 'cylinder', '#ff718b', [0, 2.1, 0], [0.445, 0.11, 0.405]);
        this.mesh(body, 'cylinder', '#ff718b', [0, 1.02, 0], [0.63, 0.15, 0.55]);
        this.box(body, '#ff718b', [0.31, 0.76, 0.53], [0.17, 0.51, 0.09]);
        for (const y of [0.56, 0.8]) this.sphere(body, INK, [0, y, 0.52], [0.047, 0.047, 0.025]);
        cone('#ff9b51', [0, 1.2, 0.79], [0.08, 0.35, 0.08]).rotation.x = Math.PI / 2;
        break;
    }
    group.userData = { body, leftArm, rightArm, leftFoot, rightFoot, characterId, colorId };
    return group;
  }

  clearContent() {
    this.content.traverse(object => {
      if (object.isSprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    this.content.clear();
    this.players.clear();
    this.previewCharacters = [];
    this.decorations = [];
    this.obstacles = [];
    this.platforms = [];
    this.course = null;
  }

  portrait(characterId, colorId) {
    const key = `${characterId}:${colorId}`;
    if (this.portraits.has(key)) return this.portraits.get(key);
    // 게임에서 사용하는 모델을 같은 렌더러의 작은 렌더 타깃에 촬영합니다.
    const portrait = new THREE.Scene();
    portrait.add(new THREE.HemisphereLight('#dce5da', '#55605b', 1.6));
    const light = new THREE.DirectionalLight('#f0dfc3', 2.25);
    light.position.set(-3, 5, 6); portrait.add(light);
    const avatar = this.avatar(characterId, colorId);
    avatar.traverse(object => { if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; } });
    avatar.rotation.y = 0.12;
    avatar.userData.leftArm.rotation.z = -0.45;
    avatar.userData.rightArm.rotation.z = 0.7;
    portrait.add(avatar);
    const bounds = new THREE.Box3().setFromObject(avatar);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(center.x, center.y + 0.2, center.z + Math.max(size.x, size.y) / (2 * Math.tan(Math.PI * 32 / 360)) * 1.18 + size.z / 2);
    camera.lookAt(center);
    const target = new THREE.WebGLRenderTarget(256, 256);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previous = this.renderer.getRenderTarget();
    const clearColor = this.renderer.getClearColor(new THREE.Color()), clearAlpha = this.renderer.getClearAlpha();
    const pixels = new Uint8Array(256 * 256 * 4);
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0, 0);
      this.renderer.clear();
      this.renderer.render(portrait, camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    } finally {
      this.renderer.setRenderTarget(previous);
      this.renderer.setClearColor(clearColor, clearAlpha);
      target.dispose();
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'), image = context.createImageData(256, 256);
    for (let row = 0; row < 256; row++) image.data.set(pixels.subarray((255 - row) * 1024, (256 - row) * 1024), row * 1024);
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (this.portraits.size >= 60) this.portraits.delete(this.portraits.keys().next().value);
    this.portraits.set(key, url);
    return url;
  }

  setMode(mode, options = {}) {
    if (this.mode === mode && mode === 'race' && this.mapId === options.mapId && this.rule === options.rule && !options.reset) {
      this.playerId = options.playerId ?? this.playerId;
      return;
    }
    this.clearContent();
    this.mode = mode;
    this.playerId = options.playerId;
    this.mapId = options.mapId; this.rule = options.rule;
    this.cameraReady = false;
    this.camera.fov = mode === 'race' ? 48 : 40;
    this.camera.updateProjectionMatrix();
    if (mode === 'race') {
      this.course = createCourse(options.mapId || MAPS[0].id, options.rule);
      const sky = this.course.colors?.sky || '#bec9fa';
      this.scene.background = new THREE.Color(sky);
      this.scene.fog = new THREE.Fog(sky, 62, 170);
      this.buildCourse();
      this.setPlayers(this.roster);
      this.camera.position.set(0, 11, -13);
      this.camera.lookAt(0, 1, 8);
    } else {
      this.scene.background = null;
      this.scene.fog = null;
      this.sun.position.set(-12, 24, 13);
      this.sun.target.position.set(0, 0, 0);
      this.buildPreview();
    }
    this.resize();
  }

  setCharacter(characterId, colorId) {
    this.characterId = characterId || this.characterId;
    this.colorId = colorId || this.colorId;
    if (this.mode === 'preview') {
      this.clearContent();
      this.buildPreview();
    }
  }

  buildPreview() {
    this.mesh(this.content, 'cylinder', CAMP.wood, [0, -0.55, 0], [5.1, 0.85, 3.8]);
    this.mesh(this.content, 'cylinder', CAMP.floor, [0, -0.06, 0], [5.05, 0.14, 3.76]);
    this.ring(this.content, CAMP.trim, [0, 0.025, 0], [4.65, 3.45, 0.8], true);
    const lead = this.avatar(this.characterId, this.colorId);
    lead.position.set(0, 0, 0.8); lead.scale.setScalar(1.48);
    this.content.add(lead);
    this.previewCharacters.push({ model: lead, y: 0, phase: 0, lead: true });
    for (const [id, color, x] of [['dino', 'mint', -2.65], ['cat', 'orange', 2.5]]) {
      const model = this.avatar(id === this.characterId ? 'bunny' : id, color);
      model.position.set(x, 0, -0.2); model.scale.setScalar(1.1);
      this.content.add(model);
      this.previewCharacters.push({ model, y: 0, phase: x });
    }
    for (const x of [-3.8, 3.8]) this.box(this.content, CAMP.hazard, [x, 1, -1.9], [0.5, 2, 0.5]);
    this.box(this.content, CAMP.hazard, [0, 2.1, -1.9], [8.1, 0.45, 0.6]);
    for (let i = 0; i < 9; i++) this.box(this.content, i % 2 ? CAMP.trim : CAMP.edge, [-3.2 + i * 0.8, 2.1, -1.57], [0.55, 0.38, 0.035]);
    for (const x of [-4.3, 4.3]) this.tree(x, -0.5, -3.6, 0.8);
    this.previewCamera();
  }

  tree(x, y, z, scale = 1) {
    const group = new THREE.Group();
    this.mesh(group, 'cylinder', CAMP.wood, [0, 1.5, 0], [0.3, 3, 0.3]);
    for (let i = 0; i < 3; i++) this.mesh(group, 'cone', CAMP.trees, [0, 2 + i * 1.1, 0], [2 - i * 0.4, 2.7, 2 - i * 0.4]);
    group.position.set(x, y, z); group.scale.setScalar(scale); this.content.add(group);
  }

  previewCamera() {
    const narrow = this.camera.aspect < 0.95;
    this.camera.position.set(6.2, 5.5, narrow ? 15.8 : 12.8);
    this.camera.lookAt(0, 1.1, 0);
  }

  cloud(x, y, z, scale = 1) {
    this.tree(x, y - 1.5, z, scale * 0.7);
  }

  label(text, background = 'rgba(40, 63, 49, .9)', color = '#eee5cf', width = 3.1) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = background;
    context.beginPath();
    context.roundRect(4, 4, 504, 92, 42);
    context.fill();
    context.fillStyle = color;
    context.font = '700 43px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 256, 52, 450);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(width, width * 100 / 512, 1);
    return sprite;
  }

  playerLabel(text, own) {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    const font = '800 46px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.font = font;
    canvas.width = Math.ceil(Math.min(950, Math.max(230, context.measureText(text).width + 56)));
    canvas.height = 86;
    context.fillStyle = own ? '#244e32' : '#23382b';
    context.beginPath(); context.roundRect(3, 3, canvas.width - 6, 80, 22); context.fill();
    context.strokeStyle = own ? '#ead9a4' : '#7d9275'; context.lineWidth = own ? 6 : 3; context.stroke();
    context.font = font; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = '#fff4d7'; context.fillText(text, canvas.width / 2, 44, canvas.width - 32);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
    sprite.renderOrder = own ? 12 : 11;
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
  }

  beginRound(startsAt) {
    this.followId = null; this.cameraReady = false;
    this.introStart = startsAt - 6000; this.introEnd = startsAt - 3000;
  }

  followPlayer(id) {
    if (this.followId === id) return;
    this.followId = id; this.cameraReady = false;
  }

  arch(z, text, color, width = 10, y = 0, x = 0, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, y, z); group.rotation.y = rotation;
    for (const x of [-width / 2, width / 2]) {
      this.mesh(group, 'cylinder', color, [x, 2.2, 0], [0.2, 4.4, 0.2]);
      this.sphere(group, color, [x, 4.4, 0], [0.31, 0.31, 0.31]);
    }
    this.box(group, color, [0, 4.35, 0], [width, 0.26, 0.26]);
    const label = this.label(text, color, '#ffffff', 4.8);
    label.position.set(0, 4.58, 0);
    group.add(label);
    this.content.add(group);
  }

  buildCourse() {
    const course = this.course;
    this.paintingCourse = true;
    const baseColor = course.colors?.floor || '#638364';
    course.platforms.forEach((platform) => {
      const group = new THREE.Group();
      group.position.set(platform.x, platform.y ?? 0, platform.z);
      group.rotation.order = "YXZ"; group.rotation.y = platform.rotation || 0;
      if (platform.rise) { group.rotation.x = -Math.atan2(platform.rise, platform.run); group.scale.z = Math.hypot(platform.run,platform.rise)/platform.run; }
      const color = platform.color || (platform.type === 'ice' ? '#4c7a78' : platform.type === 'conveyor' ? '#8b825c' : baseColor);
      this.box(group, CAMP.wood, [0, -0.34, 0], [platform.w, 0.68, platform.d]);
      this.box(group, CAMP.edge, [0, -0.03, 0], [platform.w - 0.09, 0.065, platform.d - 0.09]);
      this.box(group, color, [0, 0.016, 0], [platform.w - 0.3, 0.035, platform.d - 0.3]);
      if (platform.type === 'ice') this.mesh(group, 'box', '#e9fbff', [0, 0.05, 0], [platform.w - 0.5, 0.018, platform.d - 0.5], { transparent: true, opacity: 0.14, roughness: 0.45 });
      if (platform.type === 'conveyor') {
        for (let z = -platform.d / 2 + 0.7; z < platform.d / 2; z += 2) {
          for (const side of [-1, 1]) this.box(group, '#f5fbff', [side * 0.25, 0.051, z], [0.1, 0.03, 0.7]).rotation.y = side * (platform.speed < 0 ? -0.65 : 0.65);
        }
      }
      if (['disappear','collapse','sink'].includes(platform.type)) this.ring(group, '#fff7d7', [0, 0.07, 0], [Math.min(platform.w, platform.d) * 0.26, Math.min(platform.w, platform.d) * 0.26, 0.65], true);
      if (['disappear','collapse','sink'].includes(platform.type)) {
        const warning = this.label('곧 사라져요!' , '#a24e28', '#fff1cf', 4.4);
        warning.position.set(0, 1.25, 0); warning.visible = false; group.add(warning);
        const bar = this.box(group, GOLD, [0, 0.1, -platform.d / 2 + 0.8], [platform.w - 1, 0.09, 0.35]);
        group.userData.warning = warning; group.userData.warningBar = bar;
      }
      if (platform.d > 10) {
        for (let z = -platform.d / 2 + 1; z < platform.d / 2; z += 3) for (const side of [-1, 1]) this.box(group, '#fff9f1', [side * (platform.w / 2 - 0.16), 0.07, z], [0.12, 0.055, 1.25]);
      }
      for (const side of [-1, 1]) {
        this.box(group, CAMP.edge, [side * (platform.w / 2 - 0.2), 0.055, 0], [0.17, 0.035, platform.d - 0.12]);
        this.box(group, CAMP.edge, [0, 0.055, side * (platform.d / 2 - 0.2)], [platform.w - 0.12, 0.035, 0.17]);
      }
      this.content.add(group);
      this.platforms.push({ data: platform, group });
    });
    for (const obstacle of course.obstacles) {
      const group = new THREE.Group();
      const { w, h, d, type } = obstacle;
      const color = obstacle.color || ({ spinner: '#b85c37', bumper: '#b85c37', gate: '#b85c37', pendulum: '#b85c37', fan: '#c5a15a', bouncer: '#c5a15a', wall: '#b85c37' })[type] || '#b85c37';
      if (type === 'spinner') {
        this.box(group, color, [0, h / 2, 0], [w, h, d]);
        this.box(group, '#fff1f6', [0, h / 2 + 0.005, 0], [Math.min(w * 0.08, 0.8), h + 0.02, d + 0.02]);
        this.mesh(group, 'cylinder', GOLD, [0, h / 2, 0], [0.46, h + 0.24, 0.46]);
        for (const x of [-w / 2, w / 2]) this.sphere(group, color, [x, h / 2, 0], [h / 2, h / 2, d / 2]);
      } else if (type === 'log') {
        const log = this.mesh(group,'cylinder',CAMP.wood,[0,h/2,0],[.6,Math.max(w,d),.6]);
        log.rotation.z = w>d ? Math.PI/2 : 0; log.rotation.x = w>d ? 0 : Math.PI/2;
        for(const side of [-1,1]) this.sphere(group,CAMP.trim,[w>d?side*w/2:0,h/2,w>d?0:side*d/2],[.63,.63,.63]);
      } else if (type === 'bumper' || type === 'pendulum') {
        if (type === 'bumper') this.mesh(group, 'cylinder', color, [0, h / 2, 0], [w / 2, h, d / 2]);
        else this.sphere(group, color, [0, h / 2, 0], [w / 2, h / 2, d / 2]);
        this.ring(group, '#fff7e8', [0, h / 2, 0], [w / 2, d / 2, Math.max(0.5, h * 0.28)], true);
        if (type === 'pendulum') this.mesh(group, 'cylinder', '#eeeaff', [0, h + 1.7, 0], [0.05, 3.4, 0.05]);
      } else if (type === 'bouncer') {
        this.mesh(group, 'cylinder', color, [0, h / 2, 0], [w / 2, h, d / 2]);
        this.mesh(group, 'cylinder', '#e8fff1', [0, h + 0.015, 0], [w * 0.37, 0.04, d * 0.37]);
        this.ring(group, WHITE, [0, h + 0.06, 0], [w * 0.42, d * 0.42, 0.6], true);
      } else if (type === 'fan') {
        // fan의 w/d/h는 충돌 벽이 아니라 바람이 부는 영역이다.
        this.mesh(group, 'box', '#dcffff', [0, 0.09, 0], [w, 0.045, d], { transparent: true, opacity: 0.25, depthWrite: false });
        const machine = new THREE.Group();
        const direction = Math.sign(obstacle.force || 1);
        machine.position.set(obstacle.axis === 'x' ? -direction * (w / 2 + 1.4) : 0, 1.8, obstacle.axis === 'z' ? -direction * (d / 2 + 1.4) : 0);
        machine.rotation.y = obstacle.axis === 'x' ? direction * Math.PI / 2 : direction < 0 ? Math.PI : 0;
        group.add(machine);
        this.box(machine, color, [0, 0, 0], [3.2, 3.2, 1.2]);
        this.ring(machine, '#f5fffe', [0, 0, 0.625], [1.25, 1.25, 0.65]);
        const blades = new THREE.Group();
        blades.position.set(0, 0, 0.66);
        machine.add(blades);
        for (let i = 0; i < 4; i++) {
          const blade = this.box(blades, '#e8fff4', [0, 0, 0], [2.1, 0.27, 0.09]);
          blade.rotation.z = i * Math.PI / 2;
        }
        this.sphere(blades, GOLD, [0, 0, 0.02], [0.13, 0.13, 0.06]);
        group.userData.blades = blades;
        const wind = new THREE.Group();
        group.add(wind);
        for (let i = 0; i < 9; i++) {
          const streak = this.mesh(wind, 'box', '#efffff', [0, 0.9 + (i % 3) * 0.72, 0], obstacle.axis === 'x' ? [1.1, 0.035, 0.055] : [0.055, 0.035, 1.1], { transparent: true, opacity: 0.52, depthWrite: false });
          streak.castShadow = false;
        }
        group.userData.wind = wind;
      } else {
        this.box(group, color, [0, h / 2, 0], [w, h, d]);
        for (let x = -w / 2 + 0.4; x < w / 2; x += 1.2) this.box(group, '#ede7ff', [x, h / 2, -d / 2 - 0.006], [0.13, h * 0.75, 0.025]);
        this.box(group, '#fff5da', [0, h - 0.12, 0], [w + 0.08, 0.17, d + 0.04]);
      }
      if(type==='crusher') {
        const warning=this.label('압축기 주의!',CAMP.hazard,WHITE,4.8); warning.position.set(0,4.5,0); warning.visible=false;
        this.content.add(warning); group.userData.warning=warning;
        for(const side of [-1,1]) this.box(this.content,CAMP.wood,[obstacle.x+side*(w/2+.35),3,obstacle.z],[.3,6,.3]);
      }
      if(type==='bouncer' && (obstacle.pushX || obstacle.pushZ)) {
        const arrow=this.label('↟',CAMP.helper,INK,1.6); arrow.position.set(0,1.4,0); group.add(arrow);
      }
      this.content.add(group);
      this.obstacles.push({ data: obstacle, group });
    }
    for (const [i,checkpoint] of course.checkpoints.entries()) {
      const before=course.path[i] || {x:checkpoint.x,z:checkpoint.z-1};
      this.arch(checkpoint.z,'⚑ '+(i+1),'#344839',8,checkpoint.y,checkpoint.x,Math.atan2(checkpoint.x-before.x,checkpoint.z-before.z));
      this.ring(this.content,CAMP.helper,[checkpoint.x,checkpoint.y+.08,checkpoint.z],[3,3,.45],true);
    }
    const finish=course.finish;
    if(finish) {
      const previous=course.path.at(-2)||{x:finish.x,z:finish.z-1};
      const rotation=Math.atan2(finish.x-previous.x,finish.z-previous.z);
      this.arch(finish.z,'FINISH!',CAMP.edge,8,finish.y,finish.x,rotation);
      const mat=new THREE.Group(); mat.position.set(finish.x,finish.y+.05,finish.z); mat.rotation.y=rotation; this.content.add(mat);
      for(let i=0;i<8;i++) for(let j=0;j<2;j++) this.box(mat,(i+j)%2?CAMP.trim:CAMP.edge,[i-3.5,0,j*.7-.35],[1,.04,.7]);
    } else {
      this.box(this.content,'#416d62',[0,-4,6],[110,.15,110]);
    }
    for(let i=0;i<course.path.length;i++) {
      const n=course.path[i];
      for(const side of [-1,1]) this.tree(n.x+side*18,-5,n.z,1.5);
    }
    this.finishY=finish?.y||0;
    this.nextFlag=this.label('다음 깃발',CAMP.helper,INK,4);
    this.nextFlag.visible=false; this.content.add(this.nextFlag);
    this.confetti = new THREE.Group();
    this.content.add(this.confetti);
    const confettiColors = ['#b85c37', '#ffcf54', '#61dfba', '#638364'];
    for (let i = 0; i < 36; i++) {
      const piece = this.box(this.confetti, confettiColors[i % 4], [0, 0, 0], [0.12, 0.21, 0.04]);
      piece.castShadow = false;
    }
    this.confetti.visible = false;
    this.paintingCourse = false;
  }

  setPlayers(rosterArray) {
    this.roster = rosterArray || [];
    if (this.mode !== 'race') return;
    const ids = new Set(this.roster.map(player => player.id));
    for (const [id, player] of this.players) if (!ids.has(id)) {
      player.group.traverse(object => {
        if (object.isSprite) { object.material.map?.dispose(); object.material.dispose(); }
      });
      this.content.remove(player.group);
      this.players.delete(id);
    }
    for (const player of this.roster) {
      const existing = this.players.get(player.id);
      if (existing && existing.character === player.character && existing.color === player.color && existing.name === player.name) continue;
      if (existing) {
        existing.group.traverse(object => { if (object.isSprite) { object.material.map?.dispose(); object.material.dispose(); } });
        this.content.remove(existing.group);
      }
      const group = this.avatar(player.character, player.color);
      const name = this.playerLabel(player.name + (player.id === this.playerId ? ' · 나' : ''), player.id === this.playerId);
      name.position.y = new THREE.Box3().setFromObject(group).max.y + 0.55;
      group.add(name);
      group.visible = false;
      this.content.add(group);
      this.players.set(player.id, { ...player, group, label: name, current: null, target: existing?.target || null });
    }
  }

  updateState(state) {
    if (!state) return;
    if(this.course) this.course.collapsed = state.collapsed || {};
    const ids=new Set((state.players||[]).map(p=>p.id));
    for(const [id,p] of this.players) if(!ids.has(id)) { p.group.visible=false; p.target=null; p.current=null; }
    this.stateTime = Number.isFinite(state.time) ? state.time : this.stateTime;
    this.stateReceived = performance.now();
    for (const player of state.players || []) {
      const rendered = this.players.get(player.id);
      if (!rendered) continue;
      rendered.target = player;
      rendered.group.visible = !player.eliminated;
      if (!rendered.current || Math.abs(rendered.current.z - player.z) > 15 || Math.abs(rendered.current.y - player.y) > 12) {
        rendered.current = { x: player.x, y: player.y, z: player.z, yaw: player.yaw || 0 };
        rendered.group.position.set(player.x, player.y, player.z);
      }
    }
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.mode === 'preview') this.previewCamera();
  }

  animate(now) {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.06);
    this.lastFrame = now;
    const t = now / 1000;
    if (this.mode === 'preview') {
      for (const item of this.previewCharacters) {
        item.model.position.y = item.y + Math.sin(t * 1.8 + item.phase) * 0.047;
        item.model.userData.body.rotation.z = Math.sin(t * 1.4 + item.phase) * 0.022;
        if (item.lead) item.model.userData.rightArm.rotation.z = 0.48 + Math.sin(t * 2.1) * 0.16;
      }
      for (const item of this.decorations) {
        item.mesh.position.y = item.baseY + Math.sin(t + item.phase) * 0.12;
        if (item.spin) item.mesh.rotation.y += dt * 0.32;
      }
    } else if (this.course) {
      const elapsed = Math.min((now - this.stateReceived) / 1000, 0.2);
      const serverTime = this.stateTime + elapsed;
      for (const { data, group } of this.obstacles) {
        const pose = obstaclePose(data, serverTime);
        group.position.set(pose.x, pose.y ?? data.y ?? 0, pose.z);
        group.rotation.y = pose.rotation || 0;
        group.visible = pose.active !== false;
        if(group.userData.warning) { group.userData.warning.visible=pose.warning; group.userData.warning.position.set(pose.x,4.5,pose.z); }
        if (group.userData.blades) group.userData.blades.rotation.z = t * 12;
        if (group.userData.wind) group.userData.wind.children.forEach((streak, i) => {
          const along = ((t * Math.sign(data.force) * 4 + i * 1.73) % 1 + 1) % 1 - 0.5;
          streak.position.x = data.axis === 'x' ? along * data.w : ((i % 3) - 1) * data.w * 0.27;
          streak.position.z = data.axis === 'x' ? ((i % 3) - 1) * data.d * 0.27 : along * data.d;
        });
      }
      for (const { data, group } of this.platforms) {
        const pose=platformPose(data,serverTime); group.position.set(pose.x,pose.y,pose.z);
        if (['disappear','collapse','sink'].includes(data.type)) {
          const timing = platformTiming(data, serverTime, this.course.collapsed);
          group.visible = timing.active;
          if (group.userData.warning) {
            group.userData.warning.visible = timing.warning;
            group.userData.warningBar.scale.x = (data.w - 1) * Math.max(0.01, Math.min(1, timing.remaining));
            group.userData.warningBar.visible = timing.warning;
          }
        }
      }
      const alpha = 1 - Math.exp(-16 * dt);
      for (const player of this.players.values()) {
        if (!player.target || !player.current) continue;
        const target = player.target, current = player.current;
        const extrapolate = !target.finished && !target.eliminated && !target.bumpTime && elapsed < 0.16 ? elapsed : 0;
        current.x += (target.x + (target.vx || 0) * extrapolate - current.x) * alpha;
        current.y += (target.y + (target.vy || 0) * extrapolate - current.y) * alpha;
        current.z += (target.z + (target.vz || 0) * extrapolate - current.z) * alpha;
        const angle = Math.atan2(Math.sin((target.yaw || 0) - current.yaw), Math.cos((target.yaw || 0) - current.yaw));
        current.yaw += angle * alpha;
        player.group.position.set(current.x, current.y, current.z);
        const rig = player.group.userData;
        rig.body.rotation.y = current.yaw;
        const speed = Math.hypot(target.vx || 0, target.vz || 0);
        const running = target.grounded && speed > 0.3;
        const stride = running ? Math.sin(t * 13 + current.z * 0.2) * Math.min(speed / 9, 0.65) : 0;
        rig.leftFoot.position.z = 0.12 + stride * 0.27;
        rig.rightFoot.position.z = 0.12 - stride * 0.27;
        rig.leftFoot.position.y = 0.19 + Math.max(0, stride) * 0.14;
        rig.rightFoot.position.y = 0.19 + Math.max(0, -stride) * 0.14;
        rig.leftArm.rotation.x = stride;
        rig.rightArm.rotation.x = -stride;
        rig.body.position.y = running ? Math.abs(stride) * 0.07 : 0;
        rig.body.rotation.x = !target.grounded && target.diveCooldown > 0.85 ? -0.65 : 0;
        rig.body.rotation.z = target.finished ? Math.sin(t * 5) * 0.08 : target.bumpTime > 0 ? Math.sin(t * 40) * target.bumpTime * 0.9 : 0;
        rig.leftArm.rotation.z = target.finished ? -2.25 : target.grounded ? -0.25 : -1.05;
        rig.rightArm.rotation.z = target.finished ? 2.25 : target.grounded ? 0.25 : 1.05;
      }
      const local = this.players.get(this.followId || this.playerId);
      if (Date.now() < this.introEnd) {
        const progress = Math.max(0, Math.min(1, (Date.now() - this.introStart) / 3000));
        const along=matchMedia('(prefers-reduced-motion: reduce)').matches?0:progress*(this.course.path.length-1);
        const index=Math.floor(along), a=this.course.path[index], b=this.course.path[Math.min(index+1,this.course.path.length-1)], fraction=along-index;
        const point={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,z:a.z+(b.z-a.z)*fraction};
        this.camera.position.set(point.x,point.y+30,point.z-22); this.camera.lookAt(point.x,point.y,point.z);
        this.sun.position.set(point.x-16,point.y+28,point.z+13); this.sun.target.position.set(point.x,point.y,point.z);
        this.cameraReady = false;
      } else if (local?.current) {
        const point = local.current;
        const y = Math.max(-0.5, point.y);
        const desired = new THREE.Vector3(point.x, y + 18, point.z - 15);
        if (!this.cameraReady) { this.camera.position.copy(desired); this.cameraReady = true; }
        this.camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
        this.camera.lookAt(point.x, y + .8, point.z + 1);
        this.sun.position.set(point.x - 16, 28, point.z + 13);
        this.sun.target.position.set(point.x, 0, point.z + 12);
        const next=this.course.checkpoints[(local.target?.checkpoint??-1)+1] || this.course.finish;
        this.nextFlag.visible=!!next && !local.target?.finished && !local.target?.eliminated;
        if(next) this.nextFlag.position.set(next.x,next.y+5.7+Math.sin(t*3)*.2,next.z);
        if (this.confetti) this.confetti.visible = !!local.target?.finished;
        if (local.target?.finished && this.confetti) {
          this.confetti.children.forEach((piece, i) => {
            piece.position.set((this.course.finish?.x||0) + Math.sin(i * 4.71) * 5, this.finishY + 1 + ((i * 0.43 - t * 1.5) % 6 + 6) % 6, this.course.finishZ + Math.cos(i * 5.41) * 3);
            piece.rotation.set(t + i, t * 0.7 + i, t * 1.1 + i);
          });
        }
      }
      for (const player of this.players.values()) {
        const distance = this.camera.position.distanceTo(player.group.position);
        const own = player.id === this.playerId, watching = player.id === this.followId;
        const height = (own || watching ? 32 : 24) * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * distance / Math.max(1, this.canvas.clientHeight);
        player.label.scale.set(height * player.label.userData.aspect, height, 1);
        player.label.visible = own || watching || distance < 52;
      }
    }
    if (this.canvas.clientWidth && this.canvas.clientHeight) this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clearContent();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.renderer.dispose();
  }
}
