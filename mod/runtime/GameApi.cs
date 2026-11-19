using System.Collections;
using System.Reflection;
using System.Text.Json.Nodes;
using GamesByMalcs.Melvor2;
using GamesByMalcs.Melvor2.Components.CombatAreas;
using GamesByMalcs.Melvor2.Components.CurrencyWallets;
using GamesByMalcs.Melvor2.Components.Experience;
using GamesByMalcs.Melvor2.Data;
using GamesByMalcs.Melvor2.Data.Currencies;
using GamesByMalcs.Melvor2.Data.Items;
using GamesByMalcs.Melvor2.Entities;
using GamesByMalcs.Melvor2.Entities.Combat;
using GamesByMalcs.Melvor2.Saves;
using Godot;

namespace MelvorScript.Runtime;

/// <summary>
/// The game, as seen from the mod. Every member must be called on the main thread.
/// Notes on the game's internals (file:line refs into the decompiled source) are in RESEARCH.md.
/// </summary>
internal static class GameApi
{
    // ---- finding things --------------------------------------------------------------------

    public static Main? FindMain()
    {
        var tree = (SceneTree)Engine.GetMainLoop();
        if (tree.CurrentScene is Main m) return m;
        foreach (var child in tree.Root.GetChildren())
            if (child is Main main) return main;
        return null;
    }

    public static string Mode => FindMain()?.State?.Mode.ToString() ?? "None";

    /// <summary>The running game, or null on the menus / while loading.</summary>
    public static Game? FindGame() => (FindMain()?.State as IGameState)?.Game;

    /// <summary>The game, ready to be driven, or an RPC error explaining why not.</summary>
    public static Game RequireGame()
    {
        var game = FindGame() ?? throw new RpcException("NOT_READY", $"no save loaded (the game is on: {Mode})");
        if (!game.IsSaveLoaded) throw new RpcException("NOT_READY", "the save is still loading");
        if (((SceneTree)Engine.GetMainLoop()).Paused || game.Flags.IsOffline)
            throw new RpcException("NOT_READY", "the game is running offline progress");
        return game;
    }

    public static GameEntity Entity(Game game, string id)
    {
        if (!id.Contains(':')) id = "MelvorBase:" + id;
        return game.Entities.TryGetObjectById(id, out var e) ? e : throw new RpcException("NOT_FOUND", $"no entity '{id}'");
    }

    public static T Data<T>(Game game, string id) where T : INamespacedObject
    {
        if (!id.Contains(':')) id = "MelvorBase:" + id;
        return game.Data.TryGetObject<T>(id, out var obj) ? obj : throw new RpcException("NOT_FOUND", $"no {typeof(T).Name} '{id}'");
    }

    /// <summary>The player-facing name of a recipe/item/area (INamedObject.DisplayName), or its id.</summary>
    public static string? NameOf(object? o)
    {
        if (o is not INamedObject named) return (o as INamespacedObject)?.Id;
        var dn = named.DisplayName;
        return Prop(dn, "Text") as string ?? Prop(dn, "Singular") as string ?? dn?.ToString();
    }

    private static object? Prop(object? target, string name) =>
        target?.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(target);

    private static object? Call(object target, string name, params object?[] args)
    {
        var m = target.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .FirstOrDefault(x => x.Name == name && x.GetParameters().Length == args.Length)
            ?? throw new RpcException("UNSUPPORTED", $"{target.GetType().Name} has no {name}()");
        return m.Invoke(target, args);
    }

    // ---- state snapshot ----------------------------------------------------------------------

