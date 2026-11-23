import { ArrowUpRight, ChevronDown, ChevronUp, Eye, EyeOff, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMPUS_BUILDINGS, recordEngagementMetric } from '../services/campusService';
import type { CampusBuildingNode, CampusGroup, UserPublicProfile } from '../types/campus';

interface Campus3DSceneProps {
  darkMode: boolean;
  profile: UserPublicProfile | null;
  groups: CampusGroup[];
  initialFocusBuildingId?: string | null;
  onOpenChannel: (groupId: string) => void;
}

interface CameraPreset {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  buildingId: string | null;
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'quad', label: 'Campus Quad', position: [0, 26, 36], target: [0, 1.5, 0], buildingId: null },
  { id: 'observatory-hub', label: 'Hub 01', position: [9, 13, 14], target: [0, 3, 0], buildingId: 'observatory-hub' },
  { id: 'cs-engineering-wing', label: 'CS-402', position: [-6, 11, 4], target: [-14, 2.5, -9], buildingId: 'cs-engineering-wing' },
  { id: 'cryptography-lab', label: 'Crypto-510', position: [22, 11, 4], target: [14, 2.5, -9], buildingId: 'cryptography-lab' },
  { id: 'mathematics-hall', label: 'Math-308', position: [-5, 11, 24], target: [-13, 2, 12], buildingId: 'mathematics-hall' },
];

// Pre-allocated scratch math helpers outside loop (zero GC in render loop)
const _scratchVec3 = new THREE.Vector3();
const _scratchMat4 = new THREE.Matrix4();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();

