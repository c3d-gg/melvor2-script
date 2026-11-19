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
  /** A missing or invalid parameter, e.g. an enemy that isn't in the area you named, or a speed outside 1..1000. */
  | 'BAD_REQUEST'
  /** The game's mod doesn't know this call: it's older than your client. Update both to the same version. */
  | 'UNKNOWN_METHOD'
  /** No such skill, recipe, item, area or enemy. With the typed ids this is rare. */
  | 'NOT_FOUND'
  /** Requirements not met: your level is too low, or an area isn't unlocked yet. */
  | 'LOCKED'
  /** Not enough materials (or bank space) for a crafting recipe. */
  | 'MISSING_ITEMS'
  /**
   * Not possible here: a skill without actions yet, `start()` in Scripted Mode, or `act()` with Scripted Mode
   * off.
   */
  | 'UNSUPPORTED'
  /** The game didn't do it, for a reason the runtime couldn't name. The message says what it saw. */
  | 'FAILED'
  /** No save loaded, still loading, or offline progress is running. */
  | 'NOT_READY'
  /**
   * Not ready yet. Scripted Mode: the cooldown after the last action hasn't finished. Real time: changing the
   * active action again within 1 s. `data.readyInMs` says how long is left.
   */
  | 'COOLDOWN'
  /** Scripted Mode: a multi-action `act` is still running. */
  | 'BUSY'
  /** More than 60 calls in one second from one script. */
  | 'RATE_LIMITED'
  /** Client-side only: the connection to the game dropped. */
  | 'DISCONNECTED';

/** What an `act` did (Scripted Mode). */
export interface ActionResult {
  /** False when it stopped early (only returned instead of thrown with `allowStop`). */
  completed: boolean;
  /** How many actions ran. */
  actions: number;
  /** XP gained in the acting skill. */
  xp: number;
  /** Bank changes, item id -> +/- quantity. */
  items: Record<string, number>;
  /** From the first action to the last, in milliseconds. */
  durationMs: number;
  /** Cooldown left when the reply was sent. */
  readyInMs: number;
  /** Why it stopped early. */
  stopped?: string;
}

/** Scripted Mode settings and pacing, from `m.setScripted()` or `bunx melvor2 scripted`. */
export interface ScriptedStatus {
  /** Scripted Mode is on for the loaded save. */
  on: boolean;
  /** Cooldown = action time ÷ speed. Shared by every Scripted save (1 to 1000, default 10). */
  speed: number;
  /** The shortest cooldown, whatever the speed (50 ms). */
  minCooldownMs: number;
  /** Milliseconds until the next action is allowed. */
  readyInMs: number;
  /** A multi-action `act` is running. */
  busy: boolean;
  /** The loaded save's id, or null on the main menu. */
  save: string | null;
}

/** The `error` of a failed call on the wire. The client turns it into a `MelvorError`. */
export interface RpcErrorShape {
  code: ErrorCode;
  /** What went wrong, in words. */
  message: string;
  /** Extra details: `readyInMs` for COOLDOWN, the partial ActionResult for an `act` that stopped early. */
  data?: unknown;
}

/** One skill in `m.state.skills`. */
export interface SkillState {
  /** The in-game name, e.g. 'Woodcutting'. */
  name: string;
  level: number;
  /** Total XP. */
  xp: number;
  /** XP still needed for the next level. */
  xpToNext: number;
}

/** What the character is doing: an entry of `m.state.active`. */
export interface ActiveAction {
  /** Skill id, e.g. 'MelvorBase:Woodcutting' ('MelvorBase:Combat' while fighting). */
  skill: string;
  /** Recipe id, e.g. 'MelvorBase:NormalTree', when the action has one. */
  recipe: string | null;
  /** The recipe's in-game name, e.g. 'Normal Tree'. */
  recipeName: string | null;
}

/** The game as the runtime sees it. Pushed as a 'state' notification whenever it changes (max 4/s). */
export interface GameState {
  /** Application mode: 'MainMenu', 'Game', 'MelvorCloud', ... */
  mode: string;
  /** A save is loaded and ready: actions work. */
  saveLoaded: boolean;
  /** Offline progress is running. Calls that touch the game reject with NOT_READY until it's done. */
  offline: boolean;
  /** Scripted Mode for the loaded save (see ScriptedStatus). */
  scripted?: { on: boolean; speed: number };
  /** Keyed by skill id, e.g. 'MelvorBase:Woodcutting'. */
  skills?: Record<string, SkillState>;
  /** Item id -> quantity. */
  bank?: Record<string, number>;
  /** Bank slots in use, and how many there are. */
  bankSlots?: { used: number; max: number };
  /** Currency id -> amount ('MelvorBase:GoldPieces', ...). */
  currencies?: Record<string, number>;
  /** What the character is doing (empty when idle). */
  active?: ActiveAction[];
  /** Combat: 'Idle', 'Spawning' or 'Fighting', your hitpoints, and the area you're fighting in. */
  combat?: { state: string; hp: number; maxHp: number; area: string | null };
}

