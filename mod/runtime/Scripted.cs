using System.Reflection;
using System.Text.Json.Nodes;
using GamesByMalcs.Melvor2;
using GamesByMalcs.Melvor2.Components.Actions;
using GamesByMalcs.Melvor2.Components.Experience;
using GamesByMalcs.Melvor2.Core.TickTimer;
using GamesByMalcs.Melvor2.Entities;
using GamesByMalcs.Melvor2.Entities.Combat;
using GamesByMalcs.Melvor2.Saves;

namespace MelvorScript.Runtime;

/// <summary>
/// Scripted Mode, the Melvor 1 melvor-script rules, opted into per save:
/// every action happens at once (a click), then the next one waits that action's normal time ÷ speed.
/// Nothing idles: the action is stopped again straight after, so the game never repeats it on its own
/// and there's no offline progress for skills. The player's own clicks follow the same rule.
///
/// How an action is made instant: the action's TickTimer is set to fire on the next tick and ticked
/// once, so the game's own completion code runs (rewards, XP, mastery, events). Start, fire and stop
/// happen inside one frame, so the game's online presence never sees the action running.
/// </summary>
internal static class Scripted
{
    public const double MinCooldownMs = 50;
    private static readonly FieldInfo TicksLeft =
        typeof(TickTimer).GetField("_ticksLeft", BindingFlags.NonPublic | BindingFlags.Instance)
        ?? throw new MissingFieldException("TickTimer._ticksLeft (game update?)");
    private static readonly PropertyInfo? ActiveSaveIdProp =
        typeof(SaveManager).GetProperty("ActiveSaveId", BindingFlags.NonPublic | BindingFlags.Static);

    private static Config _config = null!;
    private static long _readyAt;
    private static Job? _job;
    private static ActionComponent? _heldClick;

    private static long Now => System.Environment.TickCount64;

    public static void Init(Config config) => _config = config;

    public static double Speed => _config.Speed;
    public static long ReadyInMs => Math.Max(0, _readyAt - Now);

    public static Guid ActiveSaveId() => ActiveSaveIdProp?.GetValue(null) is Guid g ? g : Guid.Empty;

    /// <summary>Is Scripted Mode on for the save that's loaded?</summary>
    public static bool IsOn(Game? game)
    {
        if (game is null || !game.IsSaveLoaded) return false;
        var id = ActiveSaveId();
        return id != Guid.Empty && _config.ScriptedSaves.Contains(id.ToString());
    }

    public static JsonObject Status()
    {
        var game = GameApi.FindGame();
        return new JsonObject
        {
            ["on"] = IsOn(game),
            ["speed"] = Speed,
            ["minCooldownMs"] = MinCooldownMs,
            ["readyInMs"] = ReadyInMs,
            ["busy"] = _job != null,
            ["save"] = game?.IsSaveLoaded == true ? ActiveSaveId().ToString() : null,
        };
    }

    public static JsonObject Set(bool? on, double? speed)
    {
        if (speed is double s)
        {
            if (!double.IsFinite(s) || s < 1 || s > 1000) throw new RpcException("BAD_REQUEST", "speed must be between 1 and 1000");
            _config.Speed = s;
        }
        if (on is bool enable)
        {
            var game = GameApi.RequireGame();
            string id = ActiveSaveId().ToString();
            if (enable)
            {
                _config.ScriptedSaves.Add(id);
                game.ActionManager.TryStopActive(); // from now on nothing runs on its own
            }
            else
            {
                _config.ScriptedSaves.Remove(id);
                Cancel("Scripted Mode turned off");
            }
            Log.Info($"Scripted Mode {(enable ? "on" : "off")} for save {id}", toGame: true);
        }
        _config.Save();
        return Status();
    }

    // ---- acting ------------------------------------------------------------------------------

    private sealed class Job
    {
        public required string Skill;
        public required string Recipe;
        public int Remaining;
        public bool AllowStop;
        public int Actions;
        public double Xp;
        public readonly Dictionary<string, int> Items = new();
        public readonly long StartedAt = Now;
        public readonly TaskCompletionSource<JsonNode?> Done = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public JsonObject Result(string? stopped = null)
        {
            var items = new JsonObject();
            foreach (var (id, n) in Items) if (n != 0) items[id] = n;
            var r = new JsonObject
            {
                ["completed"] = stopped is null,
                ["actions"] = Actions,
                ["xp"] = Math.Round(Xp, 2),
                ["items"] = items,
                ["durationMs"] = Now - StartedAt,
                ["readyInMs"] = ReadyInMs,
            };
            if (stopped != null) r["stopped"] = stopped;
            return r;
        }
    }

    /// <summary>
    /// skill.act: <paramref name="count"/> instant actions, spaced by the cooldown. The first one runs now.
    /// Resolves with what happened once they're done (or stopped early).
    /// </summary>
    public static Task<JsonNode?> BeginAct(string skill, string recipe, int count, bool allowStop)
    {
        var game = GameApi.RequireGame();
        if (!IsOn(game))
            throw new RpcException("UNSUPPORTED", "Scripted Mode is off for this save. Turn it on with: bun run melvor2 scripted on");
        if (count < 1) throw new RpcException("BAD_REQUEST", "count must be at least 1");
        if (_job != null) throw new RpcException("BUSY", $"still doing {_job.Remaining} more {_job.Recipe}");
        long wait = ReadyInMs;
        if (wait > 0) throw new RpcException("COOLDOWN", $"ready in {wait} ms", new JsonObject { ["readyInMs"] = wait });

        var job = new Job { Skill = skill, Recipe = recipe, Remaining = count, AllowStop = allowStop };
        // The first action runs right now, so errors (LOCKED, MISSING_ITEMS, ...) come back directly.
        ActOnce(game, job);
        if (job.Remaining == 0) return Task.FromResult<JsonNode?>(job.Result());
        _job = job;
        return job.Done.Task;
    }

