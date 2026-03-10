# Web3 AR Cube Mobile Web App

This is a mobile-first web app prototype that combines:
- **web3.js wallet connection** (MetaMask mobile or compatible wallet browser)
- **3D cube scene** using Three.js
- **AR session request** using WebXR where available
- **Touch gesture fallback** for iPhone/mobile browsers that do not support immersive WebXR AR

## Features

- Connect Ethereum wallet via `eth_requestAccounts`
- Launch AR session (`immersive-ar`) when supported
- Drag on-screen to rotate and move the cube in fallback mode
- Experimental hand-tracking interaction in AR mode when browser/runtime exposes hand joints

## Run locally

From repository root:

```bash
cd ar_web3_cube_app
python3 -m http.server 8080
```

Open on your device/browser:

- Local desktop test: `http://localhost:8080`
- iPhone test on same Wi-Fi: `http://<your-computer-ip>:8080`

## iPhone compatibility note

Safari on iPhone currently has limited support for full WebXR immersive AR and hand tracking. For most iPhone setups this app will run in **3D fallback mode** (non-AR) with touch manipulation.

For true iPhone browser-based AR, teams often use alternatives such as:
- USDZ + AR Quick Look experiences
- Native app wrappers (ARKit)
- Commercial web AR SDKs with custom tracking pipelines
