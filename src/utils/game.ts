import type { Coordinate, Match, SafeZoneState } from '../types';
import {
  destinationPoint,
  FINAL_DIAMETER_METERS,
  haversineDistanceMeters,
  isInsideCircle,
} from './geo';

export function generateMatchCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export function generateHostKey(): string {
  return crypto.randomUUID();
}

export function generateStartingCircleCenter(
  endpoint: Coordinate,
  startingDiameterMeters: number,
): Coordinate {
  const radius = startingDiameterMeters / 2;
  const bearing = Math.random() * 360;

  // Offset the selected endpoint away from center by 30-72% of the start radius.
  // That keeps the endpoint inside the opening circle while preventing it from
  // looking like the obvious final target.
  const offsetMeters = radius * (0.3 + Math.random() * 0.42);

  return destinationPoint(endpoint, offsetMeters, bearing);
}

export function calculateSafeZone(match: Match, now = Date.now()): SafeZoneState | null {
  if (!match.hiddenEndpoint && match.visibleSafeZone) {
    return {
      ...match.visibleSafeZone,
      timeRemainingMs: match.startedAt ? Math.max(0, match.shrinkDurationMs - (now - match.startedAt)) : match.visibleSafeZone.timeRemainingMs,
    };
  }

  if (!match.startCenter || !match.hiddenEndpoint || !match.startedAt) {
    return null;
  }

  const duration = Math.max(1, match.shrinkDurationMs);
  const elapsed = Math.max(0, now - match.startedAt);
  const progress = Math.min(1, elapsed / duration);
  const startRadius = match.startingDiameterMeters / 2;
  const endRadius = match.finalDiameterMeters / 2;

  // Both center and radius interpolate linearly against real timestamps. This
  // makes the circle shrink smoothly and consistently even if a phone sleeps or
  // misses animation frames.
  const center = {
    lat: match.startCenter.lat + (match.hiddenEndpoint.lat - match.startCenter.lat) * progress,
    lng: match.startCenter.lng + (match.hiddenEndpoint.lng - match.startCenter.lng) * progress,
  };
  const radiusMeters = startRadius + (endRadius - startRadius) * progress;

  return {
    center,
    radiusMeters,
    diameterMeters: radiusMeters * 2,
    progress,
    timeRemainingMs: Math.max(0, duration - elapsed),
    isFinished: progress >= 1 || radiusMeters * 2 <= FINAL_DIAMETER_METERS,
  };
}

export function getAllowedOutsideMs(currentDiameterMeters: number, startingDiameterMeters: number): number {
  return Math.max(5_000, 20_000 * (currentDiameterMeters / startingDiameterMeters));
}

export function getOutsideRemainingMs(
  outsideSince: number | null | undefined,
  currentDiameterMeters: number,
  startingDiameterMeters: number,
  now = Date.now(),
): number {
  if (!outsideSince) return getAllowedOutsideMs(currentDiameterMeters, startingDiameterMeters);
  return Math.max(0, getAllowedOutsideMs(currentDiameterMeters, startingDiameterMeters) - (now - outsideSince));
}

export function playerIsInside(match: Match, location: Coordinate | undefined, now = Date.now()): boolean {
  const zone = calculateSafeZone(match, now);
  if (!zone) return true;
  return isInsideCircle(location, zone.center, zone.radiusMeters);
}

export function shouldEliminatePlayer(
  match: Match,
  outsideSince: number | null | undefined,
  now = Date.now(),
): boolean {
  const zone = calculateSafeZone(match, now);
  if (!zone || !outsideSince) return false;
  return getOutsideRemainingMs(outsideSince, zone.diameterMeters, match.startingDiameterMeters, now) <= 0;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function buildSimulatedPlayers(center: Coordinate, radiusMeters: number) {
  return [
    {
      id: `sim-${crypto.randomUUID()}`,
      name: 'Scout',
      location: destinationPoint(center, radiusMeters * 0.35, 40),
    },
    {
      id: `sim-${crypto.randomUUID()}`,
      name: 'Runner',
      location: destinationPoint(center, radiusMeters * 0.8, 210),
    },
    {
      id: `sim-${crypto.randomUUID()}`,
      name: 'Drifter',
      location: destinationPoint(center, radiusMeters * 1.08, 305),
    },
  ];
}

export function distanceFromZoneEdgeMeters(match: Match, location: Coordinate | undefined, now = Date.now()) {
  const zone = calculateSafeZone(match, now);
  if (!zone || !location) return null;
  return zone.radiusMeters - haversineDistanceMeters(location, zone.center);
}
