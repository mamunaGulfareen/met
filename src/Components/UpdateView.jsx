import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  lat1 = typeof lat1 === 'string' ? parseFloat(lat1) : lat1;
  lon1 = typeof lon1 === 'string' ? parseFloat(lon1) : lon1;
  lat2 = typeof lat2 === 'string' ? parseFloat(lat2) : lat2;
  lon2 = typeof lon2 === 'string' ? parseFloat(lon2) : lon2;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

function smoothValue(prev, next, factor = 0.2) {
  if (prev === null || isNaN(prev)) return next;
  return prev + (next - prev) * factor;
}

function latLngToPosition(userPos, coinPos) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(userPos.latitude);
  const lon1 = toRad(userPos.longitude);
  const lat2 = toRad(coinPos.lat);
  const lon2 = toRad(coinPos.lng);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const x = R * dLon * Math.cos((lat1 + lat2) / 2);
  const z = R * dLat;
  return { x, y: 0, z: -z };
}

export default function ARView({ coin, onBack }) {
  const containerRef = useRef();
  const modelRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const videoRef = useRef(null);

  const [userLocation, setUserLocation] = useState(null);
  const [userHeading, setUserHeading] = useState(null);
  const [canCollect, setCanCollect] = useState(false);
  const [distanceToCoin, setDistanceToCoin] = useState(null);
  const [angleDiff, setAngleDiff] = useState(null);
  const [iosPermissionGranted, setIosPermissionGranted] = useState(false);

  const userLocationRef = useRef(null);

  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);

  // GPS tracking
  useEffect(() => {
    const handlePosition = (pos) => {
      const { latitude, longitude, heading } = pos.coords;
      setUserLocation({ latitude, longitude });
      if (heading !== null && !isNaN(heading)) setUserHeading(heading);
    };
    navigator.geolocation.getCurrentPosition(handlePosition, console.error, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
    const watchId = navigator.geolocation.watchPosition(handlePosition, console.error, { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Device orientation
  useEffect(() => {
    const handleOrientation = (event) => {
      let heading = null;
      if (isIOS() && typeof event.webkitCompassHeading === 'number') heading = event.webkitCompassHeading;
      else if (event.alpha !== null) heading = (360 - event.alpha) % 360;
      if (heading !== null && !isNaN(heading)) setUserHeading(heading);
    };
    if (isIOS()) { if (iosPermissionGranted) window.addEventListener('deviceorientation', handleOrientation, true); }
    else { window.addEventListener('deviceorientationabsolute', handleOrientation, true); window.addEventListener('deviceorientation', handleOrientation, true); }
    return () => { window.removeEventListener('deviceorientationabsolute', handleOrientation); window.removeEventListener('deviceorientation', handleOrientation); };
  }, [iosPermissionGranted]);

  const requestIOSPermission = async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { const response = await DeviceOrientationEvent.requestPermission(); if (response === 'granted') setIosPermissionGranted(true); else alert('Permission denied'); } 
      catch (error) { console.error(error); }
    } else { setIosPermissionGranted(true); }
  };

  useEffect(() => {
    const video = document.createElement('video');
    video.setAttribute('autoplay', ''); video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
    video.style.position = 'absolute'; video.style.top = 0; video.style.left = 0;
    video.style.width = '100%'; video.style.height = '100%'; video.style.objectFit = 'cover'; video.style.zIndex = '0';
    videoRef.current = video;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    camera.position.z = 2; cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = 0;
    renderer.domElement.style.left = 0;
    renderer.domElement.style.zIndex = '1';
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff,0.5));
    const directionalLight = new THREE.DirectionalLight(0xffffff,0.8);
    directionalLight.position.set(1,1,1);
    scene.add(directionalLight);

    const loader = new GLTFLoader();
    loader.load('/stylized_coin/scene.gltf', (gltf)=>{
      const model = gltf.scene;
      model.scale.set(0.5,0.5,0.5);
      model.visible=false;
      scene.add(model);
      modelRef.current=model;
    }, undefined, console.error);

    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);
      const currentLocation = userLocationRef.current;

      if(modelRef.current && currentLocation && userHeading!==null){
        const distance = haversineDistance(currentLocation.latitude,currentLocation.longitude,coin.lat,coin.lng);
        setDistanceToCoin(distance);
        canCollectRef.current = distance<=100;
        setCanCollect(distance<=100);

        const bearingToCoin = calculateBearing(currentLocation.latitude,currentLocation.longitude,coin.lat,coin.lng);
        let angle = Math.abs(((bearingToCoin-userHeading)+360)%360); if(angle>180) angle=360-angle;
        setAngleDiff(angle);

        // Dynamic smoothing based on distance & screen position
        const targetPos = latLngToPosition(currentLocation, coin);
        const prevPos = modelRef.current.position;
        const dx=targetPos.x-prevPos.x, dz=targetPos.z-prevPos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        const factor = Math.min(0.3,0.05+dist/50);

        modelRef.current.position.x = smoothValue(prevPos.x,targetPos.x,factor);
        modelRef.current.position.y = smoothValue(prevPos.y,targetPos.y,factor);
        modelRef.current.position.z = smoothValue(prevPos.z,targetPos.z,factor);

        // Camera smooth rotation
        const prevHeading = cameraRef.current.rotation.y*180/Math.PI;
        const headingFactor = Math.min(0.3,0.05+Math.abs(userHeading-prevHeading)/180);
        const smoothedHeading = smoothValue(prevHeading,userHeading,headingFactor);
        cameraRef.current.rotation.y = -smoothedHeading*Math.PI/180;

        // Project to screen for scale & visibility
        const vector = new THREE.Vector3(modelRef.current.position.x,modelRef.current.position.y,modelRef.current.position.z);
        vector.project(cameraRef.current);
        const onScreen = vector.z<1 && vector.x>-1 && vector.x<1 && vector.y>-1 && vector.y<1;
        const visible = angle<=90 && distance<=100 && onScreen;
        modelRef.current.visible = visible;

        // Dynamic scale & opacity
        if(visible){
          const distCenter = Math.sqrt(vector.x*vector.x+vector.y*vector.y);
          const scale = 1-Math.min(distCenter,1)*0.7;
          modelRef.current.scale.set(scale,scale,scale);
          modelRef.current.traverse((child)=>{
            if(child.material){ child.material.transparent=true; child.material.opacity=scale; }
          });
          modelRef.current.rotation.y += 0.01;
        }
      }

      renderer.render(scene,camera);
    };

    const setupCamera = async()=>{
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ video:{facingMode:{ideal:'environment'}}, audio:false });
        video.srcObject=stream; await video.play();
        if(containerRef.current){ containerRef.current.appendChild(video); containerRef.current.appendChild(renderer.domElement); }
        animate();
      }catch(e){ console.error(e); alert('Camera access required'); }
    };
    setupCamera();

    const handleResize = ()=>{
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth,window.innerHeight);
    };
    window.addEventListener('resize',handleResize);

    return ()=>{
      cancelAnimationFrame(animationFrameIdRef.current);
      window.removeEventListener('resize',handleResize);
      if(videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t=>t.stop());
      if(containerRef.current) containerRef.current.innerHTML='';
    };
  }, [coin, iosPermissionGranted, userHeading]);

  const canCollectRef = useRef(false);
  const handleCollect = ()=>{
    if(canCollectRef.current){ alert(`Coin #${coin.id} collected! 🎉`); if(onBack) onBack(); }
    else alert('🚫 Move closer and face the coin!');
  };

  return (
    <div ref={containerRef} style={{width:'100vw',height:'100vh',position:'relative'}}>
      {isIOS() && !iosPermissionGranted && (
        <button onClick={requestIOSPermission} style={{position:'absolute',top:110,left:20,zIndex:20,padding:8,backgroundColor:'#007bff',color:'white',borderRadius:6,border:'none',cursor:'pointer'}}>Enable Compass</button>
      )}
      <button onClick={onBack} style={{position:'absolute',top:20,left:20,zIndex:10,padding:8,borderRadius:6,backgroundColor:'white',border:'none',cursor:'pointer'}}>Back</button>
      <button onClick={handleCollect} disabled={!canCollect} style={{position:'absolute',bottom:40,left:'50%',transform:'translateX(-50%)',padding:12,fontSize:18,fontWeight:'bold',borderRadius:8,border:'none',cursor:canCollect?'pointer':'not-allowed',backgroundColor:canCollect?'#22c55e':'#94a3b8',color:'white',zIndex:10}}>
        {canCollect?'Collect Coin 🎉':'Too Far'}
      </button>
      <div style={{position:'absolute',top:70,left:20,color:'white',backgroundColor:'rgba(0,0,0,0.6)',padding:8,borderRadius:6,fontSize:14,zIndex:10,maxWidth:220}}>
        <div>Angle to coin: {angleDiff!==null?`${Math.round(angleDiff)}°`:'N/A'}</div>
        <div>Facing coin: {angleDiff!==null?(angleDiff<=90?'✅':'❌'):'N/A'}</div>
        <div>Distance: {distanceToCoin!==null?`${distanceToCoin.toFixed(1)} m`:'N/A'}</div>
      </div>
    </div>
  );
}
