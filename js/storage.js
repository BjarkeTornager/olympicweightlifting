import { APP_META, DEFAULT_PROFILE, DEFAULT_PRS, PROGRAM_DEFINITION } from "./data.js";

const STORAGE_KEY = `lift-journal:v${APP_META.dataSchemaVersion}`;
const LEGACY_KEYS = ["lift-journal", "olympic-weightlifting-data", "weightlifting-app-data"];

export class StorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "StorageError";
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createDefaultState() {
  const now = new Date().toISOString();

  return {
    schemaVersion: APP_META.dataSchemaVersion,
    createdAt: now,
    updatedAt: now,
    profile: clone(DEFAULT_PROFILE),
    prs: clone(DEFAULT_PRS),
    sessions: [],
    activeWorkout: null,
    program: {
      activeProgramId: PROGRAM_DEFINITION.id,
      programRevision: PROGRAM_DEFINITION.revision,
      customPrograms: [],
    },
    preferences: {
      installHintDismissed: false,
    },
  };
}

function finiteNumber(value, fallback) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeState(input) {
  const defaults = createDefaultState();
  const source = input && typeof input === "object" ? input : {};
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const prs = source.prs && typeof source.prs === "object" ? source.prs : {};

  return {
    ...defaults,
    ...source,
    schemaVersion: APP_META.dataSchemaVersion,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : defaults.createdAt,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : defaults.updatedAt,
    profile: {
      ...defaults.profile,
      ...profile,
      bodyweight: finiteNumber(profile.bodyweight, defaults.profile.bodyweight),
      age: finiteNumber(profile.age, defaults.profile.age),
      unit: "kg",
    },
    prs: Object.fromEntries(
      Object.entries(defaults.prs).map(([exerciseId, defaultValue]) => [
        exerciseId,
        finiteNumber(prs[exerciseId], defaultValue),
      ]),
    ),
    sessions: Array.isArray(source.sessions) ? source.sessions.filter(Boolean) : [],
    activeWorkout:
      source.activeWorkout && typeof source.activeWorkout === "object" ? source.activeWorkout : null,
    program: {
      ...defaults.program,
      ...(source.program && typeof source.program === "object" ? source.program : {}),
      customPrograms: Array.isArray(source.program?.customPrograms) ? source.program.customPrograms : [],
    },
    preferences: {
      ...defaults.preferences,
      ...(source.preferences && typeof source.preferences === "object" ? source.preferences : {}),
    },
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return createDefaultState();

  const version = Number(raw.schemaVersion ?? 1);
  let migrated = clone(raw);

  // Version 1 prototypes stored a draft under `activeSession` and profile
  // numbers at the root. Keep this migration small and tolerant so old local
  // backups can be recovered without constraining future server models.
  if (version < 2) {
    migrated = {
      ...migrated,
      profile: {
        ...(migrated.profile ?? {}),
        bodyweight: migrated.profile?.bodyweight ?? migrated.bodyweight,
        age: migrated.profile?.age ?? migrated.age,
      },
      activeWorkout: migrated.activeWorkout ?? migrated.activeSession ?? null,
      schemaVersion: 2,
    };
    delete migrated.bodyweight;
    delete migrated.age;
    delete migrated.activeSession;
  }

  if (version > APP_META.dataSchemaVersion) {
    throw new StorageError(
      `This backup uses schema version ${version}, but this app supports up to version ${APP_META.dataSchemaVersion}.`,
    );
  }

  return normalizeState(migrated);
}

function readKey(key) {
  const serialized = window.localStorage.getItem(key);
  if (!serialized) return null;

  try {
    return JSON.parse(serialized);
  } catch (error) {
    throw new StorageError("Saved training data could not be read. Import a valid backup to recover it.", error);
  }
}

export function loadState() {
  try {
    const current = readKey(STORAGE_KEY);
    if (current) return migrate(current);

    for (const legacyKey of LEGACY_KEYS) {
      const legacy = readKey(legacyKey);
      if (!legacy) continue;
      const migrated = migrate(legacy);
      saveState(migrated);
      return migrated;
    }

    return createDefaultState();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("Local storage is unavailable in this browser mode.", error);
  }
}

export function saveState(state) {
  const normalized = normalizeState({ ...state, updatedAt: new Date().toISOString() });

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    throw new StorageError(
      "Your latest change could not be saved locally. Check available device storage and export a backup.",
      error,
    );
  }

  return normalized;
}

export function createBackup(state) {
  return {
    schemaVersion: APP_META.dataSchemaVersion,
    exportedAt: new Date().toISOString(),
    app: {
      name: APP_META.name,
      programId: PROGRAM_DEFINITION.id,
      programRevision: PROGRAM_DEFINITION.revision,
    },
    data: normalizeState(state),
  };
}

export function parseBackup(serialized) {
  let parsed;

  try {
    parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch (error) {
    throw new StorageError("That file is not valid JSON.", error);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StorageError("That file does not contain a Lift Journal backup.");
  }

  const candidate = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const declaredVersion = Number(parsed.schemaVersion ?? candidate.schemaVersion ?? 1);

  if (!Number.isFinite(declaredVersion) || declaredVersion < 1) {
    throw new StorageError("The backup schema version is missing or invalid.");
  }

  if (!Array.isArray(candidate.sessions)) {
    throw new StorageError("The backup is missing its sessions list.");
  }

  return migrate({ ...candidate, schemaVersion: declaredVersion });
}

export function replaceState(nextState) {
  return saveState(nextState);
}

export function getStorageKey() {
  return STORAGE_KEY;
}
