import { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { showWarningAlert } from '../utils/alert';
import { haversineDistance } from '../utils/utils';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const COINS = [
  { id: 1, lat: 31.5204, lng: 74.3587 },
  { id: 2, lat: 33.6844, lng: 73.0479 },
  { id: 3, lat: 31.660101, lng: 73.935246 },
  { id: 4, lat: 31.420211, lng: 74.24318 },
  { id: 5, lat: 31.660054, lng: 73.935277 },
  { id: 6, lat: 31.5654144, lng: 74.3571456 },
  { id: 7, lat: 31.559992487574895, lng: 74.39599295296996 },
  { id: 8, lat: 30.9723136, lng: 73.9704832 },
  { id: 9, lat: 31.5293698, lng: 74.3243778 },
  { id: 10, lat: 31.506432, lng: 74.3374848 },
  { id: 11, lat: 31.47093, lng: 74.30472 },
  {id: 12, lat: 31.4602862,lng:74.3235425}
];

export default function CoinMap({ onEnterAR }) {
  const [userLocation, setUserLocation] = useState(null);
  const mapContainer = useRef(null);
  const map = useRef(null);

  // Initialize map and markers
  useEffect(() => {
    if (!userLocation || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 15,
      attributionControl: false,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // Add user marker
    new mapboxgl.Marker({ color: 'blue' })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .addTo(map.current);

    // Add coin markers
    COINS.forEach((coin) => {
      const marker = new mapboxgl.Marker()
        .setLngLat([coin.lng, coin.lat])
        .addTo(map.current);

      const el = marker.getElement();
      el.style.fontSize = '24px';
      el.style.cursor = 'pointer';
      el.innerHTML = '🪙';

      // Optional: marker click directly opens AR if near enough
      el.addEventListener('click', () => {
        const dist = haversineDistance(userLocation, {
          latitude: coin.lat,
          longitude: coin.lng,
        });
        if (dist < 500) {
          onEnterAR(coin);
        } else {
          showWarningAlert('📍You are too far from the coin.', 'Got it');
        }
      });
    });

    return () => map.current?.remove();
  }, [userLocation]);

  // Track user location
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      (err) => console.error('Location error:', err),
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Handler for "Enter AR View" button
  const handleARClick = () => {
    if (!userLocation) {
      showWarningAlert('📍 Location not available.', 'OK');
      return;
    }

    let closestCoin = null;
    let closestDist = Infinity;

    COINS.forEach((coin) => {
      const dist = haversineDistance(userLocation, {
        latitude: coin.lat,
        longitude: coin.lng,
      });
      if (dist < closestDist) {
        closestDist = dist;
        closestCoin = coin;
      }
    });

    if (closestCoin && closestDist < 500) {
      onEnterAR(closestCoin);
    } else {
      showWarningAlert('📍You are too far from any coin.', 'Got it');
    }
  };


  return (
    <div className="relative h-screen">
      <div ref={mapContainer} className="h-full" />

      <button
        onClick={handleARClick}
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2 px-5 py-3 bg-blue-600 text-white rounded-lg font-bold z-10 shadow-md text-xl"
      >
        🎯 Enter AR View
      </button>
    </div>

  );
}