/** The runtime and the game, from `bunx melvor2 status`. */
export interface RuntimeInfo {
  /** The mod's version. */
  runtimeVersion: string;
  /** 1 after a game start, +1 per hot reload. */
  generation: number;
  /** The protocol version (PROTOCOL_VERSION). */
  protocol: number;
  /** Melvor Idle 2's version, e.g. '0.11.6-alpha'. */
  gameVersion: string;
  /** Application mode, as in GameState. */
  mode: string;
  /** The .NET version the game runs on. */
  dotnet: string;
}

/** One thing a skill can do, from `m.skills.<name>.recipes()`. */
export interface RecipeInfo {
  /** Recipe id, e.g. 'MelvorBase:NormalTree'. */
  id: string;
  /** In-game name, e.g. 'Normal Tree'. */
  name: string;
  /** Requirements met: `start` and `act` would accept it. */
  unlocked: boolean;
}

/** A save on this PC, from `bunx melvor2 saves`. */
export interface SaveInfo {
  /** Pass to `m.loadSave(id)`. */
  id: string;
  /** Character name. */
  name: string;
  /** When it was last saved (ISO 8601). */
  timestamp: string;
  totalLevel: number;
  /** Where the newest copy is (local or cloud). */
  source: string;
}

/** Things the game tells scripts as they happen. Listen with `m.on(type, fn)`. */
export type GameEvent =
  /** A skill gained a level (`from` is the level before). */
  | { type: 'levelUp'; skill: string; level: number; from: number }
  /** The character started, switched or stopped an action (yours, or a click). */
  | { type: 'actionChanged'; active: ActiveAction[] }
  /** The game changed screens, or a save finished loading or was closed. */
  | { type: 'modeChanged'; mode: string; saveLoaded: boolean };

/** Every call the runtime understands: params and result. */
export interface Methods {
  /** Say who you are (shown in the game's log) and get the runtime info. `run()` sends it for you. */
  'runtime.hello': [{ name?: string }, RuntimeInfo];
  /** The runtime and game versions. */
  'runtime.info': [void, RuntimeInfo];
  /** Swap the in-game runtime for the dll on disk without restarting the game (dev loop). */
  'runtime.reload': [void, { reloading: boolean; generation: number }];
  /** The whole state, now. Scripts get it pushed as 'state' notifications instead. */
  'state.get': [void, GameState];
  /** The saves on this PC. */
  'game.saves': [void, SaveInfo[]];
  /** From the main menu: load a save (the most recent by default). */
  'game.loadSave': [{ id?: string }, { loading: string; name: string }];
  /** What a skill can do, with `unlocked`. */
  'skill.recipes': [{ skill: string }, RecipeInfo[]];
  /** Real time: start (or switch to) a recipe. Limited to one action switch per second (COOLDOWN). */
  'skill.start': [{ skill: string; recipe: string }, { started: boolean; already?: boolean }];
  /** Scripted Mode: `count` instant actions spaced by the cooldown. */
  'skill.act': [{ skill: string; recipe: string; count?: number; allowStop?: boolean }, ActionResult];
  /** Scripted Mode settings and the cooldown left. */
  'scripted.status': [void, ScriptedStatus];
  /** `on` applies to the loaded save; `speed` to all Scripted saves. */
  'scripted.set': [{ on?: boolean; speed?: number }, ScriptedStatus];
  /** Stop whatever the character is doing, and cancel a running `act`. */
  'action.stop': [void, { stopped: boolean; active: boolean }];
  /** Fight an enemy in an area. Counts as an action switch (one per second). */
  'combat.fight': [{ area: string; enemy: string }, { state: string }];
  /** Leave combat. */
  'combat.stop': [void, { stopped: boolean }];
  /** Eat the selected food once. */
  'combat.eat': [void, { hp: number; healed: number }];
  /** Write a line in the game's log. */
  'ui.log': [{ message: string }, null];
}

export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = Methods[M][0];
export type ResultOf<M extends MethodName> = Methods[M][1];