    public static JsonObject Snapshot()
    {
        var game = FindGame();
        var state = new JsonObject
        {
            ["mode"] = Mode,
            ["saveLoaded"] = game?.IsSaveLoaded ?? false,
            ["offline"] = game?.Flags.IsOffline ?? false,
        };
        if (game is null || !game.IsSaveLoaded) return state;
        state["scripted"] = new JsonObject { ["on"] = Scripted.IsOn(game), ["speed"] = Scripted.Speed };

        var skills = new JsonObject();
        foreach (var e in game.LeveledEntities)
        {
            ExperienceComponent xp = e.Experience;
            skills[e.Id] = new JsonObject
            {
                ["name"] = e.DisplayName.ToString(),
                ["level"] = xp.Level,
                ["xp"] = Math.Round(xp.Xp, 2),
                ["xpToNext"] = Math.Round(xp.XpToNextLevel, 2),
            };
        }
        state["skills"] = skills;

        var bankEntity = Entity(game, "MelvorBase:Bank");
        var inventory = Prop(bankEntity, "Inventory") as GamesByMalcs.Melvor2.Components.Inventories.IInventory;
        var bank = new JsonObject();
        if (inventory != null)
        {
            foreach (var stack in inventory.Stacks)
            {
                if (stack.IsPlaceholder || stack.Quantity <= 0) continue;
                string id = stack.Item.Id;
                bank[id] = (bank[id]?.GetValue<int>() ?? 0) + stack.Quantity;
            }
            state["bankSlots"] = new JsonObject { ["used"] = inventory.StackCount, ["max"] = inventory.MaxStacks };
        }
        state["bank"] = bank;

        var wallet = Prop(bankEntity, "Wallet") as ICurrencyWallet;
        var currencies = new JsonObject();
        if (wallet != null)
            foreach (var c in game.Data.GetDataRegistryOutput<Currency>().GetAllObjects())
                currencies[c.Id] = wallet.GetQuantity(c);
        state["currencies"] = currencies;

        var active = new JsonArray();
        foreach (var action in game.ActionManager.ActiveActions)
        {
            var timer = action.ActionTimer;
            active.Add(new JsonObject
            {
                ["skill"] = action.Entity.Id,
                ["recipe"] = action.CurrentDescription?.Id,
                ["recipeName"] = NameOf(action.CurrentDescription),
            });
        }
        state["active"] = active;

        if (game.Entities.TryGetObjectById("MelvorBase:Combat", out var ce) && ce is CombatEntity combat)
        {
            var hp = combat.Player.Health;
            state["combat"] = new JsonObject
            {
                ["state"] = combat.Action.State.ToString(),
                ["hp"] = hp.Current,
                ["maxHp"] = hp.Max,
                ["area"] = combat.Areas.CurrentArea?.Area?.Id,
            };
        }
        return state;
    }

    // ---- skills ------------------------------------------------------------------------------

    /// <summary>
    /// How each skill's action component picks a target. Gathering skills keep a dictionary of
    /// recipe -> active wrapper and a Select method that toggles; crafting skills share
    /// CraftingActionComponent (ActiveRecipes + SelectRecipe + StartCreating).
    /// </summary>
    internal sealed record Adapter(string Dict, string Select, string Current, bool Crafting);

    private static readonly Dictionary<string, Adapter> Gathering = new()
    {
        ["MelvorBase:Woodcutting"] = new("Trees", "SelectTree", "CuttingTree", false),
        ["MelvorBase:Mining"] = new("Rocks", "SelectRock", "CurrentRock", false),
        ["MelvorBase:Fishing"] = new("Recipes", "SelectRecipe", "CurrentRecipe", false),
    };

    private static readonly Adapter CraftingAdapter = new("ActiveRecipes", "SelectRecipe", "CreatingRecipe", true);

    internal static (object action, Adapter adapter) ActionOf(GameEntity entity)
    {
        var action = Prop(entity, "Action") ?? throw new RpcException("UNSUPPORTED", $"{entity.Id} has no action");
        if (Gathering.TryGetValue(entity.Id, out var a)) return (action, a);
        for (var t = action.GetType(); t != null; t = t.BaseType)
            if (t.IsGenericType && t.GetGenericTypeDefinition().Name.StartsWith("CraftingActionComponent"))
                return (action, CraftingAdapter);
        throw new RpcException("UNSUPPORTED", $"{entity.Id} isn't supported yet");
    }

