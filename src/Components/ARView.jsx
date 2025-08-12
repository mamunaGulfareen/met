import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

// Detect iOS for compass permission
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Smooth transition helper
function smoothValue(prev, next, factor = 0.2) {
  if (prev === null || isNaN(prev)) return next;
  return prev + (next - prev) * factor;
}

// Haversine distance (meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Bearing in degrees 0-360
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

// Convert lat/lng to relative 3D position (meters)
function latLngToPosition(userPos, targetPos) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(userPos.latitude);
  const lon1 = toRad(userPos.longitude);
  const lat2 = toRad(targetPos.lat);
  const lon2 = toRad(targetPos.lng);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const x = R * dLon * Math.cos((lat1 + lat2) / 2);
  const z = R * dLat;

  // y=0 ground level, z negated for forward in Three.js coordinate system
  return { x, y: 0, z: -z };
}

// Generate random spawn points around user (100m radius)
function generateSpawnPoints(userLocation, count = 5) {
  if (!userLocation) return [];
  const spawns = [];
  for (let i = 0; i < count; i++) {
    // Random offsets ± ~0.0009 degrees (~100m)
    const latOffset = (Math.random() - 0.5) * 0.0018;
    const lngOffset = (Math.random() - 0.5) * 0.0018;
    spawns.push({
      id: i + 1,
      lat: userLocation.latitude + latOffset,
      lng: userLocation.longitude + lngOffset,
      caught: false,
    });
  }
  return spawns;
}

