import { useState } from 'react';
import CoinMap from './Components/CoinMap';
import ARView from './Components/ARView';

export default function App() {
  const [mode, setMode] = useState('map');
  const [selectedCoin, setSelectedCoin] = useState(null);

  return (
    <>
      {mode === 'map' ? (
        <CoinMap
          onEnterAR={(coin) => {
            setSelectedCoin(coin);
            setMode('ar');
          }}
        />
      ) : (
        <ARView
          coin={selectedCoin}
          onBack={() => {
            setSelectedCoin(null);
            setMode('map');
          }}
        />
      )}
    </>
  );
}
