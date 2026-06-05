import { AlertTriangle, Crosshair, MapPinned, Menu, MessageCircle, Play, Shield, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeZoneMap } from './components/SafeZoneMap';
import { useGeolocation } from './hooks/useGeolocation';
import { useIntervalNow } from './hooks/useIntervalNow';
import { clearMatch, createMatch, patchMatch, subscribeToMatch, upsertPlayer } from './services/matchStore';
import type { Coordinate, Match, Player, View } from './types';
import { DEFAULT_START_DIAMETER_METERS, FINAL_DIAMETER_METERS, formatDistance, haversineDistanceMeters, milesToMeters } from './utils/geo';
import {
  buildSimulatedPlayers,
  calculateSafeZone,
  distanceFromZoneEdgeMeters,
  formatClock,
  generateHostKey,
  generateMatchCode,
  generateStartingCircleCenter,
  getOutsideRemainingMs,
  playerIsInside,
  shouldEliminatePlayer,
} from './utils/game';

const PLAYER_ID_KEY = 'brl:player-id';
const HOST_KEY_PREFIX = 'brl:host:';
const RANDOM_NAMES = ['Ranger', 'Viper', 'Ghost', 'Comet', 'Blaze', 'Hawk', 'Nova', 'Rogue'];
const PLAYER_WRITE_INTERVAL_MS = 3_000;
const PLAYER_MOVE_WRITE_METERS = 5;

type PlayerWriteSnapshot = {
  at: number;
  location?: Coordinate;
  outsideSince?: number | null;
  status: Player['status'];
};

function getPlayerId() {
  const existing = localStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(PLAYER_ID_KEY, next);
  return next;
}

function getInitialCode() {
  return new URLSearchParams(window.location.search).get('match')?.toUpperCase() ?? '';
}

