import { Connection, MelvorError } from './connection.ts';
import { Skills } from '../shared/ids.generated.ts';
import type { ActionResult, GameEvent, GameState, RecipeInfo, ScriptedStatus, SkillState } from '../shared/protocol.ts';

type SkillKey = Uncapitalize<keyof typeof Skills>;

/**
 * One skill: live level and XP from `m.state`, plus its actions.
 *
 * Actions (`start`, `act`, `recipes`) work for Woodcutting, Mining and Fishing, and for every crafting
 * skill: Smithing, Cooking, Firemaking, Crafting, Fletching, Runecrafting, Herblore and Beastcrafting.
 * The other skills reject them with UNSUPPORTED for now; their level and XP still work.
 */
export class Skill {
  constructor(
    private m: Melvor,
    /** The skill's id, e.g. 'MelvorBase:Woodcutting' (the same as `Skills.Woodcutting`). */
    readonly id: string,
  ) {}

  private get s(): SkillState | undefined {
    return this.m.state.skills?.[this.id];
  }
  /** Current level (0 until the first state arrives). */
  get level(): number {
    return this.s?.level ?? 0;
  }
  /** Total XP in this skill. */
  get xp(): number {
    return this.s?.xp ?? 0;
  }
  /** XP still needed for the next level. */
  get xpToNext(): number {
    return this.s?.xpToNext ?? 0;
  }
  /** True while this skill is the active action. */
  get active(): boolean {
    return (this.m.state.active ?? []).some((a) => a.skill === this.id);
  }
  /** The recipe being worked on, if this skill is active. */
  get current(): string | null {
    return (this.m.state.active ?? []).find((a) => a.skill === this.id)?.recipe ?? null;
  }

  /**
   * Start (or switch to) a recipe: a tree, rock, fish, or anything a crafting skill makes. The action
   * then repeats in real time like it does when you click it. Starting the current recipe does nothing.
   * Waits out the 1 s switch cooldown by itself. Throws LOCKED / MISSING_ITEMS / NOT_FOUND, and
   * UNSUPPORTED in Scripted Mode (use `act` there).
   */
  async start(recipe: string): Promise<{ started: boolean; already?: boolean }> {
    return this.m._switch(() => this.m.conn.call('skill.start', { skill: this.id, recipe }));
  }

  /** Everything this skill can do, with `unlocked` = requirements met. */
  recipes(): Promise<RecipeInfo[]> {
    return this.m.conn.call('skill.recipes', { skill: this.id });
  }

  /**
   * Scripted Mode: do the recipe at once (one hit, catch, craft step...), `count` times, spaced by the
   * cooldown (action time ÷ speed). Resolves with what happened once you're ready to act again, so
   * `while (...) await act(x)` paces itself.
   *
   * Calling it while not ready rejects at once with COOLDOWN (or BUSY), without reaching the game: check
   * `m.ready` in loops. If a multi-action call ends early (out of materials, you clicked something else...)
   * it throws with the partial result in `error.data`, unless you pass `allowStop: true`.
   * Throws UNSUPPORTED when Scripted Mode is off for this save.
   */
  act(recipe: string, opts: { count?: number; allowStop?: boolean } = {}): Promise<ActionResult> {
    const p = this.m._act(this.id, recipe, opts);
    p.catch((e) => this.m._unhandled(e)); // a fire-and-forget call warns instead of crashing the loop
    return p;
  }
}

type Listener = (e: GameEvent) => void;

/**
 * The game, from a script's point of view: its live state, your skills, combat, events and the
 * Scripted Mode cooldown. `run()` hands you one; every example calls it `m`.
 */
export class Melvor {
  /** Live mirror of the game, refreshed whenever it changes (up to 4 times a second). */
  state: GameState = { mode: 'None', saveLoaded: false, offline: false };
  /**
   * One object per skill, named like the `Skills` ids but starting lower case: `m.skills.woodcutting`,
   * `m.skills.mining`, `m.skills.beastcrafting`... Each has its live level and XP, and its actions.
   */
  readonly skills: Record<SkillKey, Skill>;
  private listeners = new Map<string, Set<Listener>>();
  private stateListeners = new Set<(s: GameState) => void>();