    /// <summary>Every frame (main thread): keep a running job going, and turn player clicks into single actions.</summary>
    public static void OnFrame()
    {
        var game = GameApi.FindGame();
        if (!IsOn(game) || game!.Flags.IsOffline)
        {
            if (_job != null && game?.IsSaveLoaded != true) Cancel("the save was unloaded");
            _heldClick = null;
            return;
        }

        // A skill running on its own here was started by the player (our actions start and stop within one call).
        foreach (var action in game.ActionManager.ActiveActions.ToArray())
        {
            if (action is CombatActionComponent || !action.IsStarted) continue;
            if (_job != null) Cancel("you clicked another action");
            HandleClick(game, action);
        }

        if (_job != null && ReadyInMs == 0)
        {
            try { ActOnce(game, _job); }
            catch (RpcException e) { Finish(e.Message, e); }
            catch (Exception e) { Log.Error("scripted action failed", e); Finish(e.Message, null); }
            if (_job != null && _job.Remaining == 0) Finish(null, null);
        }
    }

    /// <summary>The player clicked an action: do it once (now, or when the cooldown ends), then stop it.</summary>
    private static void HandleClick(Game game, ActionComponent action)
    {
        var timer = action.ActionTimer;
        if (timer is null) return;
        if (ReadyInMs > 0)
        {
            if (timer.IsRunning) timer.Pause(); // hold the click until the cooldown is over
            _heldClick = action;
            return;
        }
        _heldClick = null;
        try
        {
            Fire(action, timer, out double interval);
            _readyAt = Now + (long)Math.Max(MinCooldownMs, interval / Speed);
        }
        finally
        {
            StopQuietly(action);
        }
    }

    /// <summary>One instant action for a job: make sure the right recipe is selected, fire once, stop.</summary>
    private static void ActOnce(Game game, Job job)
    {
        var entity = GameApi.Entity(game, job.Skill);
        var (actionObj, adapter) = GameApi.ActionOf(entity);
        var action = (ActionComponent)actionObj;
        GameApi.EnsureStarted(entity, actionObj, adapter, job.Recipe);
        var timer = action.ActionTimer ?? throw new RpcException("UNSUPPORTED", $"{entity.Id} has no action timer");

        var inventory = GameApi.BankInventory(game);
        var experience = (entity as ILeveledEntity<ExperienceComponent>)?.Experience;
        double xpBefore = experience?.Xp ?? 0;
        void OnItem(object? s, GamesByMalcs.Melvor2.Components.Inventories.ItemQuantityChangedEventArgs e) =>
            job.Items[e.Item.Id] = job.Items.GetValueOrDefault(e.Item.Id) + e.QuantityChange;
        if (inventory != null) inventory.ItemQuantityChanged += OnItem;
        try
        {
            Fire(action, timer, out double interval);
            _readyAt = Now + (long)Math.Max(MinCooldownMs, interval / Speed);
        }
        finally
        {
            if (inventory != null) inventory.ItemQuantityChanged -= OnItem;
            StopQuietly(action);
        }
        job.Actions++;
        job.Remaining--;
        job.Xp += (experience?.Xp ?? 0) - xpBefore;
    }

    /// <summary>Make the action's timer fire right now (the game's own completion code runs).</summary>
    private static void Fire(ActionComponent action, TickTimer timer, out double interval)
    {
        interval = timer.WaitTime;
        if (timer.IsPaused) timer.Resume();
        if (!timer.IsRunning) throw new RpcException("FAILED", "the action didn't start (its timer isn't running)");
        TicksLeft.SetValue(timer, 1);
        timer.Tick();
    }

    private static void StopQuietly(ActionComponent action)
    {
        if (action.IsStarted && !action.TryStop()) action.TryStop(force: true);
    }

    /// <summary>
    /// End the running job. Finished normally → result. Stopped early → the result with `stopped` when the
    /// script passed allowStop, otherwise an error carrying the partial result (like Melvor 1's ActionStoppedError).
    /// </summary>
    private static void Finish(string? stopped, RpcException? error)
    {
        var job = _job;
        _job = null;
        if (job is null) return;
        if (stopped is null || job.AllowStop)
        {
            job.Done.TrySetResult(job.Result(stopped));
            return;
        }
        job.Done.TrySetException(new RpcException(error?.Code ?? "FAILED",
            $"stopped after {job.Actions} of {job.Actions + job.Remaining}: {stopped}", job.Result(stopped)));
    }

    /// <summary>Stop a running job (action.stop, mode change, player click).</summary>
    public static bool Cancel(string why)
    {
        if (_job is null) return false;
        Finish(why, null);
        return true;
    }
}