function randomPlayerName() {
  return `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function joinUrl(code: string) {
  return `${location.origin}${location.pathname}?match=${code}`;
}

function sameLocation(a?: Coordinate, b?: Coordinate) {
  if (!a || !b) return a === b;
  return a.lat === b.lat && a.lng === b.lng;
}

function shouldWritePlayerUpdate(lastWrite: PlayerWriteSnapshot | undefined, player: Player, location: Coordinate, outsideSince: number | null, now: number) {
  if (!lastWrite) return true;
  if (player.status !== lastWrite.status) return true;
  if (outsideSince !== lastWrite.outsideSince) return true;
  if (!lastWrite.location) return true;
  if (haversineDistanceMeters(lastWrite.location, location) >= PLAYER_MOVE_WRITE_METERS) return true;
  return now - lastWrite.at >= PLAYER_WRITE_INTERVAL_MS;
}

export default function App() {
  const [view, setView] = useState<View>(getInitialCode() ? 'join' : 'home');
  const [matchCode, setMatchCode] = useState(getInitialCode());
  const [match, setMatch] = useState<Match | null>(null);
  const [hostKey, setHostKey] = useState('');
  const [privateEndpoint, setPrivateEndpoint] = useState<Coordinate | null>(null);
  const [playerId] = useState(getPlayerId);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const outsideSinceRef = useRef(new Map<string, number>());
  const lastVibrationSecondRef = useRef<number | null>(null);
  const lastPlayerWriteRef = useRef(new Map<string, PlayerWriteSnapshot>());
  const now = useIntervalNow(500);
  const locationState = useGeolocation(locationEnabled);

  useEffect(() => {
    if (!matchCode) return;
    return subscribeToMatch(matchCode, setMatch);
  }, [matchCode]);

  const isHost = Boolean(match && hostKey && hostKey === match.hostKey);
  const effectiveMatch = useMemo(
    () => (match && isHost && privateEndpoint ? { ...match, hiddenEndpoint: privateEndpoint } : match),
    [isHost, match, privateEndpoint],
  );
  const zone = useMemo(() => (effectiveMatch ? calculateSafeZone(effectiveMatch, now) : null), [effectiveMatch, now]);
  const currentPlayer = match?.players[playerId];
  const displayedCurrentPlayer = useMemo(() => {
    const localOutsideSince = outsideSinceRef.current.get(playerId);
    if (!currentPlayer || !localOutsideSince || currentPlayer.outsideSince) return currentPlayer;
    return { ...currentPlayer, outsideSince: localOutsideSince };
  }, [currentPlayer, now, playerId]);

  useEffect(() => {
    if (!effectiveMatch || !zone || effectiveMatch.phase !== 'live') {
      outsideSinceRef.current.clear();
      return;
    }

    const trackedPlayers = Object.values(effectiveMatch.players).filter((player) => {
      if (player.status === 'out') return false;
      return isHost || player.id === playerId;
    });

    for (const player of trackedPlayers) {
      const locationValue = player.id === playerId ? locationState.location ?? player.location : player.location;
      if (!locationValue) continue;

      const inside = playerIsInside(effectiveMatch, locationValue, now);
      const cachedOutsideSince = outsideSinceRef.current.get(player.id);
      const outsideSince = inside ? null : player.outsideSince ?? cachedOutsideSince ?? now;

      if (inside) {
        outsideSinceRef.current.delete(player.id);
      } else {
        outsideSinceRef.current.set(player.id, outsideSince ?? now);
      }

      if (shouldEliminatePlayer(effectiveMatch, outsideSince, now)) {
        if (lastPlayerWriteRef.current.get(player.id)?.status === 'out') continue;
        outsideSinceRef.current.delete(player.id);
        lastPlayerWriteRef.current.set(player.id, {
          at: now,
          location: locationValue,
          outsideSince,
          status: 'out',
        });
        void upsertPlayer(effectiveMatch.code, {
          ...player,
          location: locationValue,
          status: 'out',
          outsideSince,
          eliminatedAt: now,
          lastSeenAt: now,
        }).catch(() => lastPlayerWriteRef.current.delete(player.id));
        continue;
      }

      if ((outsideSince !== player.outsideSince || !sameLocation(locationValue, player.location)) && shouldWritePlayerUpdate(lastPlayerWriteRef.current.get(player.id), player, locationValue, outsideSince, now)) {
        lastPlayerWriteRef.current.set(player.id, {
          at: now,
          location: locationValue,
          outsideSince,
          status: player.status,
        });
        void upsertPlayer(effectiveMatch.code, { ...player, location: locationValue, outsideSince, lastSeenAt: now });
      }
    }
  }, [effectiveMatch, isHost, locationState.location, now, playerId, zone]);

  useEffect(() => {
    if (!match || !zone?.isFinished || match.phase === 'ended') return;
    void patchMatch(match.code, { phase: 'ended', endedAt: now });
    setView('results');
  }, [match, now, zone?.isFinished]);

  useEffect(() => {
    if (!effectiveMatch || !isHost || !zone || effectiveMatch.phase !== 'live') return;
    const id = window.setInterval(() => {
      const nextZone = calculateSafeZone(effectiveMatch, Date.now());
      if (nextZone) {
        void patchMatch(effectiveMatch.code, {
          visibleSafeZone: { ...nextZone, publishedAt: Date.now() },
        });
      }
    }, 1_500);
    return () => window.clearInterval(id);
  }, [effectiveMatch, isHost, zone]);

  useEffect(() => {
    if (!match || !currentPlayer || !locationState.location || currentPlayer.status === 'out' || match.phase === 'live') return;
    const outsideSince = currentPlayer.outsideSince ?? null;
    if (!shouldWritePlayerUpdate(lastPlayerWriteRef.current.get(currentPlayer.id), currentPlayer, locationState.location, outsideSince, now)) return;
    lastPlayerWriteRef.current.set(currentPlayer.id, {
      at: now,
      location: locationState.location,
      outsideSince,
      status: currentPlayer.status,
    });
    void upsertPlayer(match.code, { ...currentPlayer, location: locationState.location, lastSeenAt: now });
  }, [currentPlayer, locationState.location, match, now]);

  useEffect(() => {
    if (!effectiveMatch || !zone || effectiveMatch.phase !== 'live' || !displayedCurrentPlayer || displayedCurrentPlayer.status === 'out') {
      lastVibrationSecondRef.current = null;
      return;
    }

    const playerLocation = displayedCurrentPlayer.location ?? locationState.location;
    const outside = !playerIsInside(effectiveMatch, playerLocation, now);
    if (!outside) {
      lastVibrationSecondRef.current = null;
      return;
    }

    const remainingMs = getOutsideRemainingMs(displayedCurrentPlayer.outsideSince, zone.diameterMeters, effectiveMatch.startingDiameterMeters, now);
    const remainingSecond = Math.ceil(remainingMs / 1000);
    if (remainingSecond <= 0 || remainingSecond === lastVibrationSecondRef.current) return;

    lastVibrationSecondRef.current = remainingSecond;
    if ('vibrate' in navigator) {
      navigator.vibrate(120);
    }
  }, [displayedCurrentPlayer, effectiveMatch, locationState.location, now, zone]);

  function enterMatch(code: string, nextView: View = 'join') {
    const normalized = code.trim().toUpperCase();
    setMatchCode(normalized);
    setHostKey(localStorage.getItem(`${HOST_KEY_PREFIX}${normalized}`) ?? '');
    setView(nextView);
  }

  function leaveToHome() {
    setView('home');
    setMatchCode('');
    setMatch(null);
    setPrivateEndpoint(null);
    setMenuOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="brand" onClick={leaveToHome} type="button">
          <Shield size={20} />
          <span>Battle Royale Live</span>
        </button>
        <button className="icon-button" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          <Menu size={22} />
        </button>
      </header>
      {menuOpen ? <AppMenu onClose={() => setMenuOpen(false)} /> : null}

      {view === 'home' ? <HomeScreen onHost={() => setView('setup')} onJoin={enterMatch} /> : null}
      {view === 'setup' ? (
        <MapSetupScreen
          onCreated={(created, key, endpoint) => {
            localStorage.setItem(`${HOST_KEY_PREFIX}${created.code}`, key);
            setHostKey(key);
            setPrivateEndpoint(endpoint);
            setMatchCode(created.code);
            setMatch(created);
            setView('live');
          }}
        />
      ) : null}
      {view === 'join' ? (
        <JoinScreen
          match={match}
          matchCode={matchCode}
          playerId={playerId}
          onCodeChange={enterMatch}
          onLocationRequest={() => setLocationEnabled(true)}
          locationEnabled={locationEnabled}
          locationError={locationState.error}
          location={locationState.location}
          onJoined={() => setView('live')}
        />
      ) : null}
      {view === 'live' && match ? (
        <LiveGameScreen
          match={effectiveMatch ?? match}
          zone={zone}
          now={now}
          isHost={isHost}
          currentPlayer={displayedCurrentPlayer}
          currentLocation={locationState.location}
          onGoResults={() => setView('results')}
        />
      ) : null}
      {view === 'results' && match ? <ResultsScreen match={effectiveMatch ?? match} isHost={isHost} onClear={leaveToHome} /> : null}
    </main>
  );
}

function HomeScreen({ onHost, onJoin }: { onHost: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState(getInitialCode());

  return (
    <section className="screen stack">
      <div className="home-hero-map" aria-label="Map preview with a shrinking battle royale circle">
        <img src="./hero-map.png" alt="Map preview with safe-zone circles" />
      </div>
      <div className="action-grid">
        <button className="primary xl" type="button" onClick={onHost}>
          <MapPinned />
          Host match
        </button>
        <form
          className="join-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) onJoin(code);
          }}
        >
          <label htmlFor="match-code">Join with match code</label>
          <input id="match-code" value={code} maxLength={5} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="A7K2Q" />
          <button className="secondary" type="submit">Join match</button>
        </form>
      </div>
    </section>
  );
}

function MapSetupScreen({ onCreated }: { onCreated: (match: Match, hostKey: string, endpoint: Coordinate) => void }) {
  const [endpoint, setEndpoint] = useState<Coordinate | null>(null);
  const [diameterMiles, setDiameterMiles] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const parsedDiameterMiles = Number(diameterMiles);
  const parsedDurationMinutes = Number(durationMinutes);
  const canCreateLobby = Boolean(endpoint && parsedDiameterMiles >= 0.1 && parsedDurationMinutes >= 1 && !busy);

  async function createLobby() {
    if (!endpoint || !canCreateLobby) return;
    setBusy(true);
    setSetupError('');
    const code = generateMatchCode();
    const hostKey = generateHostKey();
    const startingDiameterMeters = milesToMeters(parsedDiameterMiles);
    const startCenter = generateStartingCircleCenter(endpoint, startingDiameterMeters);
    const match: Match = {
      code,
      hostKey,
      phase: 'setup',
      createdAt: Date.now(),
      startCenter,
      hiddenEndpoint: endpoint,
      startingDiameterMeters,
      finalDiameterMeters: FINAL_DIAMETER_METERS,
      shrinkDurationMs: parsedDurationMinutes * 60_000,
      visibleSafeZone: {
        center: startCenter,
        radiusMeters: startingDiameterMeters / 2,
        diameterMeters: startingDiameterMeters,
        progress: 0,
        timeRemainingMs: parsedDurationMinutes * 60_000,
        isFinished: false,
        publishedAt: Date.now(),
      },
      players: {},
    };

    localStorage.setItem(`${HOST_KEY_PREFIX}${code}`, hostKey);
    try {
      await createMatch(match);
      onCreated(match, hostKey, endpoint);
    } catch (error) {
      console.error(error);
      setBusy(false);
      setSetupError(error instanceof Error ? error.message : 'Could not create lobby. Check the connection and try again.');
    }
  }

  return (
    <section className="screen map-setup">
      <div className="section-heading">
        <p className="eyebrow">Host setup</p>
        <h1>Set the final destination</h1>
        <p>Tap the map to set the hidden endpoint, choose the circle settings, then create the lobby.</p>
      </div>

      <SafeZoneMap selectable selectedPoint={endpoint} onSelectPoint={setEndpoint} showEndpoint className="setup-map" />

      <div className="control-panel">
        <label>
          Starting diameter
          <div className="input-row">
            <input type="number" min="0.1" step="0.1" value={diameterMiles} onChange={(event) => setDiameterMiles(event.target.value)} />
            <span>miles</span>
          </div>
        </label>
        <label>
          Total shrink time
          <div className="input-row">
            <input type="number" min="1" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
            <span>minutes</span>
          </div>
        </label>
        <button className="primary xl" type="button" disabled={!canCreateLobby} onClick={createLobby}>
          <Users />
          {busy ? 'Creating lobby...' : 'Create lobby'}
        </button>
        {setupError ? <p className="warning-text">{setupError}</p> : null}
      </div>
    </section>
  );
}

function JoinScreen({
  match,
  matchCode,
  playerId,
  onCodeChange,
  onLocationRequest,
  locationEnabled,
  locationError,
  location,
  onJoined,
}: {
  match: Match | null;
  matchCode: string;
  playerId: string;
  onCodeChange: (code: string) => void;
  onLocationRequest: () => void;
  locationEnabled: boolean;
  locationError?: string;
  location?: Coordinate;
  onJoined: () => void;
}) {
  const [code, setCode] = useState(matchCode);
  const [name, setName] = useState('');
  const joinedPlayer = match?.players[playerId];

  useEffect(() => setCode(matchCode), [matchCode]);

  async function join() {
    if (!match) return;
    const playerName = name.trim() || randomPlayerName();
    const player: Player = {
      id: playerId,
      name: playerName,
      status: 'active',
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      location,
      outsideSince: null,
    };
    await upsertPlayer(match.code, player);
    setName(playerName);
    onJoined();
  }

  return (
    <section className="screen stack">
      <div className="section-heading">
        <p className="eyebrow">Player join</p>
        <h1>Join the lobby</h1>
      </div>

      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault();
          onCodeChange(code);
        }}
      >
        <label htmlFor="join-code">Match code</label>
        <input id="join-code" value={code} maxLength={5} onChange={(event) => setCode(event.target.value.toUpperCase())} />
        <button className="secondary" type="submit">Load match</button>
      </form>

      {match ? (
        <div className="form-card">
          <div className="match-code">{match.code}</div>
          <p className="ok-text">{match.phase === 'setup' ? 'Lobby found. Waiting for host.' : 'Game is live.'}</p>
          <label htmlFor="player-name">Display name</label>
          <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={joinedPlayer?.name ?? 'Random name will be assigned if left blank'} />
          <p className="muted">Enable GPS before joining so the host can see you as ready.</p>
          <button className="secondary" type="button" onClick={onLocationRequest}>
            <Crosshair />
            {locationEnabled ? 'Refresh GPS permission' : 'Enable GPS'}
          </button>
          {locationError ? <p className="warning-text">{locationError}</p> : null}
          {location ? <p className="ok-text">GPS ready.</p> : null}
          <button className="primary xl" type="button" onClick={join}>
            {joinedPlayer ? `Joined as ${joinedPlayer.name}` : 'Join lobby'}
          </button>
        </div>
      ) : matchCode ? (
        <p className="warning-text">No lobby found for {matchCode}. Check the code, or make sure Firebase is configured for multi-phone play.</p>
      ) : (
        <p className="muted">Open an invite link or enter a code from the host.</p>
      )}
    </section>
  );
}

function LiveGameScreen({
  match,
  zone,
  now,
  isHost,
  currentPlayer,
  currentLocation,
  onGoResults,
}: {
  match: Match;
  zone: ReturnType<typeof calculateSafeZone>;
  now: number;
  isHost: boolean;
  currentPlayer?: Player;
  currentLocation?: Coordinate;
  onGoResults: () => void;
}) {
  const players = Object.values(match.players);
  const visiblePlayers = isHost ? players : currentPlayer ? [currentPlayer] : [];
  const inside = zone && currentPlayer ? playerIsInside(match, currentPlayer.location ?? currentLocation, now) : true;
  const remainingOutsideMs = zone && currentPlayer ? getOutsideRemainingMs(currentPlayer.outsideSince, zone.diameterMeters, match.startingDiameterMeters, now) : 0;
  const edgeDistance = currentPlayer ? distanceFromZoneEdgeMeters(match, currentPlayer.location ?? currentLocation, now) : null;

  async function startGame() {
    if (!match.hiddenEndpoint || !match.startCenter) return;
    const startedAt = Date.now();
    const liveMatch: Match = { ...match, phase: 'live', startedAt };
    const nextZone = calculateSafeZone(liveMatch, startedAt);
    await patchMatch(match.code, {
      phase: 'live',
      startedAt,
      visibleSafeZone: nextZone ? { ...nextZone, publishedAt: startedAt } : match.visibleSafeZone,
    });
  }

  function invitePlayers() {
    const message = `Join my Battle Royale Live lobby: ${joinUrl(match.code)}`;
    window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
  }

  async function addSimulatedPlayers() {
    if (!zone) return;
    const simulated = buildSimulatedPlayers(zone.center, zone.radiusMeters);
    await Promise.all(
      simulated.map((sim) =>
        upsertPlayer(match.code, {
          id: sim.id,
          name: sim.name,
          status: 'active',
          joinedAt: now,
          lastSeenAt: now,
          location: sim.location,
          outsideSince: null,
          isSimulated: true,
        }),
      ),
    );
  }

  if (match.phase === 'setup') {
    return (
      <section className="screen stack">
        <div className="section-heading">
          <p className="eyebrow">Lobby</p>
          <h1>{isHost ? 'Invite players' : 'Waiting for host'}</h1>
          <p>{isHost ? 'Players can join now. Start the game when everyone is ready.' : 'You are in the lobby. Keep this screen open.'}</p>
        </div>

        <div className="live-panel">
          <div className="host-code">
            <span>Match code</span>
            <strong>{match.code}</strong>
            <small>{joinUrl(match.code)}</small>
          </div>

          {isHost ? (
            <div className="button-row">
              <button className="secondary" type="button" onClick={invitePlayers}>
                <MessageCircle />
                Invite players
              </button>
              <button className="primary" type="button" onClick={startGame}>
                <Play />
                Start game
              </button>
            </div>
          ) : null}

          <div className="panel-list">
            {players.length === 0 ? <p className="muted">No players have joined yet.</p> : null}
            {players.map((player) => (
              <div className="player-row inside" key={player.id}>
                <div>
                  <strong>{player.name}</strong>
                  <small>{player.location ? 'GPS ready' : 'Waiting for GPS'}</small>
                </div>
                <span>{player.status === 'out' ? 'OUT' : 'READY'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="live-screen">
      <div className="live-map-wrap">
        <SafeZoneMap zone={zone} endpoint={isHost ? match.hiddenEndpoint : null} showEndpoint={isHost} players={visiblePlayers} ownLocation={currentLocation} className="live-map" />
        {currentPlayer?.status === 'out' ? (
          <div className="status-banner out">OUT</div>
        ) : !inside ? (
          <div className="status-banner danger">
            <AlertTriangle />
            Outside zone: {formatClock(remainingOutsideMs)}
          </div>
        ) : (
          <div className="status-banner safe">Inside safe zone</div>
        )}
      </div>

      <div className="live-panel">
        <div className="stats-row">
          <Stat label="Time" value={zone ? formatClock(zone.timeRemainingMs) : '--'} />
          <Stat label="Circle" value={zone ? formatDistance(zone.diameterMeters) : '--'} />
          <Stat label="Active" value={players.filter((player) => player.status === 'active').length.toString()} />
        </div>
        {edgeDistance !== null ? (
          <p className={edgeDistance >= 0 ? 'ok-text' : 'warning-text'}>
            {edgeDistance >= 0 ? `${formatDistance(edgeDistance)} inside the edge` : `${formatDistance(Math.abs(edgeDistance))} outside the edge`}
          </p>
        ) : null}
        <div className="button-row">
          {isHost ? <button className="secondary" type="button" onClick={addSimulatedPlayers}>Add sample players</button> : null}
        </div>
        {isHost ? <HostPanel match={match} now={now} onGoResults={onGoResults} /> : <PlayerPanel player={currentPlayer} />}
      </div>
    </section>
  );
}

function HostPanel({ match, now, onGoResults }: { match: Match; now: number; onGoResults: () => void }) {
  const players = Object.values(match.players).sort((a, b) => a.name.localeCompare(b.name));

  async function endMatch() {
    await patchMatch(match.code, { phase: 'ended', endedAt: now });
    onGoResults();
  }

  return (
    <div className="panel-list">
      <div className="host-code">
        <span>Match code</span>
        <strong>{match.code}</strong>
        <small>{joinUrl(match.code)}</small>
      </div>
      <button className="danger-button" type="button" onClick={endMatch}>End match</button>
      {players.length === 0 ? <p className="muted">Waiting for players.</p> : null}
      {players.map((player) => <PlayerRow key={player.id} player={player} match={match} now={now} />)}
    </div>
  );
}

function PlayerPanel({ player }: { player?: Player }) {
  if (!player) return <p className="muted">Join this match as a player to see your live status.</p>;
  return (
    <div className="player-card">
      <span>Your status</span>
      <strong>{player.status === 'out' ? 'OUT' : 'ACTIVE'}</strong>
      <small>Last update {new Date(player.lastSeenAt).toLocaleTimeString()}</small>
    </div>
  );
}

function PlayerRow({ player, match, now }: { player: Player; match: Match; now: number }) {
  const playerZone = calculateSafeZone(match, now);
  const insidePlayer = playerZone ? playerIsInside(match, player.location, now) : true;
  const remaining = playerZone ? getOutsideRemainingMs(player.outsideSince, playerZone.diameterMeters, match.startingDiameterMeters, now) : 0;
  return (
    <div className={`player-row ${player.status === 'out' ? 'eliminated' : insidePlayer ? 'inside' : 'outside'}`}>
      <div>
        <strong>{player.name}</strong>
        <small>{player.location ? new Date(player.lastSeenAt).toLocaleTimeString() : 'No GPS fix'}</small>
      </div>
      <span>{player.status === 'out' ? 'OUT' : insidePlayer ? 'IN' : formatClock(remaining)}</span>
    </div>
  );
}

function ResultsScreen({ match, isHost, onClear }: { match: Match; isHost: boolean; onClear: () => void }) {
  const players = Object.values(match.players);
  const active = players.filter((player) => player.status === 'active');
  const eliminated = players.filter((player) => player.status === 'out');

  async function clear() {
    await clearMatch(match.code);
    onClear();
  }

  return (
    <section className="screen stack">
      <div className="section-heading">
        <p className="eyebrow">Game over</p>
        <h1>{active.length ? `${active.length} survivor${active.length === 1 ? '' : 's'}` : 'No survivors'}</h1>
      </div>
      <div className="results-grid">
        <div className="result-column">
          <h2>Active</h2>
          {active.map((player) => <PlayerBadge key={player.id} player={player} />)}
        </div>
        <div className="result-column">
          <h2>Eliminated</h2>
          {eliminated.map((player) => <PlayerBadge key={player.id} player={player} />)}
        </div>
      </div>
      {isHost ? (
        <button className="danger-button xl" type="button" onClick={clear}>
          <Trash2 />
          Clear match data
        </button>
      ) : null}
    </section>
  );
}

function AppMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="menu-backdrop" role="presentation" onClick={onClose}>
      <aside className="app-menu" aria-label="Application menu" onClick={(event) => event.stopPropagation()}>
        <div className="menu-header">
          <strong>Menu</strong>
          <button className="icon-button" type="button" aria-label="Close menu" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <section>
          <p className="eyebrow">About</p>
          <h2>Battle Royale Live</h2>
          <p>Host an outdoor match, share a lobby code, and run a live shrinking safe zone using player phone locations.</p>
        </section>

        <section className="menu-safety">
          <p className="eyebrow">Safety</p>
          <p>Play only in approved areas, avoid roads and private property, wear proper eye protection, and follow local rules.</p>
        </section>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlayerBadge({ player }: { player: Player }) {
  return (
    <div className="player-badge">
      <Users size={16} />
      {player.name}
    </div>
  );
}