  constructor(
    /**
     * The low-level connection. `m.conn.call(method, params)` sends any call from the protocol,
     * including ones `m` doesn't wrap (yet), e.g. `m.conn.call('skill.recipes', { skill: Skills.Mining })`.
     */
    readonly conn: Connection,
  ) {
    const skills = {} as Record<SkillKey, Skill>;
    for (const [name, id] of Object.entries(Skills))
      skills[(name[0]!.toLowerCase() + name.slice(1)) as SkillKey] = new Skill(this, id);
    this.skills = skills;
    conn.onNotification((method, params) => {
      if (method === 'state') {
        this.state = params as GameState;
        for (const fn of this.stateListeners) fn(this.state);
      } else if (method === 'event') {
        const e = params as GameEvent;
        for (const fn of this.listeners.get(e.type) ?? []) fn(e);
        for (const fn of this.listeners.get('*') ?? []) fn(e);
      }
    });
  }

  // ---- Scripted Mode pacing ----------------------------------------------------------------
  private readyAt = 0;
  private acting = false;
  private warned = new Map<string, number>();

  /**
   * Scripted Mode is on for this save: actions are instant, then a cooldown. Turn it on with
   * `bunx melvor2 scripted on`, or `m.setScripted({ on: true })`.
   */
  get scripted(): boolean {
    return this.state.scripted?.on ?? false;
  }
  /** Scripted Mode speed (1 to 1000, default 10): cooldown = action time ÷ speed, at least 50 ms. */
  get speed(): number {
    return this.state.scripted?.speed ?? 10;
  }
  /** Milliseconds until the next action is allowed (0 = now). */
  get cooldown(): number {
    return Math.max(0, this.readyAt - performance.now());
  }
  /** True when an `act` call would go through right now. */
  get ready(): boolean {
    return !this.acting && this.cooldown === 0;
  }
  /** Resolves when `m.ready` is true. */
  async whenReady(): Promise<void> {
    while (!this.ready) await Bun.sleep(Math.max(this.cooldown, 10));
  }

  /** @internal */
  async _act(skill: string, recipe: string, opts: { count?: number; allowStop?: boolean }): Promise<ActionResult> {
    if (this.acting) throw new MelvorError('BUSY', 'another act() is still running');
    const wait = this.cooldown;
    if (wait > 0) throw new MelvorError('COOLDOWN', `ready in ${Math.ceil(wait)} ms`, { readyInMs: wait });
    this.acting = true;
    let result: ActionResult;
    try {
      result = await this.conn.call('skill.act', { skill, recipe, count: opts.count, allowStop: opts.allowStop });
    } catch (e) {
      const left = (e as MelvorError).data as { readyInMs?: number } | undefined;
      if (typeof left?.readyInMs === 'number') this.readyAt = performance.now() + left.readyInMs;
      throw e;
    } finally {
      this.acting = false;
    }
    this.readyAt = performance.now() + result.readyInMs;
    await Bun.sleep(result.readyInMs); // resolve when the next action is allowed
    return result;
  }