export default function PokemonGoStyleAR({ onBack }) {
  const containerRef = useRef();
  const videoRef = useRef();
  const cameraRef = useRef();
  const rendererRef = useRef();
  const animationFrameId = useRef();
  const userLocationRef = useRef(null);
  const spawnModelsRef = useRef({});

  const [userLocation, setUserLocation] = useState(null);
  const [userHeading, setUserHeading] = useState(null);
  const [spawnPoints, setSpawnPoints] = useState([]);
  const [closestSpawn, setClosestSpawn] = useState(null);

  // Threshold constants
  const SHOW_MODEL_DISTANCE = 10; // meters to start showing model
  const MAX_VISIBLE_DISTANCE = 50; // max distance for scaling and interaction
  const MAX_ANGLE_DIFF = 45; // degrees user must face within to see model

  // Update ref on user location change for animation loop
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // Watch user location + heading
  useEffect(() => {
    const handlePosition = (pos) => {
      const { latitude, longitude, heading } = pos.coords;

      setUserLocation((prev) =>
        prev
          ? {
              latitude: smoothValue(prev.latitude, latitude, 0.2),
              longitude: smoothValue(prev.longitude, longitude, 0.2),
            }
          : { latitude, longitude }
      );

      if (heading !== null && !isNaN(heading)) {
        setUserHeading((prev) => smoothValue(prev, heading, 0.15));
      }
    };

    navigator.geolocation.getCurrentPosition(handlePosition, (e) => {
      console.error("Initial location error", e);
    }, { enableHighAccuracy: true });

    const watchId = navigator.geolocation.watchPosition(handlePosition, (e) => {
      console.error("Watch location error", e);
    }, { enableHighAccuracy: true, maximumAge: 1000 });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Device orientation (compass)
  useEffect(() => {
    const handleOrientation = (event) => {
      let heading = null;
      if (isIOS() && typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading;
      } else if (event.alpha !== null) {
        heading = (360 - event.alpha) % 360;
      }
      if (heading !== null && !isNaN(heading)) {
        setUserHeading((prev) => smoothValue(prev, heading, 0.15));
      }
    };

    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation);
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, []);

  // Generate spawn points on user location change
  useEffect(() => {
    if (userLocation) {
      setSpawnPoints(generateSpawnPoints(userLocation, 5));
    }
  }, [userLocation]);

  // Setup Three.js scene + load models for spawns
  useEffect(() => {
    if (!userLocation) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 2;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = 0;
    renderer.domElement.style.left = 0;
    renderer.domElement.style.zIndex = "1";
    rendererRef.current = renderer;

    if (containerRef.current) {
      containerRef.current.appendChild(renderer.domElement);
    }

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Load models for spawns
    const loader = new GLTFLoader();
    const modelUrl =
      "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF/Duck.gltf";

    spawnPoints.forEach((spawn) => {
      loader.load(
        modelUrl,
        (gltf) => {
          const model = gltf.scene;
          model.scale.set(0.5, 0.5, 0.5);
          model.userData = { spawnId: spawn.id, caught: false };
          model.visible = false;
          scene.add(model);
          spawnModelsRef.current[spawn.id] = model;
        },
        undefined,
        (err) => console.error("Model load error:", err)
      );
    });

    // Animation loop
    function animate() {
      animationFrameId.current = requestAnimationFrame(animate);

      const userLoc = userLocationRef.current;
      if (!userLoc) {
        renderer.render(scene, camera);
        return;
      }

      let closest = null;
      let closestDist = Infinity;

      spawnPoints.forEach((spawn) => {
        const model = spawnModelsRef.current[spawn.id];
        if (!model || spawn.caught) return;

        const dist = haversineDistance(userLoc.latitude, userLoc.longitude, spawn.lat, spawn.lng);
        const bearing = calculateBearing(userLoc.latitude, userLoc.longitude, spawn.lat, spawn.lng);

        let angleDiff = Math.abs(((bearing - userHeading) + 360) % 360);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        const pos = latLngToPosition(userLoc, spawn);

        const vector = new THREE.Vector3(pos.x, pos.y, pos.z);
        vector.project(camera);

        const onScreen = vector.z < 1 && vector.x > -1 && vector.x < 1 && vector.y > -1 && vector.y < 1;

        const visible = dist <= SHOW_MODEL_DISTANCE && angleDiff <= MAX_ANGLE_DIFF && onScreen;

        model.visible = visible;

        if (visible) {
          model.position.set(pos.x, pos.y, pos.z);
          model.rotation.y += 0.01;

          const scaleFactor = THREE.MathUtils.clamp(1.5 - dist / MAX_VISIBLE_DISTANCE, 0.5, 1.5);
          model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        if (dist < closestDist) {
          closestDist = dist;
          closest = { ...spawn, distance: dist, angleDiff, onScreen };
        }
      });

      if (closest) {
        setClosestSpawn(closest);
      }

      if (camera) {
        const headingRad = (userHeading * Math.PI) / 180;
        camera.rotation.set(0, -headingRad, 0);
      }

      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener("resize", onResize);
      Object.values(spawnModelsRef.current).forEach((model) => scene.remove(model));
      spawnModelsRef.current = {};
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement && containerRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
      }
    };
  }, [spawnPoints, userHeading, userLocation]);

  // Camera video setup & start
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        alert("Camera access is required for AR features.");
        console.error("Camera error:", err);
      }
    }
    startCamera();

    // Cleanup video on unmount
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Handle Pokémon catch on click/tap
  const handleClick = (event) => {
    if (!cameraRef.current || !spawnPoints.length) return;

    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);

    const intersects = raycaster.intersectObjects(
      Object.values(spawnModelsRef.current).filter((m) => m.visible),
      true
    );

    if (intersects.length > 0) {
      let pickedModel = intersects[0].object;
      while (pickedModel.parent && !pickedModel.userData.spawnId) {
        pickedModel = pickedModel.parent;
      }

      const spawnId = pickedModel.userData.spawnId;

      setSpawnPoints((prev) =>
        prev.map((spawn) =>
          spawn.id === spawnId ? { ...spawn, caught: true } : spawn
        )
      );

      pickedModel.visible = false;

      alert(`You caught Pokémon #${spawnId}! 🎉`);
    }
  };

  return (
    <div
      style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}
      onClick={handleClick}
    >
      {/* Video background */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          zIndex: 0,
        }}
      />

      {/* Three.js canvas */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          pointerEvents: "none", // let clicks pass through, catch on parent div
        }}
      />

      {/* UI overlays */}
      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          padding: "8px 12px",
          fontSize: 16,
          borderRadius: 6,
          backgroundColor: "white",
          border: "none",
          cursor: "pointer",
          pointerEvents: "auto", // enable button clicks
        }}
      >
        Back
      </button>

      <div
        style={{
          position: "absolute",
          top: 70,
          left: 20,
          zIndex: 10,
          backgroundColor: "rgba(0,0,0,0.6)",
          color: "white",
          padding: "8px 12px",
          borderRadius: 6,
          maxWidth: 280,
          fontSize: 14,
          userSelect: "none",
          pointerEvents: "auto",
        }}
      >
        <div>
          <b>Your location:</b>{" "}
          {userLocation
            ? `${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)}`
            : "Loading..."}
        </div>
        <div>
          <b>Heading:</b> {userHeading !== null ? `${Math.round(userHeading)}°` : "Loading..."}
        </div>
        <div>
          <b>Pokémon nearby:</b> {spawnPoints.filter((p) => !p.caught).length}
        </div>
        <div>Tap a Pokémon to catch it!</div>
      </div>

      {closestSpawn && !closestSpawn.caught && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            zIndex: 10,
            backgroundColor: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "12px 16px",
            borderRadius: 8,
            maxWidth: 320,
            fontSize: 16,
            userSelect: "none",
            pointerEvents: "auto",
          }}
        >
          <div>
            <b>Closest Pokémon ID:</b> {closestSpawn.id}
          </div>
          <div>
            <b>Distance:</b> {closestSpawn.distance.toFixed(1)} meters
          </div>
          <div>
            {closestSpawn.distance <= SHOW_MODEL_DISTANCE &&
            closestSpawn.onScreen &&
            closestSpawn.angleDiff <= MAX_ANGLE_DIFF
              ? "You are very close! The Pokémon is right here."
              : "Move closer and face the Pokémon to see it."}
          </div>
        </div>
      )}
    </div>
  );
}
