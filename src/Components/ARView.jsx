import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

// Simple iOS detection helper (you can also import if you have one)
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Haversine formula
function haversineDistance(lat1, lon1, lat2, lon2) {
  console.log('Original inputs:', { lat1, lon1, lat2, lon2 });

  // Convert to numbers if input is string
  lat1 = typeof lat1 === 'string' ? parseFloat(lat1) : lat1;
  lon1 = typeof lon1 === 'string' ? parseFloat(lon1) : lon1;
  lat2 = typeof lat2 === 'string' ? parseFloat(lat2) : lat2;
  lon2 = typeof lon2 === 'string' ? parseFloat(lon2) : lon2;
  console.log('After conversion to numbers:', { lat1, lon1, lat2, lon2 });

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371e3; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  console.log('Calculated distance (meters):', R * c);

  return R * c;
}

// Bearing calculation
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
// Utility to smooth values
function smoothValue(prev, next, smoothingFactor = 0.2) {
  if (prev === null || isNaN(prev)) return next; // first value
  return prev + (next - prev) * smoothingFactor;
}


function latLngToPosition(userPos, coinPos) {
  const R = 6371000; // Earth radius in meters

  // Convert degrees to radians
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(userPos.latitude);
  const lon1 = toRad(userPos.longitude);
  const lat2 = toRad(coinPos.lat);
  const lon2 = toRad(coinPos.lng);

  // Calculate deltas
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  // Approximate conversions
  const x = R * dLon * Math.cos((lat1 + lat2) / 2); // East-West distance (meters)
  const z = R * dLat; // North-South distance (meters)

  return { x, y: 0, z: -z }; // y=0 ground level, negative z to face forward
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
  const distanceRef = useRef(null);
  const canCollectRef = useRef(false);
  const [angleDiff, setAngleDiff] = useState(null);
  const [iosPermissionGranted, setIosPermissionGranted] = useState(false);

  // Keep ref to userLocation for animation loop
  const userLocationRef = useRef(null);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // Watch user location

  useEffect(() => {
    // Function to process new location
    const handlePosition = (pos) => {
      const { latitude, longitude, accuracy, heading } = pos.coords;

      // // Ignore low-accuracy readings (> 20m)
      // if (accuracy > 20) {
      //   console.log(`Skipping low accuracy: ${accuracy}m`);
      //   return;
      // }

      setUserLocation({ latitude, longitude });
      // Only update GPS heading if moving
      if (heading !== null && !isNaN(heading)) {
        setUserHeading(heading); // adjust 0.05-0.3 for smoothness
      }
    };

    // Get initial location quickly
    navigator.geolocation.getCurrentPosition(
      handlePosition,
      (err) => console.error('Initial position error:', err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    // Watch continuous updates
    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => console.error('Geolocation watch error:', err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);


  // Handle device orientation event listener
  useEffect(() => {
    // Handler for orientation events
    const handleOrientation = (event) => {
      let heading = null;

      if (isIOS() && typeof event.webkitCompassHeading === 'number') {
        // iOS gives heading degrees clockwise from North
        heading = event.webkitCompassHeading;
      } else if (event.alpha !== null) {
        // Android: alpha is 0° when device is pointing north
        heading = (360 - event.alpha) % 360;
      }

      if (heading !== null && !isNaN(heading)) {
        setUserHeading(heading); // adjust 0.05-0.3 for smoothness
      }
    };

    if (isIOS()) {
      // iOS: add event listener only if permission granted
      if (iosPermissionGranted) {
        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    } else {
      // Android and others: add listeners immediately
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }

    // Cleanup
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [iosPermissionGranted]);

  // Request iOS permission on button click
  const requestIOSPermission = async () => {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
          setIosPermissionGranted(true);
        } else {
          alert('Permission denied for device orientation');
        }
      } catch (error) {
        console.error('Error requesting device orientation permission:', error);
      }
    } else {
      // Older iOS versions fallback
      setIosPermissionGranted(true);
    }
  };

  // Three.js + video + model setup
  useEffect(() => {
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.style.position = 'absolute';
    video.style.top = 0;
    video.style.left = 0;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.zIndex = '0';
    videoRef.current = video;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = 0;
    renderer.domElement.style.left = 0;
    renderer.domElement.style.zIndex = '1';
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    const loader = new GLTFLoader();
    loader.load(
      '/stylized_coin/scene.gltf',
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(0.5, 0.5, 0.5);
        model.visible = false;
        scene.add(model);
        modelRef.current = model;
      },
      undefined,
      (err) => console.error('Model loading error:', err)
    );

    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);

      const currentLocation = userLocationRef.current;

      if (modelRef.current && currentLocation) {
        // Distance calculate karo
        const distance = haversineDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          coin.lat,
          coin.lng
        );

        setDistanceToCoin(distance);
        canCollectRef.current = distance <= 100;
        setCanCollect(distance <= 100);

        // Bearing calculate karo coin ki taraf
        const bearingToCoin = calculateBearing(
          currentLocation.latitude,
          currentLocation.longitude,
          coin.lat,
          coin.lng
        );

        // Angle difference user heading aur coin bearing ke beech
        let angleDiff = Math.abs(((bearingToCoin - userHeading) + 360) % 360);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        // 3D relative position nikaalo
        const relativePos = latLngToPosition(currentLocation, coin);

        // 3D position ko project karo 2D screen coordinates mein
        const vector = new THREE.Vector3(relativePos.x, relativePos.y, relativePos.z);
        vector.project(cameraRef.current);

        // Check karo ke object camera ke view mein hai ke nahi
        const onScreen = vector.z < 1 && vector.x > -1 && vector.x < 1 && vector.y > -1 && vector.y < 1;

        // Visibility condition: angle diff, distance, aur camera view check kar ke
        const visible = angleDiff <= 90 && distance <= 100 && onScreen;

        modelRef.current.visible = visible;
        setAngleDiff(angleDiff);

        if (visible) {
          // Model ki 3D position set karo
          modelRef.current.position.set(relativePos.x, relativePos.y, relativePos.z);

           // Thodi rotation lagao
          modelRef.current.rotation.y += 0.01;

          // Screen position nikaalo pixels mein
          const screenX = (vector.x + 1) / 2 * window.innerWidth;
          const screenY = (-vector.y + 1) / 2 * window.innerHeight;

          // Distance from center (0,0) to vector point (x,y)
          const distFromCenter = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
          const scale = 1 - Math.min(distFromCenter, 1) * 0.7;
          modelRef.current.scale.set(scale, scale, scale);
          if (modelRef.current.material) {
            modelRef.current.material.opacity = scale;
            modelRef.current.material.transparent = true;
          }
        }

        // Camera rotation update karo user heading ke mutabiq (sirf yaw)
        if (cameraRef.current) {
          const headingRad = (userHeading * Math.PI) / 180;
          cameraRef.current.rotation.set(0, 0, 0);
          cameraRef.current.rotation.y = -headingRad;
        }
      }

      rendererRef.current.render(scene, cameraRef.current);
    };


    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();

        if (containerRef.current) {
          containerRef.current.appendChild(video);
          containerRef.current.appendChild(renderer.domElement);
        }

        animate();
      } catch (error) {
        console.error('Camera access error:', error);
        alert('Camera access is required for AR features.');
      }
    };

    setupCamera();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameIdRef.current);
      window.removeEventListener('resize', handleResize);
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [coin]);

  const handleCollect = () => {
    if (canCollectRef.current) {
      alert(`Coin #${coin.id} collected! 🎉`);
      if (onBack) onBack();
    } else {
      alert(
        `🚫 Move closer and face the coin to collect! Current distance: ${distanceRef.current?.toFixed(
          1
        ) || 'unknown'} m`
      );
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* iOS compass permission button */}
      {isIOS() && !iosPermissionGranted && (
        <button
          onClick={requestIOSPermission}
          style={{
            position: 'absolute',
            top: 110,
            left: 20,
            zIndex: 20,
            padding: '8px 12px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Enable Compass
        </button>
      )}

      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 10,
          padding: '8px 12px',
          fontSize: 16,
          borderRadius: 6,
          backgroundColor: 'white',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Back
      </button>

      {/* Collect button */}
      <button
        onClick={handleCollect}
        disabled={!canCollect}
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 20px',
          fontSize: 18,
          fontWeight: 'bold',
          borderRadius: 8,
          border: 'none',
          cursor: canCollect ? 'pointer' : 'not-allowed',
          backgroundColor: canCollect ? '#22c55e' : '#94a3b8',
          color: 'white',
          zIndex: 10,
        }}
      >
        {canCollect ? 'Collect Coin 🎉' : 'Too Far to Collect'}
      </button>

      {/* Info panel */}
      <div
        style={{
          position: 'absolute',
          top: 70,
          left: 20,
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: '8px 12px',
          borderRadius: 6,
          fontSize: 14,
          zIndex: 10,
          maxWidth: 220,
        }}
      >
        <div>Angle to coin: {angleDiff !== null ? `${Math.round(angleDiff)}°` : 'N/A'}</div>
        <div>Facing coin: {angleDiff !== null ? (angleDiff <= 90 ? '✅' : '❌') : 'N/A'}</div>
        <div>Distance: {distanceToCoin !== null ? `${distanceToCoin.toFixed(1)} m` : 'N/A'}</div>
        {/* <div>Heading: {userHeading !== null ? `${Math.round(userHeading)}°` : 'N/A'}</div> */}
      </div>
    </div>
  );
}