  /** @internal Run a call that changes the active action, waiting out the real-time switch limit (COOLDOWN). */
  async _switch<T>(call: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await call();
      } catch (e) {
        if (!(e instanceof MelvorError) || e.code !== 'COOLDOWN') throw e;
        await Bun.sleep((e.data as { readyInMs?: number } | undefined)?.readyInMs ?? 250);
      }
    }
  }

  /** @internal */
  _seedCooldown(readyInMs: number) {
    this.readyAt = performance.now() + readyInMs;
  }

  /** @internal Warn about a failed call nobody awaited (once per kind of error every 10 s). */
  _unhandled(e: unknown) {
    const err = e as MelvorError;
    const key = err.code === 'COOLDOWN' || err.code === 'BUSY' ? 'not-ready' : `${err.code}:${err.message}`;
    const now = performance.now();
    if (now - (this.warned.get(key) ?? -Infinity) < 10_000) return;
    this.warned.set(key, now);
    if (key === 'not-ready')
      console.warn(
        '[melvor2] act() called while not ready: ignored (check m.ready). Further ones are ignored quietly.',
      );
    else console.warn(`[melvor2] ${err.code ?? 'error'}: ${err.message ?? err}`);
  }

  /** How many of an item are in the bank. */
  count(item: string): number {
    return this.state.bank?.[item] ?? 0;
  }
  /** Gold pieces in the bank. */
  get gp(): number {
    return this.state.currencies?.['MelvorBase:GoldPieces'] ?? 0;
  }

  /** Stop whatever the character is doing, and cancel a running multi-action `act`. */
  stop() {
    return this.conn.call('action.stop');
  }

  /**
   * Fighting. Combat runs in real time in both modes for now (turn-based Scripted combat is on the
   * roadmap). Pick a valid area and enemy pair with `AreaEnemies`.
   */
  readonly combat = (() => {
    const m = this;
    return {
      /**
       * Fight an enemy in an area (CombatAreas / Enemies ids). Combat runs in real time until you stop it.
       * Like `start()`, it waits out the one-switch-per-second limit by itself. Throws BAD_REQUEST if the
       * enemy isn't in that area and LOCKED if the area isn't unlocked.
       */
      fight: (area: string, enemy: string) => m._switch(() => m.conn.call('combat.fight', { area, enemy })),
      /** Leave combat. */
      stop: () => m.conn.call('combat.stop'),
      /** Eat the selected food once. */
      eat: () => m.conn.call('combat.eat'),
      /** 'Idle', 'Spawning' or 'Fighting'. */
      get state(): string {
        return m.state.combat?.state ?? 'Idle';
      },
      /** Your hitpoints right now. */
      get hp(): number {
        return m.state.combat?.hp ?? 0;
      },
      /** Your maximum hitpoints. */
      get maxHp(): number {
        return m.state.combat?.maxHp ?? 0;
      },
    };
  })();

  /**
   * Turn Scripted Mode on/off for the loaded save, or change the speed (1 to 1000, shared by all
   * Scripted saves). Turning it on stops the current action. Same as `bunx melvor2 scripted on` and
   * `bunx melvor2 speed 50`.
   */
  async setScripted(opts: { on?: boolean; speed?: number }): Promise<ScriptedStatus> {
    const s = await this.conn.call('scripted.set', opts);
    this.state = { ...this.state, scripted: { on: s.on, speed: s.speed } };
    return s;
  }

  /** From the main menu, load a save (the most recent by default). Throws NOT_READY anywhere else. */
  loadSave(id?: string) {
    return this.conn.call('game.loadSave', id ? { id } : {});
  }

  /** Print in your terminal and in the game's log. */
  log(...parts: unknown[]) {
    const msg = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    console.log(msg);
    void this.conn.call('ui.log', { message: msg }).catch(() => {});
  }

  /** Listen for game events: 'levelUp', 'actionChanged', 'modeChanged', or '*' for all. Returns an unsubscribe function. */
  on<T extends GameEvent['type'] | '*'>(
    type: T,
    fn: (e: T extends '*' ? GameEvent : Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }

  /** Called with every new state. */
  onState(fn: (s: GameState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Resolves once `pred(state)` is true. With `timeoutMs`, rejects with an Error ('waitFor timed out') after that long. */
  waitFor(pred: (s: GameState) => boolean, timeoutMs = Infinity): Promise<GameState> {
    if (pred(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const timer = Number.isFinite(timeoutMs)
        ? setTimeout(() => (off(), reject(new Error('waitFor timed out'))), timeoutMs)
        : null;
      const off = this.onState((s) => {
        if (!pred(s)) return;
        off();
        if (timer) clearTimeout(timer);
        resolve(s);
      });
    });
  }

  /** True while an `on` or `onState` listener is registered: `run()` keeps an async script alive while it is. */
  get hasListeners(): boolean {
    return this.stateListeners.size > 0 || [...this.listeners.values()].some((s) => s.size > 0);
  }
}

/**
 * Connect to the game and run your script.
 *
 * - `async` main: the script ends when it resolves (unless you registered `on`/`onState` listeners).
 * - plain (sync) main, e.g. a setInterval loop: runs until Ctrl+C.
 *
 * The character keeps doing its last action after the script ends (it's an idle game).
 *
 * An error your script throws (or doesn't catch) stops it and is printed as `CODE: message`.
 * `opts.name` is how the game's log names the script (default: the file name).
 */
export async function run(
  main: (m: Melvor) => unknown | Promise<unknown>,
  opts: { name?: string } = {},
): Promise<void> {
  const name = opts.name ?? process.argv[1]?.split(/[\\/]/).pop() ?? 'script';
  let conn: Connection;
  try {
    conn = await Connection.open();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const m = new Melvor(conn);
  let ending = false;
  const end = () => {
    ending = true;
    conn.close();
  };
  conn.onClose((reason) => {
    if (ending) return;
    console.error(`[melvor2] ${reason}`);
    process.exit(1);
  });
  await conn.call('runtime.hello', { name });
  m.state = await conn.call('state.get');
  m._seedCooldown((await conn.call('scripted.status')).readyInMs);
  process.on('SIGINT', () => (end(), process.exit(0)));
  try {
    const result = main(m);
    if (result instanceof Promise) {
      await result;
      if (!m.hasListeners) end();
    }
  } catch (e) {
    const err = e as MelvorError;
    console.error(err.code ? `${err.code}: ${err.message}` : e);
    end();
    process.exitCode = 1;
  }
}
