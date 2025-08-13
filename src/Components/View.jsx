import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

// Constants
const MAX_DISTANCE = 100; // meters
const COLLECTION_DISTANCE = 5; // meters
const VIEW_ANGLE = 30; // degrees
const SMOOTHING_FACTOR = 0.15;

// Improved coordinate conversion
function geoToWorldPosition(userLat, userLng, coinLat, coinLng) {
    const earthRadius = 6371000; // meters
    const latDist = (coinLat - userLat) * (Math.PI / 180) * earthRadius;
    const lngDist = (coinLng - userLng) * (Math.PI / 180) * earthRadius * Math.cos(userLat * Math.PI / 180);
    
    return new THREE.Vector3(
        lngDist,
        0, // Ground level
        -latDist // Negative Z for forward direction
    );
}

export default function View({ coin, onBack }) {
    // Refs and state
    const containerRef = useRef();
    const sceneRef = useRef(new THREE.Scene());
    const rendererRef = useRef();
    const cameraRef = useRef();
    const coinRef = useRef();
    const videoRef = useRef();
    const animationRef = useRef();
    
    const [userLocation, setUserLocation] = useState(null);
    const [userHeading, setUserHeading] = useState(null);
    const [distance, setDistance] = useState(0);
    const [canCollect, setCanCollect] = useState(false);
    const [iosPermissionGranted, setIosPermissionGranted] = useState(false);

    // Initialize Three.js scene
    useEffect(() => {
        // Scene setup
        const scene = sceneRef.current;
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 1.6, 0); // Approximate eye level
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        rendererRef.current = renderer;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // Load coin model
        const loader = new GLTFLoader();
        loader.load('/stylized_coin/scene.gltf', (gltf) => {
            const model = gltf.scene;
            model.scale.set(0.3, 0.3, 0.3);
            model.visible = false;
            scene.add(model);
            coinRef.current = model;
        });

        return () => {
            cancelAnimationFrame(animationRef.current);
            if (rendererRef.current) rendererRef.current.dispose();
        };
    }, []);

    // Camera stream setup
    useEffect(() => {
        const setupCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } }
                });
                
                const video = document.createElement('video');
                video.srcObject = stream;
                video.setAttribute('playsinline', '');
                video.play();
                videoRef.current = video;

                containerRef.current.appendChild(video);
                containerRef.current.appendChild(rendererRef.current.domElement);

                startAnimationLoop();
            } catch (err) {
                console.error("Camera error:", err);
                alert("Camera access required for AR features");
            }
        };

        setupCamera();

        return () => {
            if (videoRef.current?.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Location tracking with smoothing
    useEffect(() => {
        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                setUserLocation(prev => ({
                    latitude: smoothValue(prev?.latitude, pos.coords.latitude, SMOOTHING_FACTOR),
                    longitude: smoothValue(prev?.longitude, pos.coords.longitude, SMOOTHING_FACTOR),
                    accuracy: pos.coords.accuracy
                }));
            },
            console.error,
            { enableHighAccuracy: true, maximumAge: 1000 }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, []);

    // Device orientation with improved iOS handling
    useEffect(() => {
        const handleOrientation = (event) => {
            let heading;
            
            if (event.webkitCompassHeading !== undefined) {
                heading = event.webkitCompassHeading; // iOS
            } else if (event.alpha !== null) {
                heading = (360 - event.alpha) % 360; // Android
            }
            
            if (heading !== undefined) {
                setUserHeading(prev => smoothValue(prev, heading, SMOOTHING_FACTOR));
            }
        };

        if (iosPermissionGranted || !isIOS()) {
            window.addEventListener('deviceorientation', handleOrientation, true);
        }

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation);
        };
    }, [iosPermissionGranted]);

    // Animation loop with optimized coin positioning
    const startAnimationLoop = () => {
        const animate = () => {
            animationRef.current = requestAnimationFrame(animate);
            
            if (userLocation && userHeading !== null && coinRef.current) {
                // Calculate distance
                const dist = haversineDistance(
                    userLocation.latitude,
                    userLocation.longitude,
                    coin.lat,
                    coin.lng
                );
                setDistance(dist);
                
                // Calculate bearing to coin
                const bearing = calculateBearing(
                    userLocation.latitude,
                    userLocation.longitude,
                    coin.lat,
                    coin.lng
                );
                
                // Angle difference between heading and coin
                const angleDiff = ((bearing - userHeading + 540) % 360) - 180;
                
                // Convert geo to world position
                const worldPos = geoToWorldPosition(
                    userLocation.latitude,
                    userLocation.longitude,
                    coin.lat,
                    coin.lng
                );
                
                // Scale based on distance (perspective correction)
                const scale = Math.min(1, 10 / Math.max(1, dist));
                coinRef.current.scale.set(scale, scale, scale);
                
                // Visibility conditions
                const shouldShow = Math.abs(angleDiff) < VIEW_ANGLE && dist < MAX_DISTANCE;
                coinRef.current.visible = shouldShow;
                
                if (shouldShow) {
                    // Position coin in world space
                    coinRef.current.position.copy(worldPos);
                    
                    // Rotate coin (animation)
                    coinRef.current.rotation.y += 0.02;
                    
                    // Face the user
                    coinRef.current.lookAt(new THREE.Vector3(0, 1.6, 0));
                }
                
                // Update camera rotation
                cameraRef.current.rotation.y = -userHeading * (Math.PI / 180);
                
                // Check collection status
                setCanCollect(dist < COLLECTION_DISTANCE && Math.abs(angleDiff) < 15);
            }
            
            rendererRef.current.render(sceneRef.current, cameraRef.current);
        };
        
        animate();
    };

    // Helper functions
    function smoothValue(prev, next, factor) {
        return prev === null || prev === undefined ? next : prev * (1 - factor) + next * factor;
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent);
    }

    const requestCompassPermission = async () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                setIosPermissionGranted(permission === 'granted');
            } catch (err) {
                console.error("Compass permission error:", err);
            }
        }
    };

    const handleCollect = () => {
        if (canCollect) {
            alert(`Collected coin #${coin.id}!`);
            onBack();
        }
    };

    return (
        <div ref={containerRef} className="ar-container">
            {/* iOS permission button */}
            {isIOS() && !iosPermissionGranted && (
                <button className="ios-permission-btn" onClick={requestCompassPermission}>
                    Enable Compass
                </button>
            )}
            
            {/* UI Controls */}
            <button className="back-btn" onClick={onBack}>Back</button>
            
            <div className="info-panel">
                <div>Distance: {distance.toFixed(1)}m</div>
                <div>Status: {canCollect ? "Ready to collect!" : "Move closer"}</div>
            </div>
            
            <button 
                className={`collect-btn ${canCollect ? 'active' : ''}`}
                onClick={handleCollect}
            >
                {canCollect ? "🎯 Collect Coin" : "Too Far"}
            </button>
        </div>
    );
}

// Haversine distance calculation (unchanged from your original)
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

  return R * c;}

// Bearing calculation (unchanged from your original)
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