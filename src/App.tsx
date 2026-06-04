import { AlertTriangle, Crosshair, MapPinned, Play, Shield, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SafeZoneMap } from './components/SafeZoneMap';
import { useGeolocation } from './hooks/useGeolocation';
import { useIntervalNow } from './hooks/useIntervalNow';
import { clearMatch, createMatch, isCloudSyncEnabled, patchMatch, subscribeToMatch, upsertPlayer } from './services/matchStore';
import type { Coordinate, Match, Player, View } from './types';
import {
  DEFAULT_START_DIAMETER_METERS,
  FINAL_DIAMETER_METERS,
  formatDistance,
  milesToMeters,
} from './utils/geo';
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

export default function App() {
  const [view, setView] = useState<View>(getInitialCode() ? 'join' : 'home');
  const [matchCode, setMatchCode] = useState(getInitialCode());
  const [match, setMatch] = useState<Match | null>(null);
  const [hostKey, setHostKey] = useState('');
  const [privateEndpoint, setPrivateEndpoint] = useState<Coordinate | null>(null);
  const [playerId] = useState(getPlayerId);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
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

  useEffect(() => {
    if (!effectiveMatch || !zone || !currentPlayer || currentPlayer.status === 'out') return;
    const inside = playerIsInside(effectiveMatch, currentPlayer.location, now);
    const outsideSince = inside ? null : currentPlayer.outsideSince ?? now;

    if (shouldEliminatePlayer(effectiveMatch, outsideSince, now)) {
      void upsertPlayer(effectiveMatch.code, {
        ...currentPlayer,
        status: 'out',
        outsideSince,
        eliminatedAt: now,
        lastSeenAt: now,
      });
      return;
    }

    if (outsideSince !== currentPlayer.outsideSince) {
      void upsertPlayer(effectiveMatch.code, { ...currentPlayer, outsideSince, lastSeenAt: now });
    }
  }, [currentPlayer, effectiveMatch, now, zone]);

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
    if (!match || !currentPlayer || !locationState.location || currentPlayer.status === 'out') return;
    void upsertPlayer(match.code, {
      ...currentPlayer,
      location: locationState.location,
      lastSeenAt: now,
    });
  }, [currentPlayer, locationState.location, match, now]);

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
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="brand" onClick={leaveToHome} type="button">
          <Shield size={20} />
          <span>Battle Royale Live</span>
        </button>
        <span className={isCloudSyncEnabled() ? 'sync-pill online' : 'sync-pill'}>
          {isCloudSyncEnabled() ? 'Firebase sync' : 'Local sim'}
        </span>
      </header>

      {view === 'home' ? <HomeScreen onHost={() => setView('setup')} onJoin={enterMatch} /> : null}
      {view === 'setup' ? <MapSetupScreen onCreated={(created, key) => {
        localStorage.setItem(`${HOST_KEY_PREFIX}${created.code}`, key);
        setHostKey(key);
        setPrivateEndpoint(created.hiddenEndpoint ?? null);
        setMatchCode(created.code);
        setMatch(created);
        setView('live');
      }} /> : null}
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
          currentPlayer={currentPlayer}
          currentLocation={locationState.location}
          simulationMode={simulationMode}
          onEnableLocation={() => setLocationEnabled(true)}
          onToggleSimulation={() => setSimulationMode((value) => !value)}
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
      <div className="hero-panel">
        <p className="eyebrow">Outdoor safe-zone controller</p>
        <h1>Run the shrinking circle from any phone.</h1>
        <p>
          Host a match, share a code, and track whether each player is inside the live zone.
        </p>
      </div>

      <SafetyPanel />

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
          <input
            id="match-code"
            value={code}
            maxLength={5}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="A7K2Q"
          />
          <button className="secondary" type="submit">Join match</button>
        </form>
      </div>
    </section>
  );
}

