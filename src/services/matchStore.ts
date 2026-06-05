import {
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import type { Match, Player } from '../types';

type Unsubscribe = () => void;

const LOCAL_PREFIX = 'brl:match:';
const localListeners = new Map<string, Set<(match: Match | null) => void>>();
const FIREBASE_WRITE_TIMEOUT_MS = 10_000;

function localKey(code: string) {
  return `${LOCAL_PREFIX}${code.toUpperCase()}`;
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function readLocalMatch(code: string): Match | null {
  const raw = localStorage.getItem(localKey(code));
  return raw ? (JSON.parse(raw) as Match) : null;
}

function emitLocal(code: string) {
  const match = readLocalMatch(code);
  localListeners.get(normalizeCode(code))?.forEach((listener) => listener(match));
  window.dispatchEvent(new StorageEvent('storage', { key: localKey(code) }));
}

function writeLocalMatch(match: Match) {
  localStorage.setItem(localKey(match.code), JSON.stringify(match));
  emitLocal(match.code);
}

function publicFirebaseMatch(match: Match): Match {
  const { hiddenEndpoint: _hiddenEndpoint, ...publicMatch } = match;
  return publicMatch;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    ) as T;
  }

  return value;
}

function withFirebaseTimeout<T>(operation: Promise<T>, action: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`Firebase did not finish ${action}. Check the connection or Firebase quota, then try again.`));
    }, FIREBASE_WRITE_TIMEOUT_MS);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

export function subscribeToMatch(code: string, callback: (match: Match | null) => void): Unsubscribe {
  const normalizedCode = normalizeCode(code);

  if (firebaseConfigured && db) {
    return onSnapshot(doc(db, 'matches', normalizedCode), (snapshot) => {
      callback(snapshot.exists() ? (snapshot.data() as Match) : null);
    });
  }

  const listeners = localListeners.get(normalizedCode) ?? new Set();
  listeners.add(callback);
  localListeners.set(normalizedCode, listeners);

  const storageHandler = (event: StorageEvent) => {
    if (!event.key || event.key === localKey(normalizedCode)) {
      callback(readLocalMatch(normalizedCode));
    }
  };

  window.addEventListener('storage', storageHandler);
  callback(readLocalMatch(normalizedCode));

  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', storageHandler);
  };
}

export async function createMatch(match: Match) {
  const normalized = { ...match, code: normalizeCode(match.code) };
  if (firebaseConfigured && db) {
    await withFirebaseTimeout(
      setDoc(doc(db, 'matches', normalized.code), stripUndefined(publicFirebaseMatch(normalized))),
      'creating the lobby',
    );
    return;
  }
  writeLocalMatch(normalized);
}

export async function patchMatch(code: string, patch: Partial<Match>) {
  const normalizedCode = normalizeCode(code);
  if (firebaseConfigured && db) {
    const { hiddenEndpoint: _hiddenEndpoint, ...publicPatch } = patch;
    await withFirebaseTimeout(updateDoc(doc(db, 'matches', normalizedCode), stripUndefined(publicPatch)), 'updating the match');
    return;
  }

  const current = readLocalMatch(normalizedCode);
  if (!current) return;
  writeLocalMatch({ ...current, ...patch });
}

export async function upsertPlayer(code: string, player: Player) {
  const normalizedCode = normalizeCode(code);
  const cleanPlayer = stripUndefined(player);
  if (firebaseConfigured && db) {
    await withFirebaseTimeout(
      updateDoc(doc(db, 'matches', normalizedCode), {
        [`players.${cleanPlayer.id}`]: cleanPlayer,
      }),
      'saving the player',
    );
    return;
  }

  const current = readLocalMatch(normalizedCode);
  if (!current) return;
  writeLocalMatch({
    ...current,
    players: {
      ...current.players,
      [cleanPlayer.id]: cleanPlayer,
    },
  });
}

export async function clearMatch(code: string) {
  const normalizedCode = normalizeCode(code);
  if (firebaseConfigured && db) {
    await withFirebaseTimeout(deleteDoc(doc(db, 'matches', normalizedCode)), 'clearing the match');
    return;
  }

  localStorage.removeItem(localKey(normalizedCode));
  emitLocal(normalizedCode);
}

export function isCloudSyncEnabled() {
  return Boolean(firebaseConfigured && db);
}
