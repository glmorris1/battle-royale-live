import type { Coordinate } from '../types';

const EARTH_RADIUS_METERS = 6_371_000;

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_FOOT = 0.3048;
export const DEFAULT_START_DIAMETER_METERS = METERS_PER_MILE;
export const FINAL_DIAMETER_METERS = METERS_PER_FOOT;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function destinationPoint(
  origin: Coordinate,
  distanceMeters: number,
  bearingDegrees: number,
): Coordinate {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lng: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

export function formatDistance(meters: number): string {
  if (meters >= METERS_PER_MILE * 0.2) {
    return `${metersToMiles(meters).toFixed(2)} mi`;
  }

  if (meters >= 10) {
    return `${Math.round(meters)} m`;
  }

  return `${metersToFeet(meters).toFixed(1)} ft`;
}

export function isInsideCircle(
  point: Coordinate | undefined,
  center: Coordinate,
  radiusMeters: number,
): boolean {
  if (!point) return false;
  return haversineDistanceMeters(point, center) <= radiusMeters;
}

export function midpoint(a: Coordinate, b: Coordinate): Coordinate {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}