function MapSetupScreen({ onCreated }: { onCreated: (match: Match, hostKey: string) => void }) {
  const [endpoint, setEndpoint] = useState<Coordinate | null>(null);
  const [diameterMiles, setDiameterMiles] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [busy, setBusy] = useState(false);

  async function startMatch() {
    if (!endpoint) return;
    setBusy(true);
    const code = generateMatchCode();
    const hostKey = generateHostKey();
    const startingDiameterMeters = milesToMeters(diameterMiles);
    const startCenter = generateStartingCircleCenter(endpoint, startingDiameterMeters);
    const match: Match = {
      code,
      hostKey,
      phase: 'live',
      createdAt: Date.now(),
      startedAt: Date.now(),
      startCenter,
      hiddenEndpoint: endpoint,
      startingDiameterMeters,
      finalDiameterMeters: FINAL_DIAMETER_METERS,
      shrinkDurationMs: durationMinutes * 60_000,
      visibleSafeZone: {
        center: startCenter,
        radiusMeters: startingDiameterMeters / 2,
        diameterMeters: startingDiameterMeters,
        progress: 0,
        timeRemainingMs: durationMinutes * 60_000,
        isFinished: false,
        publishedAt: Date.now(),
      },
      players: {},
    };

    await createMatch(match);
    onCreated(match, hostKey);
  }

  return (
    <section className="screen map-setup">
      <div className="section-heading">
        <p className="eyebrow">Host setup</p>
        <h1>Pick the final circle endpoint</h1>
        <p>Tap the map where the one-foot final zone should end. Players will never see this point.</p>
      </div>

      <SafeZoneMap selectable selectedPoint={endpoint} onSelectPoint={setEndpoint} showEndpoint className="setup-map" />

      <div className="control-panel">
        <label>
          Starting diameter
          <div className="input-row">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={diameterMiles}
              onChange={(event) => setDiameterMiles(Number(event.target.value))}
            />
            <span>miles</span>
          </div>
        </label>
        <label>
          Total shrink time
          <div className="input-row">
            <input
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            />
            <span>minutes</span>
          </div>
        </label>
        <button className="primary xl" type="button" disabled={!endpoint || busy} onClick={startMatch}>
          <Play />
          Start game
        </button>
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

  async function join() {
    if (!match || !name.trim()) return;
    const player: Player = {
      id: playerId,
      name: name.trim(),
      status: 'active',
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      location,
      outsideSince: null,
    };
    await upsertPlayer(match.code, player);
    onJoined();
  }

  return (
    <section className="screen stack">
      <div className="section-heading">
        <p className="eyebrow">Player join</p>
        <h1>Join the match</h1>
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
          <label htmlFor="player-name">Display name</label>
          <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Callsign" />
          <p className="muted">Location is used only for this active match. Host cleanup deletes match data when play is over.</p>
          <button className="secondary" type="button" onClick={onLocationRequest}>
            <Crosshair />
            {locationEnabled ? 'Refresh location permission' : 'Grant location permission'}
          </button>
          {locationError ? <p className="warning-text">{locationError}</p> : null}
          {location ? <p className="ok-text">GPS lock acquired.</p> : null}
          <button className="primary xl" type="button" disabled={!name.trim()} onClick={join}>Enter live game</button>
        </div>
      ) : (
        <p className="muted">Enter a code from the host. Local simulation codes only work in this browser unless Firebase is configured.</p>
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
  simulationMode,
  onEnableLocation,
  onToggleSimulation,
  onGoResults,
}: {
  match: Match;
  zone: ReturnType<typeof calculateSafeZone>;
  now: number;
  isHost: boolean;
  currentPlayer?: Player;
  currentLocation?: Coordinate;
  simulationMode: boolean;
  onEnableLocation: () => void;
  onToggleSimulation: () => void;
  onGoResults: () => void;
}) {
  const players = Object.values(match.players);
  const visiblePlayers = isHost ? players : currentPlayer ? [currentPlayer] : [];
  const inside = zone && currentPlayer ? playerIsInside(match, currentPlayer.location ?? currentLocation, now) : true;
  const remainingOutsideMs =
    zone && currentPlayer
      ? getOutsideRemainingMs(currentPlayer.outsideSince, zone.diameterMeters, match.startingDiameterMeters, now)
      : 0;
  const edgeDistance = currentPlayer ? distanceFromZoneEdgeMeters(match, currentPlayer.location ?? currentLocation, now) : null;

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

  return (
    <section className="live-screen">
      <div className="live-map-wrap">
        <SafeZoneMap
          zone={zone}
          endpoint={isHost ? match.hiddenEndpoint : null}
          showEndpoint={isHost}
          players={visiblePlayers}
          ownLocation={currentLocation}
          className="live-map"
        />
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
          <button className="secondary" type="button" onClick={onEnableLocation}>Enable GPS</button>
          <button className="secondary" type="button" onClick={onToggleSimulation}>
            {simulationMode ? 'Simulation on' : 'Simulation mode'}
          </button>
          {simulationMode || isHost ? <button className="secondary" type="button" onClick={addSimulatedPlayers}>Add sample players</button> : null}
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
        <small>{`${location.origin}${location.pathname}?match=${match.code}`}</small>
      </div>
      <button className="danger-button" type="button" onClick={endMatch}>End match</button>
      {players.length === 0 ? <p className="muted">Waiting for players.</p> : null}
      {players.map((player) => (
        <PlayerRow key={player.id} player={player} match={match} now={now} />
      ))}
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
  const zone = calculateSafeZone(match, now);
  const inside = zone ? playerIsInside(match, player.location, now) : true;
  const remaining = zone ? getOutsideRemainingMs(player.outsideSince, zone.diameterMeters, match.startingDiameterMeters, now) : 0;

  return (
    <div className={`player-row ${player.status === 'out' ? 'eliminated' : inside ? 'inside' : 'outside'}`}>
      <div>
        <strong>{player.name}</strong>
        <small>{player.location ? new Date(player.lastSeenAt).toLocaleTimeString() : 'No GPS fix'}</small>
      </div>
      <span>{player.status === 'out' ? 'OUT' : inside ? 'IN' : formatClock(remaining)}</span>
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

function SafetyPanel() {
  return (
    <div className="safety-panel">
      <AlertTriangle />
      <p>
        Play only in approved areas, avoid roads and private property, wear proper eye protection, and follow local rules.
      </p>
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