    private static IEnumerable<(INamespacedObject recipe, object active)> Entries(object action, Adapter adapter)
    {
        if (Prop(action, adapter.Dict) is not IDictionary dict) yield break;
        foreach (DictionaryEntry kv in dict)
            if (kv.Key is INamespacedObject recipe && kv.Value != null) yield return (recipe, kv.Value);
    }

    private static object? RecipeOf(object? active) => active == null ? null : Prop(active, "Recipe");

    private static bool RequirementsMet(object recipe) =>
        Prop(recipe, "Requirements") is not GamesByMalcs.Melvor2.Conditions.ConditionGroup g || g.AreMet;

    public static JsonArray Recipes(string skill)
    {
        var game = RequireGame();
        var (action, adapter) = ActionOf(Entity(game, skill));
        var list = new JsonArray();
        foreach (var (recipe, _) in Entries(action, adapter))
            list.Add(new JsonObject
            {
                ["id"] = recipe.Id,
                ["name"] = NameOf(recipe),
                ["unlocked"] = RequirementsMet(recipe),
            });
        return list;
    }

    /// <summary>Starts (or switches to) a recipe in real time. Idempotent: starting the current one is a no-op.</summary>
    public static JsonObject Start(string skill, string recipeId)
    {
        var game = RequireGame();
        if (Scripted.IsOn(game))
            throw new RpcException("UNSUPPORTED", "this save is in Scripted Mode, where nothing repeats on its own: use act() (skill.act) instead");
        var entity = Entity(game, skill);
        var (action, adapter) = ActionOf(entity);
        bool started = EnsureStarted(entity, action, adapter, recipeId);
        if (started) Log.Info($"started {entity.Id} -> {recipeId}");
        return started ? new JsonObject { ["started"] = true } : new JsonObject { ["started"] = false, ["already"] = true };
    }

    /// <summary>
    /// Makes <paramref name="recipeId"/> the running recipe of this skill, checking requirements and
    /// materials first (the game itself only checks those in the UI). Never toggles it off.
    /// Returns false if it was already running.
    /// </summary>
    internal static bool EnsureStarted(GameEntity entity, object action, Adapter adapter, string recipeId)
    {
        if (!recipeId.Contains(':')) recipeId = "MelvorBase:" + recipeId;
        var (recipe, active) = Entries(action, adapter).FirstOrDefault(e => e.recipe.Id == recipeId);
        if (active is null) throw new RpcException("NOT_FOUND", $"{entity.Id} has no recipe '{recipeId}'");

        var started = (bool)(Prop(action, "IsStarted") ?? false);
        if (started && ReferenceEquals(Prop(action, adapter.Current), active)) return false;
        if (!RequirementsMet(recipe))
            throw new RpcException("LOCKED", $"{NameOf(recipe)} is locked (requirements not met)");

        if (adapter.Crafting)
        {
            if (Call(action, "CanCreateRecipe", active) is false)
                throw new RpcException("MISSING_ITEMS", $"not enough materials (or bank space) for {NameOf(recipe)}");
            Call(action, adapter.Select, active);
            Call(action, "StartCreating");
        }
        else
        {
            Call(action, adapter.Select, active);
        }

        bool ok = (bool)(Prop(action, "IsStarted") ?? false) && ReferenceEquals(Prop(action, adapter.Current), active);
        if (!ok) throw new RpcException("FAILED", $"the game didn't start {NameOf(recipe)}");
        return true;
    }

    internal static GamesByMalcs.Melvor2.Components.Inventories.IInventory? BankInventory(Game game) =>
        Prop(Entity(game, "MelvorBase:Bank"), "Inventory") as GamesByMalcs.Melvor2.Components.Inventories.IInventory;

    public static JsonObject StopAll()
    {
        var game = RequireGame();
        bool hadJob = Scripted.Cancel("stopped by a script");
        bool had = game.ActionManager.HasActiveAction;
        game.ActionManager.TryStopActive();
        return new JsonObject { ["stopped"] = had || hadJob, ["active"] = game.ActionManager.HasActiveAction };
    }

