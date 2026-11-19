/**
 * Wire protocol between the in-game runtime (C#, mod/runtime) and the TypeScript client.
 * Same shape as melvor-script for Melvor 1:
 *   client -> server  { id, method, params }            request
 *   server -> client  { id, result } | { id, error }    response
 *   server -> client  { method, params }                notification (no id): 'state', 'event'
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7338;

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNKNOWN_METHOD'
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'MISSING_ITEMS'
  | 'UNSUPPORTED'
  | 'FAILED'
  /** No save loaded, still loading, or offline progress is running. */
  | 'NOT_READY'
  /** Changing the active action again within 1 s. `data.readyInMs` says how long is left. */
  | 'COOLDOWN'
  | 'RATE_LIMITED';

export interface RpcErrorShape {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

export interface SkillState {
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
}

export interface ActiveAction {
  skill: string;
  recipe: string | null;
  recipeName: string | null;
}

/** The game as the runtime sees it. Pushed as a 'state' notification whenever it changes (max 4/s). */
export interface GameState {
  /** Application mode: 'MainMenu', 'Game', 'MelvorCloud', ... */
  mode: string;
  saveLoaded: boolean;
  offline: boolean;
  /** Keyed by skill id, e.g. 'MelvorBase:Woodcutting'. */
  skills?: Record<string, SkillState>;
  /** Item id -> quantity. */
  bank?: Record<string, number>;
  bankSlots?: { used: number; max: number };
  /** Currency id -> amount ('MelvorBase:GoldPieces', ...). */
  currencies?: Record<string, number>;
  active?: ActiveAction[];
  combat?: { state: string; hp: number; maxHp: number; area: string | null };
}

export interface RuntimeInfo {
  runtimeVersion: string;
  /** 1 after a game start, +1 per hot reload. */
  generation: number;
  protocol: number;
  gameVersion: string;
  mode: string;
  dotnet: string;
}

export interface RecipeInfo {
  id: string;
  name: string;
  unlocked: boolean;
}

export interface SaveInfo {
  id: string;
  name: string;
  timestamp: string;
  totalLevel: number;
  source: string;
}

export type GameEvent =
  | { type: 'levelUp'; skill: string; level: number; from: number }
  | { type: 'actionChanged'; active: ActiveAction[] }
  | { type: 'modeChanged'; mode: string; saveLoaded: boolean };

/** Every call the runtime understands: params and result. */
export interface Methods {
  'runtime.hello': [{ name?: string }, RuntimeInfo];
  'runtime.info': [void, RuntimeInfo];
  /** Swap the in-game runtime for the dll on disk without restarting the game (dev loop). */
  'runtime.reload': [void, { reloading: boolean; generation: number }];
  'state.get': [void, GameState];
  'game.saves': [void, SaveInfo[]];
  'game.loadSave': [{ id?: string }, { loading: string; name: string }];
  'skill.recipes': [{ skill: string }, RecipeInfo[]];
  'skill.start': [{ skill: string; recipe: string }, { started: boolean; already?: boolean }];
  'action.stop': [void, { stopped: boolean; active: boolean }];
  'combat.fight': [{ area: string; enemy: string }, { state: string }];
  'combat.stop': [void, { stopped: boolean }];
  'combat.eat': [void, { hp: number; healed: number }];
  'ui.log': [{ message: string }, null];
}

export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = Methods[M][0];
export type ResultOf<M extends MethodName> = Methods[M][1];