function createProceduralQuadTexture(isDark: boolean, maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isDark ? '#141a29' : '#e7ebf5';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle stone pavers grid
    ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(71, 85, 105, 0.14)';
    ctx.lineWidth = 2;
    const step = 64;
    for (let i = 0; i <= 512; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Fine mineral speckle
    for (let i = 0; i < 900; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
      const px = Math.abs(x) * 512;
      const py = Math.abs(y) * 512;
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.035)';
      ctx.fillRect(px, py, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.anisotropy = maxAniso;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 126);
    grad.addColorStop(0, 'rgba(11, 15, 25, 0.55)');
    grad.addColorStop(0.55, 'rgba(11, 15, 25, 0.22)');
    grad.addColorStop(1, 'rgba(11, 15, 25, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCompositeBuilding(
  node: CampusBuildingNode,
  shadowTex: THREE.CanvasTexture,
  isSoftwareGl: boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(node.position[0], 0, node.position[2]);
  group.userData = { buildingId: node.id };

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce8,
    roughness: 0.78,
    metalness: 0.05,
  });
  const slateMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.42,
    metalness: 0.35,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x93c5fd,
    roughness: 0.12,
    metalness: 0.15,
    clearcoat: 1.0,
    transparent: true,
    opacity: isSoftwareGl ? 0.55 : 0.72,
  });
  const accentColor = new THREE.Color(node.accentHex);
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.75,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.22,
    metalness: 0.9,
  });

  // Grounding contact shadow plane (offset y = 0.02 to prevent Z-fighting)
  const contactPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 11),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.48,
    }),
  );
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.y = 0.02;
  group.add(contactPlane);

  if (node.id === 'observatory-hub') {
    // 1. Stepped Plinth Base
    const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.1, 0.45, 32), stoneMat);
    plinth1.position.y = 0.225;
    plinth1.castShadow = true;
    plinth1.receiveShadow = true;
    group.add(plinth1);

    const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.3, 0.4, 32), slateMat);
    plinth2.position.y = 0.65;
    plinth2.castShadow = true;
    plinth2.receiveShadow = true;
    group.add(plinth2);

    // 2. Rotunda Glass Core
    const core = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 3.2, 24), glassMat);
    core.position.y = 2.45;
    core.castShadow = true;
    group.add(core);

    // 3. Eight Colonnade Pillars
    const pillarGeo = new THREE.CylinderGeometry(0.18, 0.21, 3.3, 12);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeo, stoneMat);
      pillar.position.set(Math.cos(angle) * 3.55, 2.5, Math.sin(angle) * 3.55);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
    }

    // 4. Cornice Ring
    const cornice = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.85, 0.42, 32), stoneMat);
    cornice.position.y = 4.25;
    cornice.castShadow = true;
    group.add(cornice);

    // 5. Ribbed Observatory Dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      slateMat,
    );
    dome.position.y = 4.45;
    dome.castShadow = true;
    group.add(dome);

    // 6. Glowing MLS Equatorial Ring & Brass Finial Spire
    const mlsRing = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.08, 12, 48), accentMat);
    mlsRing.rotation.x = Math.PI / 2;
    mlsRing.position.y = 4.46;
    group.add(mlsRing);

    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.2, 16), brassMat);
    spire.position.y = 8.4;
    spire.castShadow = true;
    group.add(spire);
  } else {
    // Satellite Academic Wing (6-part composite architectural mass)
    // 1. Stepped Foundation
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.45, 5.4), slateMat);
    base.position.y = 0.225;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 2. Main Limestone Volume
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.0, 2.9, 4.6), stoneMat);
    body.position.y = 1.9;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // 3. Recessed Glass Curtain Atrium
    const atrium = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.3, 4.75), glassMat);
    atrium.position.y = 1.9;
    group.add(atrium);

    // 4. Vertical Mullion Fins (3 architectural ribs)
    const mullionGeo = new THREE.BoxGeometry(0.16, 2.95, 4.88);
    for (const xOffset of [-1.4, 0, 1.4]) {
      const fin = new THREE.Mesh(mullionGeo, slateMat);
      fin.position.set(xOffset, 1.9, 0);
      fin.castShadow = true;
      group.add(fin);
    }

    // 5. Overhanging Roof Cornice & Stepped Penthouse
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.35, 5.1), slateMat);
    roof.position.y = 3.5;
    roof.castShadow = true;
    group.add(roof);

    const penthouse = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 2.6), stoneMat);
    penthouse.position.y = 4.1;
    penthouse.castShadow = true;
    group.add(penthouse);

    // 6. Rooftop MLS Relay Mast & Beacon Ring
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.8, 12), brassMat);
    mast.position.y = 5.4;
    group.add(mast);

    const beacon = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 10, 28), accentMat);
    beacon.rotation.x = Math.PI / 2;
    beacon.position.y = 5.9;
    group.add(beacon);
  }

  // Invisible simplified proxy hitbox on layer 1 for fast raycasting
  const proxyHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 7.5, 6.2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  proxyHitbox.position.y = 3.5;
  proxyHitbox.layers.set(1);
  proxyHitbox.userData = { buildingId: node.id };
  group.add(proxyHitbox);

  return group;
}