    // ---- combat ------------------------------------------------------------------------------

    private static CombatEntity Combat(Game game) =>
        Entity(game, "MelvorBase:Combat") as CombatEntity ?? throw new RpcException("UNSUPPORTED", "no combat entity");

    public static JsonObject Fight(string areaId, string enemyId)
    {
        var game = RequireGame();
        var combat = Combat(game);
        var area = Data<CombatArea>(game, areaId);
        var enemy = Data<Enemy>(game, enemyId);
        if (!area.Enemies.Contains(enemy)) throw new RpcException("BAD_REQUEST", $"{enemy.Id} isn't in {area.Id}");
        if ((Prop(area, "UnlockRequirements") ?? Prop(area, "Requirements")) is GamesByMalcs.Melvor2.Conditions.ConditionGroup g && !g.AreMet)
            throw new RpcException("LOCKED", $"{area.Id} is locked");
        combat.Areas.SelectEnemy(area, enemy);
        return new JsonObject { ["state"] = combat.Action.State.ToString() };
    }

    public static JsonObject StopFight()
    {
        var combat = Combat(RequireGame());
        bool ok = combat.Action.TryStop();
        return new JsonObject { ["stopped"] = ok };
    }

    public static JsonObject Eat()
    {
        var combat = Combat(RequireGame());
        int before = (int)combat.Player.Health.Current;
        Call(combat.Food, "ManualEat");
        return new JsonObject { ["hp"] = combat.Player.Health.Current, ["healed"] = combat.Player.Health.Current - before };
    }

    // ---- menus -------------------------------------------------------------------------------

    public static JsonArray Saves()
    {
        var list = new JsonArray();
        foreach (var stored in SaveManager.StoredSaves.Values)
        {
            if (!stored.HasSave) continue;
            var (source, save) = stored.GetMostRecentSave();
            list.Add(new JsonObject
            {
                ["id"] = stored.Id.ToString(),
                ["name"] = save.Header.CharacterName,
                ["timestamp"] = save.Header.Timestamp.ToString("o"),
                ["totalLevel"] = save.Header.TotalLevel,
                ["source"] = source.GetType().Name,
            });
        }
        return list;
    }

    /// <summary>From the main menu, load a save (the most recent one by default), like clicking it.</summary>
    public static JsonObject LoadSave(string? id)
    {
        var main = FindMain() ?? throw new RpcException("NOT_READY", "the game hasn't finished starting");
        if (main.State?.Mode != ApplicationMode.MainMenu)
            throw new RpcException("NOT_READY", $"saves can only be loaded from the main menu (now: {Mode})");
        var candidates = SaveManager.StoredSaves.Values.Where(s => s.HasSave).Select(s => (s.Id, best: s.GetMostRecentSave())).ToList();
        if (candidates.Count == 0) throw new RpcException("NOT_FOUND", "there are no saves");
        var pick = id is null
            ? candidates.OrderByDescending(c => c.best.Save.Header.Timestamp).First()
            : candidates.FirstOrDefault(c => c.Id.ToString() == id);
        if (pick.best.Save is null) throw new RpcException("NOT_FOUND", $"no save '{id}'");

        SaveManager.SetActiveSaveId(pick.Id, pick.best.Source);
        // IApplicationState doesn't expose the view; the concrete state (MainMenuState) does.
        var view = Prop(main.State, "View") as ApplicationView ?? throw new RpcException("NOT_READY", "the main menu has no view yet");
        typeof(ApplicationView).GetMethod("OnModeChangeRequested", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(view, [new ApplicationModeEventArgs(ApplicationMode.Game)]);
        Log.Info($"loading save {pick.Id} ({pick.best.Save.Header.CharacterName})", toGame: true);
        return new JsonObject { ["loading"] = pick.Id.ToString(), ["name"] = pick.best.Save.Header.CharacterName };
    }
}
