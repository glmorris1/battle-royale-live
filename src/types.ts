export type Coordinate = {
  lat: number;
  lng: number;
};

export type PlayerStatus = 'active' | 'out';

export type Player = {
  id: string;
  name: string;
  status: PlayerStatus;
  joinedAt: number;
  lastSeenAt: number;
  location?: Coordinate;
  outsideSince?: number | null;
  eliminatedAt?: number;
  isSimulated?: boolean;
};

export type MatchPhase = 'setup' | 'live' | 'ended';

export type Match = {
  code: string;
  hostKey: string;
  phase: MatchPhase;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  startCenter?: Coordinate;
  hiddenEndpoint?: Coordinate;
  startingDiameterMeters: number;
  shrinkDurationMs: number;
  finalDiameterMeters: number;
  visibleSafeZone?: PublishedSafeZone;
  players: Record<string, Player>;
};

export type PublicMatch = Omit<Match, 'hiddenEndpoint' | 'hostKey'>;

export type SafeZoneState = {
  center: Coordinate;
  radiusMeters: number;
  diameterMeters: number;
  progress: number;
  timeRemainingMs: number;
  isFinished: boolean;
};

export type PublishedSafeZone = SafeZoneState & {
  publishedAt: number;
};

export type View = 'home' | 'setup' | 'join' | 'live' | 'results';
