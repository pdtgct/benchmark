import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";
import { ARButton } from "https://unpkg.com/three@0.164.1/examples/jsm/webxr/ARButton.js";

const statusEl = document.getElementById("status");
const walletAddressEl = document.getElementById("wallet-address");
const connectWalletButton = document.getElementById("connect-wallet");
const startArButton = document.getElementById("start-ar");
const canvas = document.getElementById("scene");

let scene;
let camera;
let renderer;
let cube;
let ground;
let web3;

let isDragging = false;
const dragStart = new THREE.Vector2();

initScene();
bindWallet();
bindTouchManipulation();

async function initScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
  camera.position.set(0, 0.8, 2);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445577, 1.2);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(1, 3, 2);
  scene.add(dir);

  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4d9bff,
    roughness: 0.22,
    metalness: 0.15,
  });

  cube = new THREE.Mesh(geometry, material);
  cube.position.set(0, 0.1, -0.8);
  scene.add(cube);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ color: 0x16233f, transparent: true, opacity: 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(render);
  status("3D preview ready. You can drag to rotate and move cube with one finger.");
}

function bindWallet() {
  connectWalletButton.addEventListener("click", async () => {
    try {
      const { ethereum } = window;
      if (!ethereum) {
        status("No wallet detected. Open this page in MetaMask mobile browser or another Web3 wallet browser.");
        return;
      }

      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      web3 = new Web3(ethereum);
      walletAddressEl.textContent = `Wallet: ${accounts[0]}`;
      status("Wallet connected. Ready to start AR / 3D interaction.");
    } catch (error) {
      status(`Wallet connection failed: ${error.message}`);
    }
  });

  startArButton.addEventListener("click", async () => {
    const supportsWebXR = navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar"));
    if (!supportsWebXR) {
      status("AR not supported on this browser/device. Using 3D mode fallback with touch gestures.");
      return;
    }

    const arButton = ARButton.createButton(renderer, {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["hand-tracking"],
    });

    arButton.style.display = "none";
    document.body.appendChild(arButton);
    arButton.click();
    status("AR session requested. Move your device to place and manipulate the cube.");

    setupHandTrackingIfAvailable();
  });
}

function bindTouchManipulation() {
  canvas.addEventListener("pointerdown", (event) => {
    isDragging = true;
    dragStart.set(event.clientX, event.clientY);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!isDragging) {
      return;
    }

    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    dragStart.set(event.clientX, event.clientY);

    cube.rotation.y += dx * 0.01;
    cube.rotation.x += dy * 0.01;

    const panScale = 0.0015;
    cube.position.x += dx * panScale;
    cube.position.y = Math.min(1.3, Math.max(0.05, cube.position.y - dy * panScale));
  });

  const endDrag = () => {
    isDragging = false;
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

function setupHandTrackingIfAvailable() {
  const session = renderer.xr.getSession();
  if (!session || !session.inputSources) {
    return;
  }

  const tip = new THREE.Vector3();
  const thumb = new THREE.Vector3();

  renderer.setAnimationLoop((time, frame) => {
    if (frame) {
      for (const source of session.inputSources) {
        if (!source.hand) {
          continue;
        }

        const indexPose = frame.getJointPose(source.hand.get("index-finger-tip"), renderer.xr.getReferenceSpace());
        const thumbPose = frame.getJointPose(source.hand.get("thumb-tip"), renderer.xr.getReferenceSpace());

        if (indexPose && thumbPose) {
          tip.set(indexPose.transform.position.x, indexPose.transform.position.y, indexPose.transform.position.z);
          thumb.set(thumbPose.transform.position.x, thumbPose.transform.position.y, thumbPose.transform.position.z);

          const pinchDistance = tip.distanceTo(thumb);
          if (pinchDistance < 0.03) {
            cube.position.lerp(tip, 0.3);
            cube.rotation.y += 0.02;
          }
        }
      }
    }

    render(time, frame);
  });
}

function render() {
  cube.rotation.y += 0.005;
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function status(message) {
  statusEl.textContent = message;
}
