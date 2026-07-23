import * as THREE from "../vendor/three/three.module.min.js?v=0.185.1";
import { OrbitControls } from "../vendor/three/OrbitControls.js?v=0.185.1-1";

const TAU = Math.PI * 2;

const BIOME_COLORS = {
  water: 0x0d4852,
  meadow: 0x315e43,
  forest: 0x173d31,
  wetland: 0x285458,
  rock: 0x596365,
  desert: 0x8d7448,
  snow: 0xb6cfce
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hash(index, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry && !child.userData.sharedGeometry) child.geometry.dispose();
    if (child.material && !child.userData.sharedMaterial) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

function createLineGeometry(points) {
  const positions = [];
  for (const [from, to] of points) {
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class Aquarium3D {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.simWidth = options.simWidth || 1200;
    this.simDepth = options.simDepth || 750;
    this.simHeight = options.simHeight || 420;
    this.worldWidth = options.worldWidth || 48;
    this.worldDepth = options.worldDepth || 30;
    this.worldHeight = options.worldHeight || 18;
    this.terrainCols = options.terrainCols || 50;
    this.terrainRows = options.terrainRows || 31;
    this.time = 0;
    this.width = 1;
    this.height = 1;
    this.entityObjects = new Map();
    this.pickables = [];
    this.fireObjects = [];
    this.effects = [];
    this.plants = [];
    this.terrain = [];
    this.currentState = null;
    this.currentSelection = null;
    this.floorMesh = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(1.6, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04151c);
    this.scene.fog = new THREE.FogExp2(0x0b3540, 0.016);

    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 180);
    this.camera.position.set(39, 24, 36);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.set(0, 6.2, 0);
    this.controls.minDistance = 19;
    this.controls.maxDistance = 78;
    this.controls.minPolarAngle = 0.22;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.35);

    this.environmentGroup = new THREE.Group();
    this.creatureGroup = new THREE.Group();
    this.fireGroup = new THREE.Group();
    this.scene.add(this.environmentGroup, this.creatureGroup, this.fireGroup);

    this.shared = this.createSharedGeometry();
    this.createLights();
    this.createTank();
    this.createWaterSurface();
    this.createBubbles();
    this.createEffectField();
  }

  createSharedGeometry() {
    const warpGeometry = (geometry, transform) => {
      const position = geometry.getAttribute("position");
      const point = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        transform(point, index);
        position.setXYZ(index, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    };

    const amoebaBody = warpGeometry(new THREE.IcosahedronGeometry(1, 3), (point) => {
      const direction = point.clone().normalize();
      const ripple =
        Math.sin(direction.x * 4.2 + direction.y * 1.7) * 0.12 +
        Math.cos(direction.z * 4.8 - direction.x * 1.4) * 0.08;
      point.copy(direction.multiplyScalar(0.98 + ripple));
      point.x *= 1.08;
      point.y *= 0.78;
      point.z *= 0.94;
    });

    const ciliateBody = warpGeometry(new THREE.SphereGeometry(1, 22, 14), (point) => {
      const originalX = point.x;
      const taper = 0.78 + (1 - Math.abs(originalX)) * 0.22;
      point.x = originalX * 1.58 + 0.12 * (1 - originalX * originalX);
      point.y *= 0.57 * taper;
      point.z *= 0.68 * taper;
    });

    const flagellateBody = warpGeometry(new THREE.SphereGeometry(1, 20, 13), (point) => {
      const originalX = point.x;
      const tailTaper = originalX < 0 ? 0.48 + (originalX + 1) * 0.52 : 1;
      point.x = originalX * 1.42 + 0.16;
      point.y *= 0.66 * tailTaper;
      point.z *= 0.7 * tailTaper;
    });

    const radiolarianBody = warpGeometry(new THREE.IcosahedronGeometry(0.92, 2), (point) => {
      const direction = point.clone().normalize();
      const faceting = 0.96 + Math.sin(direction.x * 7 + direction.y * 5 - direction.z * 6) * 0.055;
      point.copy(direction.multiplyScalar(faceting));
    });

    const trilobiteBody = warpGeometry(new THREE.SphereGeometry(1, 20, 12), (point) => {
      point.x *= 1.52;
      point.y *= 0.42 + Math.max(0, 1 - Math.abs(point.x) / 1.52) * 0.12;
      point.z *= 0.78;
      if (point.x > 0.72) point.y *= 1.18;
    });

    const ciliateCilia = [];
    for (let ring = 0; ring < 3; ring += 1) {
      const x = -0.92 + ring * 0.92;
      for (let index = 0; index < 14; index += 1) {
        const angle = index / 14 * TAU;
        const y = Math.cos(angle) * 0.58;
        const z = Math.sin(angle) * 0.69;
        ciliateCilia.push([
          new THREE.Vector3(x, y, z),
          new THREE.Vector3(x, y * 1.23, z * 1.2)
        ]);
      }
    }

    const flagella = [];
    for (const side of [-1, 1]) {
      let previous = new THREE.Vector3(-1.1, side * 0.12, side * 0.2);
      for (let index = 1; index <= 18; index += 1) {
        const progress = index / 18;
        const next = new THREE.Vector3(
          -1.05 - progress * 2.65,
          side * (0.12 + Math.sin(progress * Math.PI * 3) * 0.22),
          side * 0.18 + Math.sin(progress * Math.PI * 4 + side) * 0.22
        );
        flagella.push([previous, next]);
        previous = next;
      }
    }

    const radiolarianSpikes = [];
    for (let index = 0; index < 28; index += 1) {
      const y = 1 - index / 27 * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = index * 2.399963229728653;
      const direction = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      radiolarianSpikes.push([
        direction.clone().multiplyScalar(0.82),
        direction.clone().multiplyScalar(1.72 + hash(index, 204) * 0.26)
      ]);
    }

    const predatorRibs = [];
    for (let index = 0; index < 7; index += 1) {
      const x = -1.02 + index * 0.31;
      const width = 0.6 - Math.abs(index - 3) * 0.035;
      predatorRibs.push([
        new THREE.Vector3(x, -width, 0.06),
        new THREE.Vector3(x, width, 0.06)
      ]);
    }
    predatorRibs.push(
      [new THREE.Vector3(-1.2, 0, 0.02), new THREE.Vector3(1.34, 0, 0.02)],
      [new THREE.Vector3(1.05, -0.22, 0), new THREE.Vector3(1.55, -0.42, 0.08)],
      [new THREE.Vector3(1.05, 0.22, 0), new THREE.Vector3(1.55, 0.42, 0.08)]
    );

    return {
      amoebaBody,
      ciliateBody,
      flagellateBody,
      radiolarianBody,
      trilobiteBody,
      alienLobe: new THREE.IcosahedronGeometry(0.48, 1),
      nucleus: new THREE.SphereGeometry(0.32, 12, 8),
      ciliateCilia: createLineGeometry(ciliateCilia),
      flagella: createLineGeometry(flagella),
      radiolarianSpikes: createLineGeometry(radiolarianSpikes),
      predatorRibs: createLineGeometry(predatorRibs),
      mandible: new THREE.ConeGeometry(0.12, 0.68, 7),
      halo: new THREE.TorusGeometry(1.48, 0.035, 7, 42),
      trail: new THREE.ConeGeometry(0.44, 2.4, 10, 1, true),
      bubble: new THREE.SphereGeometry(0.07, 7, 5),
      plantStem: new THREE.CylinderGeometry(0.035, 0.085, 1, 5),
      plantCrown: new THREE.SphereGeometry(0.2, 7, 5),
      rock: new THREE.DodecahedronGeometry(0.72, 0),
      fireCore: new THREE.SphereGeometry(0.45, 10, 7)
    };
  }

  markShared(mesh) {
    mesh.userData.sharedGeometry = true;
    return mesh;
  }

  createLights() {
    this.ambientLight = new THREE.HemisphereLight(0x9fe9de, 0x09242a, 1.45);
    this.topLight = new THREE.DirectionalLight(0xe6fff2, 3.2);
    this.topLight.position.set(-8, 28, 10);
    this.rimLight = new THREE.PointLight(0x4cc9d8, 22, 65, 2);
    this.rimLight.position.set(18, 12, -12);
    this.warmLight = new THREE.PointLight(0xffd08a, 10, 48, 2);
    this.warmLight.position.set(-18, 7, 10);
    this.scene.add(this.ambientLight, this.topLight, this.rimLight, this.warmLight);
  }

  createTank() {
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x78d7dd,
      transparent: true,
      opacity: 0.075,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const backMaterial = glassMaterial.clone();
    backMaterial.opacity = 0.105;

    const back = new THREE.Mesh(new THREE.PlaneGeometry(this.worldWidth, this.worldHeight), backMaterial);
    back.position.set(0, this.worldHeight * 0.5, -this.worldDepth * 0.5);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(this.worldDepth, this.worldHeight), glassMaterial);
    left.position.set(-this.worldWidth * 0.5, this.worldHeight * 0.5, 0);
    left.rotation.y = Math.PI * 0.5;
    const right = left.clone();
    right.position.x = this.worldWidth * 0.5;
    const bottomGlass = new THREE.Mesh(new THREE.PlaneGeometry(this.worldWidth, this.worldDepth), glassMaterial);
    bottomGlass.rotation.x = -Math.PI * 0.5;
    bottomGlass.position.y = 0;

    const frameGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(this.worldWidth, this.worldHeight, this.worldDepth));
    const frame = new THREE.LineSegments(frameGeometry, new THREE.LineBasicMaterial({
      color: 0x86d6d0,
      transparent: true,
      opacity: 0.28
    }));
    frame.position.y = this.worldHeight * 0.5;

    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(this.worldWidth + 1.2, 0.7, this.worldDepth + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x061116, roughness: 0.66, metalness: 0.2 })
    );
    pedestal.position.y = -0.55;

    this.scene.add(back, left, right, bottomGlass, frame, pedestal);
    this.glassMeshes = [back, left, right, bottomGlass];
  }

  createWaterSurface() {
    const geometry = new THREE.PlaneGeometry(this.worldWidth, this.worldDepth, 42, 28);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x68cdd1) },
        uOpacity: { value: 0.16 }
      },
      vertexShader: `
        uniform float uTime;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 transformed = position;
          float wave = sin(position.x * 0.58 + uTime * 0.9) * 0.13;
          wave += cos(position.y * 0.74 - uTime * 0.72) * 0.09;
          transformed.z += wave;
          vWave = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          float edge = pow(abs(vUv.x - 0.5) * 2.0, 2.0) + pow(abs(vUv.y - 0.5) * 2.0, 2.0);
          float shimmer = 0.42 + vWave * 1.8;
          gl_FragColor = vec4(uColor * (0.72 + shimmer * 0.32), uOpacity + edge * 0.035);
        }
      `
    });
    this.waterSurface = new THREE.Mesh(geometry, material);
    this.waterSurface.rotation.x = -Math.PI * 0.5;
    this.waterSurface.position.y = this.worldHeight - 0.25;
    this.scene.add(this.waterSurface);

    this.lightShafts = [];
    const shaftMaterial = new THREE.MeshBasicMaterial({
      color: 0x9eeed5,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    for (let index = 0; index < 5; index += 1) {
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(2.6 + index * 0.34, 20, 18, 1, true), shaftMaterial);
      shaft.position.set(-15 + index * 7.5, 8.5, -4 + hash(index, 3) * 9);
      shaft.rotation.z = (hash(index, 4) - 0.5) * 0.13;
      this.scene.add(shaft);
      this.lightShafts.push(shaft);
    }
  }

  createBubbles() {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xb9f6f1,
      transparent: true,
      opacity: 0.34,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      depthWrite: false
    });
    this.bubbleMesh = new THREE.InstancedMesh(this.shared.bubble, material, 92);
    this.bubbleMesh.userData.sharedGeometry = true;
    this.bubbleData = [];
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 92; index += 1) {
      const bubble = {
        x: (hash(index, 11) - 0.5) * this.worldWidth * 0.9,
        z: (hash(index, 12) - 0.5) * this.worldDepth * 0.9,
        y: hash(index, 13) * this.worldHeight,
        speed: 0.24 + hash(index, 14) * 0.62,
        scale: 0.45 + hash(index, 15) * 1.55,
        phase: hash(index, 16) * TAU
      };
      this.bubbleData.push(bubble);
      matrix.makeScale(bubble.scale, bubble.scale, bubble.scale);
      matrix.setPosition(bubble.x, bubble.y, bubble.z);
      this.bubbleMesh.setMatrixAt(index, matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bubbleMesh);
  }

  createEffectField() {
    this.effectCapacity = 280;
    const positions = new Float32Array(this.effectCapacity * 3);
    const colors = new Float32Array(this.effectCapacity * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      size: 0.19,
      transparent: true,
      opacity: 0.82,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.effectPoints = new THREE.Points(geometry, material);
    this.scene.add(this.effectPoints);
  }

  simToWorld(x, depth, height = 0) {
    return new THREE.Vector3(
      (x / this.simWidth - 0.5) * this.worldWidth,
      0.55 + clamp(height / this.simHeight, 0, 1) * (this.worldHeight - 1.4),
      (depth / this.simDepth - 0.5) * this.worldDepth
    );
  }

  worldToSim(position) {
    return {
      x: clamp((position.x / this.worldWidth + 0.5) * this.simWidth, 0, this.simWidth),
      y: clamp((position.z / this.worldDepth + 0.5) * this.simDepth, 0, this.simDepth),
      z: clamp((position.y - 0.55) / (this.worldHeight - 1.4) * this.simHeight, 0, this.simHeight)
    };
  }

  terrainCellAt(x, depth) {
    if (!this.terrain.length) return null;
    const column = clamp(Math.floor(x / this.simWidth * this.terrainCols), 0, this.terrainCols - 1);
    const row = clamp(Math.floor(depth / this.simDepth * this.terrainRows), 0, this.terrainRows - 1);
    return this.terrain[row * this.terrainCols + column] || null;
  }

  floorHeightAt(x, depth) {
    const cell = this.terrainCellAt(x, depth);
    if (!cell) return 0.34;
    const typeLift = { rock: 0.46, forest: 0.28, wetland: 0.18, desert: 0.12, snow: 0.22, meadow: 0.16, water: 0 }[cell.type] || 0;
    return 0.22 + typeLift + cell.variation * 0.28;
  }

  rebuildEnvironment(terrain) {
    this.terrain = Array.isArray(terrain) ? terrain : [];
    while (this.environmentGroup.children.length) {
      const child = this.environmentGroup.children.pop();
      disposeObject(child);
    }
    this.plants.length = 0;

    const geometry = new THREE.PlaneGeometry(this.worldWidth, this.worldDepth, this.terrainCols - 1, this.terrainRows - 1);
    const positions = geometry.attributes.position;
    const colors = [];
    for (let index = 0; index < positions.count; index += 1) {
      const worldX = positions.getX(index);
      const worldZ = -positions.getY(index);
      const simX = (worldX / this.worldWidth + 0.5) * this.simWidth;
      const simDepth = (worldZ / this.worldDepth + 0.5) * this.simDepth;
      const cell = this.terrainCellAt(simX, simDepth);
      const lift = this.floorHeightAt(simX, simDepth);
      positions.setZ(index, lift);
      const base = new THREE.Color(BIOME_COLORS[cell?.type] || BIOME_COLORS.water);
      const variation = (cell?.variation || 0.5) - 0.5;
      base.offsetHSL(variation * 0.025, variation * 0.06, variation * 0.08);
      colors.push(base.r, base.g, base.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const floorMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false
    });
    this.floorMesh = new THREE.Mesh(geometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI * 0.5;
    this.floorMesh.userData.isAquariumFloor = true;
    this.environmentGroup.add(this.floorMesh);

    const rockCells = this.terrain.filter((cell) => (cell.type === "rock" || cell.type === "desert") && cell.variation > 0.5).slice(0, 78);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x66716f, roughness: 0.9, metalness: 0.04 });
    const rockMesh = new THREE.InstancedMesh(this.shared.rock, rockMaterial, Math.max(1, rockCells.length));
    rockMesh.userData.sharedGeometry = true;
    const rockMatrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < rockCells.length; index += 1) {
      const cell = rockCells[index];
      const world = this.simToWorld(cell.x, cell.y, 0);
      world.y = this.floorHeightAt(cell.x, cell.y) + 0.2;
      rotation.setFromEuler(new THREE.Euler(hash(index, 24) * TAU, hash(index, 25) * TAU, hash(index, 26) * TAU));
      const size = 0.42 + cell.variation * 0.82;
      scale.set(size * (0.75 + hash(index, 27) * 0.8), size, size * (0.7 + hash(index, 28) * 0.75));
      rockMatrix.compose(world, rotation, scale);
      rockMesh.setMatrixAt(index, rockMatrix);
    }
    rockMesh.count = rockCells.length;
    rockMesh.instanceMatrix.needsUpdate = true;
    this.environmentGroup.add(rockMesh);

    const plantCells = this.terrain.filter((cell) =>
      (cell.type === "forest" || cell.type === "meadow" || cell.type === "wetland") &&
      cell.variation > 0.42 &&
      cell.food > 6
    ).slice(0, 150);
    const stemMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f9d67,
      roughness: 0.72,
      transparent: true,
      opacity: 0.9
    });
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0x83c679,
      roughness: 0.62,
      emissive: 0x17351f,
      emissiveIntensity: 0.4
    });
    this.plantStemMesh = new THREE.InstancedMesh(this.shared.plantStem, stemMaterial, Math.max(1, plantCells.length));
    this.plantCrownMesh = new THREE.InstancedMesh(this.shared.plantCrown, crownMaterial, Math.max(1, plantCells.length));
    this.plantStemMesh.userData.sharedGeometry = true;
    this.plantCrownMesh.userData.sharedGeometry = true;
    for (let index = 0; index < plantCells.length; index += 1) {
      const cell = plantCells[index];
      this.plants.push({
        x: cell.x + (hash(index, 32) - 0.5) * 14,
        depth: cell.y + (hash(index, 33) - 0.5) * 14,
        height: 0.9 + cell.variation * 2.6,
        phase: hash(index, 34) * TAU,
        index
      });
    }
    this.plantStemMesh.count = plantCells.length;
    this.plantCrownMesh.count = plantCells.length;
    this.environmentGroup.add(this.plantStemMesh, this.plantCrownMesh);
    this.updatePlants(0);

    const matCells = this.terrain.filter((cell) => cell.type === "wetland" || cell.type === "meadow");
    const matPositions = [];
    const matColors = [];
    for (let index = 0; index < Math.min(420, matCells.length * 2); index += 1) {
      const cell = matCells[index % matCells.length];
      if (!cell) break;
      const x = cell.x + (hash(index, 35) - 0.5) * 22;
      const depth = cell.y + (hash(index, 36) - 0.5) * 22;
      const world = this.simToWorld(x, depth, 0);
      world.y = this.floorHeightAt(x, depth) + 0.08 + hash(index, 37) * 0.12;
      matPositions.push(world.x, world.y, world.z);
      const color = new THREE.Color(cell.type === "wetland" ? 0x68c8a2 : 0x9ac76c);
      color.offsetHSL(hash(index, 38) * 0.04, 0, hash(index, 39) * 0.08);
      matColors.push(color.r, color.g, color.b);
    }
    const matGeometry = new THREE.BufferGeometry();
    matGeometry.setAttribute("position", new THREE.Float32BufferAttribute(matPositions, 3));
    matGeometry.setAttribute("color", new THREE.Float32BufferAttribute(matColors, 3));
    const matPoints = new THREE.Points(matGeometry, new THREE.PointsMaterial({
      size: 0.11,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true
    }));
    this.environmentGroup.add(matPoints);
  }

  updatePlants(time) {
    if (!this.plantStemMesh || !this.plantCrownMesh) return;
    const stemMatrix = new THREE.Matrix4();
    const crownMatrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const plant of this.plants) {
      const world = this.simToWorld(plant.x, plant.depth, 0);
      const floor = this.floorHeightAt(plant.x, plant.depth);
      const sway = Math.sin(time * 0.65 + plant.phase) * 0.13;
      quaternion.setFromEuler(new THREE.Euler(sway, 0, sway * 0.5));
      scale.set(1, plant.height, 1);
      world.y = floor + plant.height * 0.5;
      stemMatrix.compose(world, quaternion, scale);
      this.plantStemMesh.setMatrixAt(plant.index, stemMatrix);

      const crownPosition = world.clone();
      crownPosition.y = floor + plant.height + 0.04;
      crownPosition.x += sway * plant.height * 0.45;
      scale.set(1.2 + plant.height * 0.08, 0.62, 1);
      crownMatrix.compose(crownPosition, quaternion, scale);
      this.plantCrownMesh.setMatrixAt(plant.index, crownMatrix);
    }
    this.plantStemMesh.instanceMatrix.needsUpdate = true;
    this.plantCrownMesh.instanceMatrix.needsUpdate = true;
  }

  coatColor(entity) {
    const coat = entity.displayCoat || entity.coat || { hue: 140, saturation: 55, lightness: 55 };
    const color = new THREE.Color();
    color.setHSL(
      (((Number(coat.hue) || 0) % 360) + 360) % 360 / 360,
      clamp((Number(coat.saturation) || 0) / 100, 0, 1),
      clamp((Number(coat.lightness) || 50) / 100, 0.08, 0.9),
      THREE.SRGBColorSpace
    );
    return color;
  }

  createCreatureMaterial(entity) {
    const color = this.coatColor(entity);
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: entity.kind === "predator" ? 0.3 : 0.44,
      metalness: entity.kind === "predator" ? 0.08 : 0,
      clearcoat: entity.kind === "predator" ? 0.65 : 0.92,
      clearcoatRoughness: 0.22,
      transparent: true,
      opacity: entity.kind === "predator" ? 0.92 : 0.8,
      emissive: color.clone().multiplyScalar(entity.kind === "alien" ? 0.16 : 0.08),
      emissiveIntensity: 0.65
    });
  }

  createEntityObject(entity) {
    const group = new THREE.Group();
    group.userData.entityId = entity.id;
    group.userData.kind = entity.kind;
    const morphology = entity.morphology || (entity.kind === "grazer" ? "ciliate" : entity.kind === "predator" ? "trilobite" : "amoeba");
    group.userData.morphology = morphology;
    const bodyMaterial = this.createCreatureMaterial(entity);

    const bodyGeometry = {
      amoeba: this.shared.amoebaBody,
      ciliate: this.shared.ciliateBody,
      flagellate: this.shared.flagellateBody,
      radiolarian: this.shared.radiolarianBody,
      trilobite: this.shared.trilobiteBody
    }[morphology] || this.shared.amoebaBody;
    const body = this.markShared(new THREE.Mesh(bodyGeometry, bodyMaterial));
    body.userData.entityId = entity.id;
    group.add(body);
    group.userData.body = body;

    if (morphology === "amoeba") {
      group.userData.lobes = [];
      for (let index = 0; index < 4; index += 1) {
        const lobe = this.markShared(new THREE.Mesh(this.shared.alienLobe, bodyMaterial));
        lobe.userData.entityId = entity.id;
        lobe.position.set(Math.cos(index / 4 * TAU) * 0.72, Math.sin(index / 4 * TAU) * 0.38, (index - 1.5) * 0.13);
        group.add(lobe);
        group.userData.lobes.push(lobe);
      }
    } else if (morphology === "ciliate") {
      const detailMaterial = new THREE.LineBasicMaterial({
        color: this.coatColor(entity).offsetHSL(0, -0.08, 0.24),
        transparent: true,
        opacity: 0.68
      });
      const cilia = this.markShared(new THREE.LineSegments(this.shared.ciliateCilia, detailMaterial));
      cilia.userData.entityId = entity.id;
      group.add(cilia);
      group.userData.cilia = cilia;
    } else if (morphology === "flagellate") {
      const detailMaterial = new THREE.LineBasicMaterial({
        color: this.coatColor(entity).offsetHSL(0, -0.08, 0.24),
        transparent: true,
        opacity: 0.68
      });
      const flagella = this.markShared(new THREE.LineSegments(this.shared.flagella, detailMaterial));
      flagella.userData.entityId = entity.id;
      group.add(flagella);
      group.userData.flagella = flagella;
    } else if (morphology === "radiolarian") {
      const detailMaterial = new THREE.LineBasicMaterial({
        color: this.coatColor(entity).offsetHSL(0, -0.08, 0.24),
        transparent: true,
        opacity: 0.68
      });
      const spikes = this.markShared(new THREE.LineSegments(this.shared.radiolarianSpikes, detailMaterial));
      spikes.userData.entityId = entity.id;
      group.add(spikes);
      group.userData.spikes = spikes;
    } else if (morphology === "trilobite") {
      const detailMaterial = new THREE.LineBasicMaterial({
        color: this.coatColor(entity).offsetHSL(0, -0.08, 0.24),
        transparent: true,
        opacity: 0.68
      });
      const ribs = this.markShared(new THREE.LineSegments(this.shared.predatorRibs, detailMaterial));
      ribs.userData.entityId = entity.id;
      group.add(ribs);
      group.userData.ribs = ribs;
      group.userData.mandibles = [];
      for (const side of [-1, 1]) {
        const mandible = this.markShared(new THREE.Mesh(this.shared.mandible, bodyMaterial));
        mandible.rotation.z = -Math.PI * 0.5 + side * 0.28;
        mandible.position.set(1.45, side * 0.34, 0);
        mandible.userData.entityId = entity.id;
        group.add(mandible);
        group.userData.mandibles.push(mandible);
      }
    }

    if (morphology !== "trilobite") {
      const nucleusMaterial = new THREE.MeshPhysicalMaterial({
        color: this.coatColor(entity).multiplyScalar(0.38),
        roughness: 0.48,
        transparent: true,
        opacity: 0.72
      });
      const nucleus = this.markShared(new THREE.Mesh(this.shared.nucleus, nucleusMaterial));
      nucleus.scale.set(morphology === "ciliate" ? 0.82 : morphology === "radiolarian" ? 0.62 : 0.75, 0.7, 0.65);
      nucleus.position.set(morphology === "flagellate" ? 0.3 : -0.08, 0.02, 0.08);
      nucleus.userData.entityId = entity.id;
      group.add(nucleus);
      group.userData.nucleus = nucleus;
    }

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: entity.kind === "alien" ? 0x9effba : entity.kind === "grazer" ? 0x8ee2f4 : 0xf0a7e5,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const halo = this.markShared(new THREE.Mesh(this.shared.halo, haloMaterial));
    halo.rotation.x = Math.PI * 0.5;
    halo.visible = false;
    group.add(halo);
    group.userData.halo = halo;

    const trailMaterial = new THREE.MeshBasicMaterial({
      color: this.coatColor(entity),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const trail = this.markShared(new THREE.Mesh(this.shared.trail, trailMaterial));
    trail.rotation.z = Math.PI * 0.5;
    trail.position.x = -1.5;
    trail.visible = false;
    group.add(trail);
    group.userData.trail = trail;
    group.userData.bodyMaterial = bodyMaterial;
    group.userData.currentSim = { x: entity.x, y: entity.y, z: entity.z || 0 };

    group.traverse((child) => {
      if (child.isMesh || child.isLineSegments) {
        child.userData.entityId = entity.id;
        this.pickables.push(child);
      }
    });
    this.creatureGroup.add(group);
    this.entityObjects.set(entity.id, group);
    return group;
  }

  removeEntityObject(id) {
    const group = this.entityObjects.get(id);
    if (!group) return;
    this.creatureGroup.remove(group);
    this.pickables = this.pickables.filter((object) => object.userData.entityId !== id);
    disposeObject(group);
    this.entityObjects.delete(id);
  }

  updateEntities(entities, selectedId, hoveredId, delta) {
    const activeIds = new Set(entities.map((entity) => entity.id));
    for (const id of this.entityObjects.keys()) {
      if (!activeIds.has(id)) this.removeEntityObject(id);
    }

    for (const entity of entities) {
      const morphology = entity.morphology || (entity.kind === "grazer" ? "ciliate" : entity.kind === "predator" ? "trilobite" : "amoeba");
      let group = this.entityObjects.get(entity.id);
      if (group && group.userData.morphology !== morphology) {
        this.removeEntityObject(entity.id);
        group = null;
      }
      group = group || this.createEntityObject(entity);
      const selected = entity.id === selectedId;
      const hovered = entity.id === hoveredId;
      group.userData.currentSim = { x: entity.x, y: entity.y, z: entity.z || 0 };
      const world = this.simToWorld(entity.x, entity.y, entity.z || 0);
      world.y += this.floorHeightAt(entity.x, entity.y);
      group.position.lerp(world, clamp(delta * 10, 0.2, 0.72));

      const heading = Number(entity.heading) || 0;
      const horizontalSpeed = Math.hypot(entity.vx || 0, entity.vy || 0);
      const pitch = Math.atan2(entity.vz || 0, Math.max(1, horizontalSpeed));
      group.rotation.y += (((-heading - group.rotation.y + Math.PI * 3) % TAU) - Math.PI) * clamp(delta * 6, 0.05, 0.4);
      group.rotation.z += (pitch - group.rotation.z) * clamp(delta * 5, 0.05, 0.36);

      const baseScale = 0.5 + clamp(entity.traits?.size || 1, 0.35, 2.5) * 0.36;
      const pulseAmplitude = morphology === "amoeba" ? 0.06 : morphology === "flagellate" ? 0.032 : morphology === "ciliate" ? 0.022 : 0.014;
      const pulse = 1 + Math.sin(this.time * 2.2 + (entity.visualPhase || entity.id)) * pulseAmplitude;
      group.scale.setScalar(baseScale * pulse);
      if (morphology === "amoeba") group.scale.y *= 0.92 + Math.sin(this.time * 1.7 + entity.id) * 0.04;
      if (morphology === "radiolarian") group.rotation.x += delta * 0.12;

      const coat = this.coatColor(entity);
      const material = group.userData.bodyMaterial;
      material.color.lerp(coat, clamp(delta * 5, 0.08, 0.45));
      material.emissive.copy(material.color).multiplyScalar(entity.kind === "alien" ? 0.16 : 0.08);
      const visibility = Number(entity.visualVisibility);
      const camouflageAlpha = Number.isFinite(visibility) ? clamp(0.48 + visibility * 0.45, 0.45, 0.96) : 0.82;
      material.opacity = entity.kind === "predator" ? Math.max(0.76, camouflageAlpha) : camouflageAlpha;
      const detailed = selected || hovered;
      const showStructure = detailed || entities.length <= 90;
      if (group.userData.nucleus) group.userData.nucleus.visible = detailed;
      if (group.userData.cilia) group.userData.cilia.visible = showStructure;
      if (group.userData.flagella) group.userData.flagella.visible = showStructure;
      if (group.userData.spikes) group.userData.spikes.visible = showStructure;
      if (group.userData.ribs) group.userData.ribs.visible = showStructure;
      if (group.userData.lobes) {
        for (const lobe of group.userData.lobes) lobe.visible = showStructure;
      }
      if (group.userData.mandibles) {
        for (const mandible of group.userData.mandibles) mandible.visible = showStructure;
      }

      if (group.userData.lobes) {
        for (let index = 0; index < group.userData.lobes.length; index += 1) {
          const lobe = group.userData.lobes[index];
          const phase = this.time * (1.15 + index * 0.09) + entity.id * 0.71 + index * 2.2;
          lobe.position.x = Math.cos(phase) * (0.58 + index * 0.04);
          lobe.position.y = Math.sin(phase * 1.12) * 0.42;
          lobe.position.z = Math.sin(phase * 0.72) * 0.24;
          const lobeScale = 0.82 + Math.sin(phase * 1.7) * 0.13;
          lobe.scale.setScalar(lobeScale);
        }
      }
      if (group.userData.cilia) {
        group.userData.cilia.rotation.x = Math.sin(this.time * 8 + entity.id) * 0.045;
        group.userData.cilia.rotation.z = Math.cos(this.time * 7.4 + entity.id) * 0.035;
        group.userData.cilia.material.opacity = detailed ? 0.86 : 0.5;
      }
      if (group.userData.flagella) {
        group.userData.flagella.rotation.x = Math.sin(this.time * 5.6 + entity.id) * 0.14;
        group.userData.flagella.rotation.z = Math.cos(this.time * 4.8 + entity.id) * 0.09;
        group.userData.flagella.material.opacity = detailed ? 0.92 : 0.62;
      }
      if (group.userData.spikes) {
        group.userData.spikes.rotation.x += delta * 0.18;
        group.userData.spikes.rotation.z -= delta * 0.14;
        group.userData.spikes.material.opacity = detailed ? 0.9 : 0.68;
      }
      if (group.userData.ribs) {
        group.userData.ribs.material.opacity = detailed ? 0.9 : 0.7;
      }
      if (group.userData.mandibles) {
        const bite = Math.sin(this.time * 5.2 + entity.id) * 0.18;
        group.userData.mandibles[0].rotation.z = -Math.PI * 0.5 - 0.28 - bite;
        group.userData.mandibles[1].rotation.z = -Math.PI * 0.5 + 0.28 + bite;
      }

      group.userData.halo.visible = selected || hovered;
      group.userData.halo.material.opacity = selected ? 0.76 : 0.34;
      group.userData.halo.rotation.z = this.time * 0.35;
      group.userData.halo.scale.setScalar(1 + Math.sin(this.time * 3.1 + entity.id) * 0.07);

      const sprinting = Boolean(entity.abilities?.sprint && horizontalSpeed > (entity.traits?.maxSpeed || 1) * 0.78);
      group.userData.trail.visible = sprinting;
      if (sprinting) {
        group.userData.trail.material.opacity = 0.08 + Math.sin(this.time * 7 + entity.id) * 0.025;
        group.userData.trail.scale.y = 0.7 + horizontalSpeed / Math.max(1, entity.traits?.maxSpeed || 1) * 0.5;
      }
      if (entity.abilities?.regeneration && entity.health < entity.traits.maxHealth * 0.96 && entity.energy > entity.traits.maxEnergy * 0.48 && hash(Math.floor(this.time * 8) + entity.id, 72) > 0.84) {
        this.emit("regeneration", entity.x, entity.y, entity.z || 0, "#8dffc3", 1);
      }
    }
  }

  updateBubbles(delta) {
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < this.bubbleData.length; index += 1) {
      const bubble = this.bubbleData[index];
      bubble.y += delta * bubble.speed;
      if (bubble.y > this.worldHeight - 0.2) {
        bubble.y = 0.3 + hash(index + Math.floor(this.time), 91) * 1.5;
        bubble.x = (hash(index + Math.floor(this.time), 92) - 0.5) * this.worldWidth * 0.9;
        bubble.z = (hash(index + Math.floor(this.time), 93) - 0.5) * this.worldDepth * 0.9;
      }
      const x = bubble.x + Math.sin(this.time * 0.8 + bubble.phase) * 0.28;
      const z = bubble.z + Math.cos(this.time * 0.65 + bubble.phase) * 0.18;
      const scale = bubble.scale * (0.9 + Math.sin(this.time * 1.7 + bubble.phase) * 0.08);
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(x, bubble.y, z);
      this.bubbleMesh.setMatrixAt(index, matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
  }

  syncFires(fires) {
    while (this.fireObjects.length > fires.length) {
      const object = this.fireObjects.pop();
      this.fireGroup.remove(object);
      disposeObject(object);
    }
    while (this.fireObjects.length < fires.length) {
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xff8b52,
        emissive: 0xff4b25,
        emissiveIntensity: 3.2,
        transparent: true,
        opacity: 0.72,
        roughness: 0.2
      });
      const core = this.markShared(new THREE.Mesh(this.shared.fireCore, material));
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.05, 7, 32),
        new THREE.MeshBasicMaterial({ color: 0xffb768, transparent: true, opacity: 0.54 })
      );
      ring.rotation.x = Math.PI * 0.5;
      const object = new THREE.Group();
      object.add(core, ring);
      object.userData.core = core;
      object.userData.ring = ring;
      this.fireGroup.add(object);
      this.fireObjects.push(object);
    }
    for (let index = 0; index < fires.length; index += 1) {
      const fire = fires[index];
      const object = this.fireObjects[index];
      const world = this.simToWorld(fire.x, fire.y, (Number(fire.z) || 24) + Math.sin(this.time * 2 + index) * 3);
      object.position.copy(world);
      const strength = clamp(0.35 + fire.fuel / 90 - fire.wetness * 0.06, 0.2, 1.2);
      object.scale.setScalar(0.62 + strength * 0.72 + Math.sin(this.time * 8 + fire.phase) * 0.08);
      object.userData.ring.rotation.z = this.time * 1.8 + index;
      object.userData.ring.material.opacity = 0.2 + strength * 0.38;
    }
  }

  emit(type, x, depth, height, color = "#d8ffe5", amount = 6) {
    const origin = this.simToWorld(x, depth, height);
    const effectColor = new THREE.Color(color);
    for (let index = 0; index < amount; index += 1) {
      const angle = hash(this.effects.length + index, 101) * TAU;
      const vertical = (hash(this.effects.length + index, 102) - 0.25) * 0.9;
      const speed = 0.45 + hash(this.effects.length + index, 103) * 1.9;
      this.effects.push({
        type,
        position: origin.clone(),
        velocity: new THREE.Vector3(Math.cos(angle) * speed, vertical, Math.sin(angle) * speed),
        color: effectColor.clone(),
        age: 0,
        life: type === "death" ? 1.8 : type === "birth" ? 1.35 : 0.85
      });
    }
    if (this.effects.length > this.effectCapacity) this.effects.splice(0, this.effects.length - this.effectCapacity);
  }

  updateEffects(delta) {
    for (const effect of this.effects) {
      effect.age += delta;
      effect.position.addScaledVector(effect.velocity, delta);
      effect.velocity.multiplyScalar(Math.pow(0.93, delta * 60));
      effect.velocity.y += (effect.type === "birth" || effect.type === "regeneration" ? 0.42 : -0.08) * delta;
    }
    this.effects = this.effects.filter((effect) => effect.age < effect.life);
    const positionAttribute = this.effectPoints.geometry.attributes.position;
    const colorAttribute = this.effectPoints.geometry.attributes.color;
    const count = Math.min(this.effects.length, this.effectCapacity);
    for (let index = 0; index < count; index += 1) {
      const effect = this.effects[index];
      const fade = 1 - effect.age / effect.life;
      positionAttribute.setXYZ(index, effect.position.x, effect.position.y, effect.position.z);
      colorAttribute.setXYZ(index, effect.color.r * fade, effect.color.g * fade, effect.color.b * fade);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    this.effectPoints.geometry.setDrawRange(0, count);
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: this.simWidth * 0.5, y: this.simDepth * 0.5, z: 0, entityId: null };
    this.pointer.x = (clientX - rect.left) / rect.width * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const entityHits = this.raycaster.intersectObjects(this.pickables, false);
    if (entityHits.length) {
      const entityId = entityHits[0].object.userData.entityId;
      const group = this.entityObjects.get(entityId);
      if (group) return { ...group.userData.currentSim, entityId };
    }
    if (this.floorMesh) {
      const floorHits = this.raycaster.intersectObject(this.floorMesh, false);
      if (floorHits.length) return { ...this.worldToSim(floorHits[0].point), entityId: null };
    }
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.floorPlane, point)) return { ...this.worldToSim(point), entityId: null };
    return { x: this.simWidth * 0.5, y: this.simDepth * 0.5, z: 0, entityId: null };
  }

  focusEntity(entityId) {
    const object = this.entityObjects.get(entityId);
    if (!object) return;
    this.controls.target.lerp(object.position, 0.65);
  }

  resetCamera() {
    this.camera.position.set(39, 24, 36);
    this.controls.target.set(0, 6.2, 0);
    this.controls.update();
  }

  clearEffects() {
    this.effects.length = 0;
    this.effectPoints.geometry.setDrawRange(0, 0);
  }

  resize(width, height, dpr) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(1.6, dpr || window.devicePixelRatio || 1));
    this.renderer.setSize(this.width, this.height, false);
  }

  render(state, delta = 1 / 60, hoveredId = null) {
    if (!state) return;
    this.currentState = state;
    this.time += Math.min(0.1, Math.max(0, delta));
    this.waterSurface.material.uniforms.uTime.value = this.time;
    this.waterSurface.material.uniforms.uOpacity.value = state.weather === "rain" ? 0.22 : state.weather === "snow" ? 0.19 : 0.14;

    const dayPhase = state.worldDays - Math.floor(state.worldDays);
    const daylight = clamp((Math.sin((dayPhase - 0.25) * TAU) + 0.2) * 0.75, 0.06, 1);
    this.topLight.intensity = 0.65 + daylight * 3.3;
    this.ambientLight.intensity = 0.65 + daylight * 1.05;
    this.scene.fog.density = state.weather === "rain" ? 0.021 : state.weather === "snow" ? 0.019 : 0.016;
    this.scene.background.set(daylight < 0.25 ? 0x020a15 : 0x041923);
    this.rimLight.intensity = 14 + daylight * 12;
    this.warmLight.intensity = daylight * 10;

    this.updateBubbles(delta);
    if (Math.floor(this.time * 30) % 3 === 0) this.updatePlants(this.time);
    this.updateEntities(state.entities || [], state.selectedId, hoveredId, delta);
    this.syncFires(state.fires || []);
    this.updateEffects(delta);

    for (let index = 0; index < this.lightShafts.length; index += 1) {
      const shaft = this.lightShafts[index];
      shaft.rotation.y = Math.sin(this.time * 0.14 + index) * 0.12;
      shaft.material.opacity = 0.018 + daylight * 0.032;
    }
    if (state.mode === "creature" && state.selectedId) this.focusEntity(state.selectedId);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const statsTick = Math.floor(this.time * 2);
    if (statsTick !== this.lastStatsTick) {
      this.lastStatsTick = statsTick;
      this.canvas.dataset.renderCalls = String(this.renderer.info.render.calls);
      this.canvas.dataset.triangles = String(this.renderer.info.render.triangles);
      this.canvas.dataset.renderedEntities = String(this.entityObjects.size);
    }
  }

  getStats() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      entities: this.entityObjects.size
    };
  }
}
