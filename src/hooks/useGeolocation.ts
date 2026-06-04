import { useEffect, useState } from 'react';
import type { Coordinate } from '../types';

type LocationState = {
  location?: Coordinate;
  accuracy?: number;
  error?: string;
  permissionState: 'idle' | 'watching' | 'denied' | 'unsupported';
};

export function useGeolocation(enabled: boolean) {
  const [state, setState] = useState<LocationState>({ permissionState: 'idle' });

  useEffect(() => {
    if (!enabled) return;

    if (!navigator.geolocation) {
      setState({ permissionState: 'unsupported', error: 'Location is not available on this device.' });
      return;
    }

    setState((current) => ({ ...current, permissionState: 'watching', error: undefined }));
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setState({
          permissionState: 'watching',
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        setState({
          permissionState: error.code === error.PERMISSION_DENIED ? 'denied' : 'idle',
          error: error.message,
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3_000,
        timeout: 15_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return state;
}