export function Campus3DScene({
  darkMode,
  profile,
  groups,
  initialFocusBuildingId,
  onOpenChannel,
}: Campus3DSceneProps) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(
    initialFocusBuildingId || 'observatory-hub',
  );
  const [activePreset, setActivePreset] = useState<string>(
    initialFocusBuildingId || 'quad',
  );
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const presetRef = useRef<CameraPreset>(
    CAMERA_PRESETS.find((p) => p.id === (initialFocusBuildingId || 'quad')) || CAMERA_PRESETS[0],
  );
  const transitionActiveRef = useRef(false);
  const autoOrbitRef = useRef(autoOrbit);
  const showMeshRef = useRef(showMesh);
  const darkModeRef = useRef(darkMode);
  const sceneRefs = useRef<{
    scene?: THREE.Scene;
    groundMat?: THREE.MeshStandardMaterial;
    relayGroup?: THREE.Group;
    requestCameraJump?: (preset: CameraPreset) => void;
  }>({});

  useEffect(() => {
    autoOrbitRef.current = autoOrbit;
  }, [autoOrbit]);

  useEffect(() => {
    showMeshRef.current = showMesh;
    if (sceneRefs.current.relayGroup) {
      sceneRefs.current.relayGroup.visible = showMesh;
    }
  }, [showMesh]);

  useEffect(() => {
    darkModeRef.current = darkMode;
    const { scene } = sceneRefs.current;
    if (scene) {
      const skyHex = darkMode ? 0x0b0f19 : 0xeef2ff;
      scene.background = new THREE.Color(skyHex);
      scene.fog = new THREE.FogExp2(skyHex, 0.011);
    }
  }, [darkMode]);

  useEffect(() => {
    if (initialFocusBuildingId) {
      const found = CAMERA_PRESETS.find((p) => p.buildingId === initialFocusBuildingId);
      if (found) {
        setActivePreset(found.id);
        setSelectedBuildingId(initialFocusBuildingId);
        sceneRefs.current.requestCameraJump?.(found);
      }
    }
  }, [initialFocusBuildingId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          setDockCollapsed((c) => !c);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // Software WebGL Guard via GPU renderer string (never UA sniffing)
    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const handleContextRestored = () => {
      setWebglUnavailable(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const initialSky = darkModeRef.current ? 0x0b0f19 : 0xeef2ff;
    scene.background = new THREE.Color(initialSky);
    scene.fog = new THREE.FogExp2(initialSky, 0.011);

    // Mandatory Studio Environment Reflection via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 220);
    camera.position.set(...presetRef.current.position);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...presetRef.current.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.minDistance = 8;
    controls.maxDistance = 68;
    controls.update();

    controls.addEventListener('start', () => {
      transitionActiveRef.current = false;
    });

    // Warm Key Light + Cool Hemisphere Fill + Rim Light
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.85);
    keyLight.position.set(22, 34, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 95;
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -30;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x818cf8, 0.65);
    rimLight.position.set(-20, 16, -24);
    scene.add(rimLight);

    // Ground Quad with Procedural CanvasTexture
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const quadTexture = createProceduralQuadTexture(darkModeRef.current, maxAniso);
    const groundMat = new THREE.MeshStandardMaterial({
      map: quadTexture,
      roughness: 0.88,
      metalness: 0.04,
    });
    const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(72, 64), groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Elevated Walkways connecting Central Hub to 4 Wings
    const walkwayMat = new THREE.MeshStandardMaterial({
      color: 0xc7d2fe,
      roughness: 0.72,
      metalness: 0.08,
    });
    for (const b of CAMPUS_BUILDINGS.slice(1)) {
      const dx = b.position[0];
      const dz = b.position[2];
      const dist = Math.hypot(dx, dz);
      const walkway = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, dist), walkwayMat);
      walkway.position.set(dx / 2, 0.03, dz / 2);
      walkway.rotation.y = Math.atan2(dx, dz);
      walkway.receiveShadow = true;
      scene.add(walkway);
    }

    // Build Composite 3-12 Part Campus Buildings
    const shadowTex = createContactShadowTexture();
    const clickableProxies: THREE.Object3D[] = [];
    for (const node of CAMPUS_BUILDINGS) {
      const buildingGroup = buildCompositeBuilding(node, shadowTex, isSoftwareGl);
      scene.add(buildingGroup);
      buildingGroup.traverse((child) => {
        if (child.layers.isEnabled(1) && child.userData?.buildingId) {
          clickableProxies.push(child);
        }
      });
    }

    // Instanced Campus Trees (32 trees with ±15% scale and tint variation)
    const treeCount = 32;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const trunkInstances = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    trunkInstances.castShadow = !isSoftwareGl;

    const canopyGeo = new THREE.DodecahedronGeometry(1.05, 1);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    const canopyInstances = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    canopyInstances.castShadow = !isSoftwareGl;

    for (let i = 0; i < treeCount; i += 1) {
      const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.11;
      const radius = 21 + (i % 4) * 3.8;
      const tx = Math.cos(angle) * radius;
      const tz = Math.sin(angle) * radius;
      const scaleVar = 0.85 + ((i * 7) % 10) * 0.03;

      _scratchScale.set(scaleVar, scaleVar, scaleVar);
      _scratchVec3.set(tx, 0.7 * scaleVar, tz);
      _scratchMat4.compose(_scratchVec3, _scratchQuat, _scratchScale);
      trunkInstances.setMatrixAt(i, _scratchMat4);

      _scratchVec3.set(tx, 1.95 * scaleVar, tz);
      _scratchMat4.compose(_scratchVec3, _scratchQuat, _scratchScale);
      canopyInstances.setMatrixAt(i, _scratchMat4);

      _scratchColor.setHSL(0.4 + (i % 5) * 0.015, 0.45, darkModeRef.current ? 0.34 : 0.42);
      canopyInstances.setColorAt(i, _scratchColor);
    }
    trunkInstances.computeBoundingSphere();
    canopyInstances.computeBoundingSphere();
    scene.add(trunkInstances);
    scene.add(canopyInstances);

    // 3D MLS Fiber Relay Arcs & Animated Data Pulses
    const relayGroup = new THREE.Group();
    const relayCurves: THREE.CatmullRomCurve3[] = [];
    const pulseMeshes: THREE.Mesh[] = [];
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      emissive: 0x4f46e5,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.8,
      transparent: true,
      opacity: 0.78,
    });
    const pulseMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.4,
      roughness: 0.15,
    });
    const pulseGeo = new THREE.SphereGeometry(0.24, 12, 12);

    for (const node of CAMPUS_BUILDINGS.slice(1)) {
      const start = new THREE.Vector3(0, 6.2, 0);
      const mid = new THREE.Vector3(node.position[0] * 0.5, 9.8, node.position[2] * 0.5);
      const end = new THREE.Vector3(node.position[0], 5.9, node.position[2]);
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      relayCurves.push(curve);

      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.075, 8, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      relayGroup.add(tubeMesh);

      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      relayGroup.add(pulse);
      pulseMeshes.push(pulse);
    }
    relayGroup.visible = showMeshRef.current;
    scene.add(relayGroup);

    sceneRefs.current = {
      scene,
      groundMat,
      relayGroup,
      requestCameraJump: (preset: CameraPreset) => {
        presetRef.current = preset;
        transitionActiveRef.current = true;
      },
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Click Raycaster on layer 1 proxies
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(clickableProxies, false);
      if (hits.length > 0) {
        const bId = hits[0].object.userData?.buildingId as string | undefined;
        if (bId) {
          setSelectedBuildingId(bId);
          const matchedPreset = CAMERA_PRESETS.find((p) => p.buildingId === bId);
          if (matchedPreset) {
            setActivePreset(matchedPreset.id);
            presetRef.current = matchedPreset;
            transitionActiveRef.current = true;
          }
          if (profile) {
            recordEngagementMetric({
              userId: profile.uid,
              userRole: profile.role,
              eventType: 'campus_3d_inspected',
              department: profile.department,
              latencyMs: 8,
              wasOffline: !navigator.onLine,
            });
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // Paced Animation Loop (Software GL uses afterDraw fenceSync + 80ms pause)
    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.08);
      const elapsed = clock.getElapsedTime();

      // Animate MLS packet pulses along curves (zero GC)
      if (showMeshRef.current) {
        for (let i = 0; i < relayCurves.length; i += 1) {
          const t = (elapsed * 0.28 + i * 0.23) % 1;
          relayCurves[i].getPointAt(t, _scratchVec3);
          pulseMeshes[i].position.copy(_scratchVec3);
        }
      }

      // Exponentially damped camera transition
      if (transitionActiveRef.current) {
        const targetPos = presetRef.current.position;
        const targetLook = presetRef.current.target;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, targetPos[0], 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, targetPos[1], 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, targetPos[2], 5.5, delta);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, targetLook[0], 5.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, targetLook[1], 5.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, targetLook[2], 5.5, delta);

        const distPos = Math.hypot(
          camera.position.x - targetPos[0],
          camera.position.y - targetPos[1],
          camera.position.z - targetPos[2],
        );
        if (distPos < 0.08) {
          transitionActiveRef.current = false;
        }
      }

      controls.autoRotate = !isSoftwareGl && autoOrbitRef.current;
      controls.autoRotateSpeed = 0.85;
      controls.update();

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      quadTexture.dispose();
      shadowTex.dispose();
      envTarget.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, []);

  const selectedBuilding =
    CAMPUS_BUILDINGS.find((b) => b.id === selectedBuildingId) || CAMPUS_BUILDINGS[0];

  const linkedGroup =
    groups.find((g) => g.buildingNode === selectedBuilding.id) ||
    groups.find((g) => g.id === selectedBuilding.defaultGroupId) ||
    groups[0];

  const handleSelectPreset = (preset: CameraPreset) => {
    setActivePreset(preset.id);
    if (preset.buildingId) setSelectedBuildingId(preset.buildingId);
    sceneRefs.current.requestCameraJump?.(preset);
  };

  return (
    <div className="relative flex-1 w-full h-full overflow-hidden bg-[#eef2ff] dark:bg-[#0B0F19]">
      {/* Isolated WebGL Canvas Container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Graceful WebGL Fallback */}
      {webglUnavailable && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-[#faf8ff] dark:bg-[#0B0F19]">
          <div className="max-w-lg rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-lg">
            <img
              src="/src/assets/images/campus_hub_architecture_1794973852843.jpg"
              alt="Campus Hub 3D Fallback"
              referrerPolicy="no-referrer"
              className="w-full h-56 object-cover"
            />
            <div className="p-6">
              <h2 className="text-lg font-bold font-display mb-2">
                3D Campus Topology Preview
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                WebGL hardware acceleration is unavailable in this environment. Select any campus building below to open its channel directly.
              </p>
              <div className="flex flex-wrap gap-2">
                {CAMPUS_BUILDINGS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      const target = groups.find((g) => g.buildingNode === b.id);
                      if (target) onOpenChannel(target.id);
                    }}
                    className="px-3 py-2 rounded-lg bg-[#4f46e5] text-white text-xs font-medium cursor-pointer"
                  >
                    {b.shortCode} · {b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minimal Top-Left Selected Wing Info Badge (Solid RGBA, NO backdrop-filter over WebGL) */}
      <div className="absolute top-4 left-4 z-10 max-w-xs sm:max-w-sm rounded-xl bg-white/95 dark:bg-[#111827]/95 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono font-semibold text-[#3525cd] dark:text-[#a5b4fc]">
            {selectedBuilding.shortCode}
          </span>
          <span>{selectedBuilding.department}</span>
        </div>
        <h2 className="text-sm sm:text-base font-bold font-display mt-1 text-[#171b26] dark:text-[#eef0ff]">
          {selectedBuilding.name}
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
          {selectedBuilding.description}
        </p>

        {linkedGroup && (
          <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                Epoch {linkedGroup.mlsEpoch}
              </span>
              <span aria-hidden="true"> · </span>
              <span className="truncate">{linkedGroup.name}</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenChannel(linkedGroup.id)}
              className="px-2.5 py-1.5 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span>Open</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Collapsible Unified Bottom Control Dock (Zero Viewport Occlusion, NO backdrop-filter over WebGL) */}
      <div className="absolute bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94vw]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1.5 px-3 py-1 rounded-full bg-white/95 dark:bg-[#111827]/95 border border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Show Controls (H)' : 'Hide Controls (H)'}</span>
        </button>

        {!dockCollapsed && (
          <div className="rounded-2xl bg-white/95 dark:bg-[#111827]/95 border border-slate-200 dark:border-slate-800 px-3 py-2.5 shadow-md flex flex-wrap items-center justify-center gap-2">
            {CAMERA_PRESETS.map((preset) => {
              const active = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#4f46e5] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}

            <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 mx-0.5 hidden sm:block" />

            <button
              type="button"
              onClick={() => setShowMesh((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                showMesh
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {showMesh ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>MLS Mesh</span>
            </button>

            <button
              type="button"
              onClick={() => setAutoOrbit((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                autoOrbit
                  ? 'bg-[#4f46e5] text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Orbit</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
