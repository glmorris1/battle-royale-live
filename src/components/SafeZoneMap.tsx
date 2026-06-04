import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Coordinate, Player, SafeZoneState } from '../types';
import { useEffect } from 'react';

type SafeZoneMapProps = {
  zone?: SafeZoneState | null;
  endpoint?: Coordinate | null;
  players?: Player[];
  ownLocation?: Coordinate;
  selectable?: boolean;
  selectedPoint?: Coordinate | null;
  onSelectPoint?: (coordinate: Coordinate) => void;
  showEndpoint?: boolean;
  className?: string;
};

const defaultCenter: Coordinate = { lat: 39.8283, lng: -98.5795 };

function MapClickHandler({ onSelectPoint }: { onSelectPoint?: (coordinate: Coordinate) => void }) {
  useMapEvents({
    click(event) {
      onSelectPoint?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  return null;
}

function FitToZone({ zone, point }: { zone?: SafeZoneState | null; point?: Coordinate | null }) {
  const map = useMap();

  useEffect(() => {
    if (zone) {
      const offset = zone.radiusMeters / 111_320;
      map.fitBounds(
        [
          [zone.center.lat - offset, zone.center.lng - offset],
          [zone.center.lat + offset, zone.center.lng + offset],
        ],
        { padding: [24, 24], maxZoom: 18 },
      );
      return;
    }

    if (point) {
      map.setView([point.lat, point.lng], 15);
    }
  }, [map, point, zone]);

  return null;
}

export function SafeZoneMap({
  zone,
  endpoint,
  players = [],
  ownLocation,
  selectable,
  selectedPoint,
  onSelectPoint,
  showEndpoint = false,
  className,
}: SafeZoneMapProps) {
  const center = zone?.center ?? selectedPoint ?? ownLocation ?? endpoint ?? defaultCenter;

  return (
    <MapContainer
      className={className ?? 'map'}
      center={[center.lat, center.lng]}
      zoom={zone ? 15 : selectedPoint ? 15 : 4}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {selectable ? <MapClickHandler onSelectPoint={onSelectPoint} /> : null}
      <FitToZone zone={zone} point={selectedPoint ?? endpoint ?? ownLocation} />

      {zone ? (
        <Circle
          center={[zone.center.lat, zone.center.lng]}
          radius={zone.radiusMeters}
          pathOptions={{
            color: '#8ef05c',
            fillColor: '#8ef05c',
            fillOpacity: 0.14,
            weight: 3,
          }}
        />
      ) : null}

      {selectedPoint ? (
        <CircleMarker center={[selectedPoint.lat, selectedPoint.lng]} radius={8} pathOptions={{ color: '#ffcf5a', fillOpacity: 0.9 }}>
          <Popup>Final endpoint selected</Popup>
        </CircleMarker>
      ) : null}

      {showEndpoint && endpoint ? (
        <CircleMarker center={[endpoint.lat, endpoint.lng]} radius={6} pathOptions={{ color: '#ff5b5b', fillOpacity: 0.9 }}>
          <Popup>Hidden endpoint</Popup>
        </CircleMarker>
      ) : null}

      {ownLocation ? (
        <CircleMarker center={[ownLocation.lat, ownLocation.lng]} radius={7} pathOptions={{ color: '#54a9ff', fillOpacity: 0.9 }}>
          <Popup>Your location</Popup>
        </CircleMarker>
      ) : null}

      {players.map((player) =>
        player.location ? (
          <CircleMarker
            key={player.id}
            center={[player.location.lat, player.location.lng]}
            radius={player.status === 'out' ? 5 : 7}
            pathOptions={{
              color: player.status === 'out' ? '#8b939f' : player.isSimulated ? '#ffcf5a' : '#f7f9fb',
              fillOpacity: player.status === 'out' ? 0.45 : 0.88,
            }}
          >
            <Popup>
              {player.name}
              {player.status === 'out' ? ' - OUT' : ''}
            </Popup>
          </CircleMarker>
        ) : null,
      )}
    </MapContainer>
  );
}
