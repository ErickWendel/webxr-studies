// references:
// https://github.com/tensorflow/tfjs-models/blob/master/body-pix/README-v1.md
// https://github.com/vinooniv/video-bg-blur/
// https://blog.francium.tech/edit-live-video-background-with-webrtc-and-tensorflow-js-c67f92307ac5
import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


// const videoElement = document.createElement('video');
const container = document.querySelector('.container');
const canvasMask = document.createElement('canvas');
// const canvasTextureFront = document.createElement('canvas');
// const textureContextFront = canvasTextureFront.getContext('2d');
const canvasTexture = document.createElement('canvas');
const textureContext = canvasTexture.getContext('2d');
const contextMask = canvasMask.getContext('2d');
// contextMask.willReadFrequently = true;
// textureContext.willReadFrequently = true;
// textureContextFront.willReadFrequently = true;
let width, height, maxSide;
let videoElement, net;
let camera, renderer, scene, material, clock, counter, sliceCounter;
const meshes = [];
let backgroundMesh;
let stats, mixer;
let stickerTexture, stickerMesh, fallAction;
const startBtn = document.getElementById('start-btn');
// const stickerTint = new THREE.Color()
// startBtn.addEventListener('click', e => {
//   startBtn.parentElement.removeChild(startBtn);
//   init();
// })

init()

async function init() {

  videoElement = await initVideoStream();
  // debug sources
  // container.appendChild(videoElement);
  // container.appendChild(canvasMask);
  // debug tiles
  // document.body.appendChild(canvasTexture);
  // canvasTexture.style.position = 'relative';
  // canvasTexture.style.width = '100px';

  net = await loadBodyPix();
  init3D();
  animate();
}

function initVideoStream() {
  const videoElement = document.createElement('video');
  console.log('Initializing Video Stream...')
  return new Promise(ready => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(stream => {
        videoElement.srcObject = stream;
        videoElement.play();
        videoElement.addEventListener('playing', (event) => {
          canvasTexture.width = canvasMask.width = videoElement.width = videoElement.videoWidth;
          canvasTexture.height = canvasMask.height = videoElement.height = videoElement.videoHeight;

          ready(videoElement);
        });

      })
      .catch(err => {
        alert(`[Error occurred]: ${err}`);
      });
  })
}

// function stopVideoStream() {
//   const stream = videoElement.srcObject;
//   stream.getTracks().forEach(track => track.stop());
//   videoElement.srcObject = null;
// }

function loadBodyPix() {
  console.log('Initializing BodyPix Library...')
  return new Promise(ready => {
    const options = {
      multiplier: 0.5,
      stride: 32,
      quantBytes: 4,
    }
    return bodyPix.load(options)
      .then(net => ready(net))
      .catch(err => console.log(err))
  });
}

async function drawMask() {
  const segmentation = await net.segmentPerson(videoElement);
  const coloredPartImage = bodyPix.toMask(segmentation);
  const opacity = 1;
  const flipHorizontal = false;
  const maskBlurAmount = 0;
  bodyPix.drawMask(
    canvasMask, videoElement, coloredPartImage, opacity, maskBlurAmount,
    flipHorizontal
  );
}

function init3D() {
  console.log('Initializing Three...');

  clock = new THREE.Clock();
  counter = 0;
  sliceCounter = 0;
  width = videoElement.videoWidth;
  height = videoElement.videoHeight;
  maxSide = Math.max(width, height);
  camera = new THREE.OrthographicCamera(width / - 2, width / 2, height / 2, height / - 2, 1, 1000);
  camera.position.set(0, 0, 500);
  // camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 1, 100000 );
  // camera.position.set( 0,0, 500  );

  scene = new THREE.Scene();

  backgroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    map: new THREE.VideoTexture(videoElement)
  }));
  backgroundMesh.rotation.y = -Math.PI;
  backgroundMesh.position.set(0, 0, 110);
  scene.add(backgroundMesh);

  const loader = new GLTFLoader();
  loader.load('./models/sticker.glb', function (gltf) {

    scene.add(gltf.scene);

    gltf.scene.traverse(function (child) {
      if (child.name === 'StickerPlaneMesh') {
        stickerTexture = new THREE.CanvasTexture(canvasTexture);
        stickerTexture.wrapT = stickerTexture.wrapS = THREE.RepeatWrapping;
        stickerTexture.repeat.x = - 1;
        stickerTexture.repeat.y = - 1;
        child.material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          side: THREE.DoubleSide,
          map: stickerTexture,
        });
        child.geometry.scale(width / 2, height / 2, 1);
        stickerMesh = child;
      } else
        if (child.name === 'StickerPlane') {
          child.position.set(0, -height * 0.5, 115)
        }

    });

    fallAction = gltf.animations[0]
        mixer = new THREE.AnimationMixer(gltf.scene);
        mixer.clipAction(fallAction).play();
        fallAction.clampWhenFinished = true;
        mixer.timeScale = 2;

  });


  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 50000;
}

function animate() {

  const delta = clock.getDelta();
  requestAnimationFrame(animate);

  counter += delta;
  if (counter > 0.5) {
    counter = 0;
    if (stickerMesh) {
      stickerMesh.material.color.setHSL(Math.random(), 0.75, 0.75);
    }
    mixer.clipAction(fallAction).reset();
  }
  sliceOne()
  if ( mixer ) mixer.update(delta);
  renderer.render(scene, camera);
}


function sliceOne(mesh) {
  drawMask(videoElement, net);
  const { width, height } = canvasTexture;
  const numPerSide = 1;
  const x = (sliceCounter % numPerSide) * (width / numPerSide);
  const y = (Math.floor(sliceCounter / numPerSide) % numPerSide) * (height / numPerSide);

  const imgData = contextMask.getImageData(0, 0, canvasMask.width, canvasMask.height);
  const data = imgData.data;
  for (let i4 = 0; i4 < data.length; i4 += 4) {
    const red = data[i4];
    const green = data[i4 + 1];
    const blue = data[i4 + 2];
    const alpha = data[i4 + 3];
    if (!red && !green && !blue) {
      data[i4 + 3] = 0;
    }
  }
  contextMask.putImageData(imgData, 0, 0);

  textureContext.clearRect(x, y, width / numPerSide, height / numPerSide);
  // White border
  const borderSize = 7;
  textureContext.filter = `
    drop-shadow(${borderSize}px 0px 0 white)
    drop-shadow(-${borderSize}px 0px 0 white)
    drop-shadow(0px -${borderSize}px 0 white)
    drop-shadow(0px ${borderSize}px 0 white)
  `;
  textureContext.drawImage(canvasMask, x, y, width / numPerSide, height / numPerSide);
  if (stickerMesh) {
    stickerMesh.material.map.needsUpdate = true;
  }
}