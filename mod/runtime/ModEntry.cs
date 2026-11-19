using System.Reflection;
using System.Text.Json.Nodes;
using Godot;

namespace MelvorScript.Runtime;

/// <summary>Started once per game launch by MelvorScript.Bootstrap.</summary>
public static class ModEntry
{
    public const int ProtocolVersion = 1;
    public static readonly string Version =
        typeof(ModEntry).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

    private static WsServer? _server;
    private static JsonObject? _lastState;
    private static string _lastStateText = "";
    private static long _nextPushAt;
    private static long _lastSwitchAt;

    /// <summary>
    /// Minimum time between calls that change what the character is doing. In real-time play a
    /// switch faster than this is pointless, and each one also updates the game's online
    /// "N players training this action" counter, which other players see.
    /// </summary>
    private const int SwitchCooldownMs = 1000;
    private const int PushIntervalMs = 250;

    private static Action? _requestReload;
    private static int _generation;

    /// <param name="requestReload">Bootstrap callback: stop this runtime and load the dll on disk again.</param>
    /// <param name="generation">1 for the first load after the game starts, +1 per hot reload.</param>
    public static void Start(string dir, Action requestReload, int generation)
    {
        _requestReload = requestReload;
        _generation = generation;
        Log.Init(dir, append: generation > 1);
        Log.Info($"melvor-script runtime {Version} #{generation} (protocol {ProtocolVersion}) starting; game {GameVersion()}", toGame: true);
        MainThread.Install();
        MainThread.OnFrame(PushState);
        var config = Config.LoadOrCreate();
        _server = new WsServer(config, Dispatch);
        try { _server.Start(); }
        catch (Exception e) { Log.Error($"could not listen on port {config.Port} (is another copy running?)", e); }
    }

    /// <summary>Called by the bootstrap before it unloads this copy (hot reload).</summary>
    public static void Stop()
    {
        Log.Info($"runtime #{_generation} stopping");
        _server?.Stop();
        _server = null;
        MainThread.Uninstall();
    }

    private static string GameVersion() => ProjectSettings.GetSetting("application/config/version").AsString();

    private static string Str(JsonNode? p, string name, bool required = true)
    {
        var v = p?[name];
        if (v is JsonValue jv && jv.TryGetValue(out string? s) && !string.IsNullOrEmpty(s)) return s;
        if (required) throw new RpcException("BAD_REQUEST", $"missing string parameter '{name}'");
        return null!;
    }

    /// <summary>Runs on a network thread; game work hops to the main thread.</summary>
    private static Task<JsonNode?> Dispatch(Client client, string method, JsonNode? p)
    {
        switch (method)
        {
            case "runtime.hello":
                client.Name = Str(p, "name", required: false) ?? client.Name;
                Log.Info($"client #{client.Id} is '{client.Name}'");
                return Main(() => Info());
            case "runtime.info": return Main(() => Info());
            case "runtime.reload":
                // Answer first, then swap: the reply must leave before this server shuts down.
                _ = Task.Delay(150).ContinueWith(_ => MainThread.Post(() => _requestReload?.Invoke()));
                return Task.FromResult<JsonNode?>(new JsonObject { ["reloading"] = true, ["generation"] = _generation });
            case "state.get": return Main(() => GameApi.Snapshot());
            case "game.saves": return Main(() => GameApi.Saves());
            case "game.loadSave": return Main(() => GameApi.LoadSave(Str(p, "id", required: false)));
            case "skill.recipes": return Main(() => GameApi.Recipes(Str(p, "skill")));
            case "skill.start":
                return Switch(() => GameApi.Start(Str(p, "skill"), Str(p, "recipe")));
            case "action.stop": return Main(() => GameApi.StopAll());
            case "combat.fight": return Switch(() => GameApi.Fight(Str(p, "area"), Str(p, "enemy")));
            case "combat.stop": return Main(() => GameApi.StopFight());
            case "combat.eat": return Main(() => GameApi.Eat());
            case "ui.log":
                Log.Info($"[{client.Name}] {Str(p, "message")}", toGame: true);
                return Task.FromResult<JsonNode?>(null);
            default:
                throw new RpcException("UNKNOWN_METHOD", $"unknown method '{method}' (the mod is older than your client?)");
        }
    }

    private static async Task<JsonNode?> Main(Func<JsonNode?> work) => await MainThread.Run(work).ConfigureAwait(false);

    /// <summary>A call that may change the active action: paced by <see cref="SwitchCooldownMs"/>.</summary>
    private static Task<JsonNode?> Switch(Func<JsonObject> work) => Main(() =>
    {
        long now = System.Environment.TickCount64;
        long wait = _lastSwitchAt + SwitchCooldownMs - now;
        if (wait > 0) throw new RpcException("COOLDOWN", $"wait {wait} ms before switching actions again", new JsonObject { ["readyInMs"] = wait });
        var result = work();
        if (result["already"] is null) _lastSwitchAt = now;
        return result;
    });

    private static JsonObject Info() => new()
    {
        ["runtimeVersion"] = Version,
        ["generation"] = _generation,
        ["protocol"] = ProtocolVersion,
        ["gameVersion"] = GameVersion(),
        ["mode"] = GameApi.Mode,
        ["dotnet"] = System.Environment.Version.ToString(),
    };

    /// <summary>Every 250 ms: push the state if it changed, plus events derived from the change.</summary>
    private static void PushState()
    {
        if (_server is null || _server.Clients.Count == 0) { _lastState = null; return; }
        long now = System.Environment.TickCount64;
        if (now < _nextPushAt) return;
        _nextPushAt = now + PushIntervalMs;

        JsonObject state;
        try { state = GameApi.Snapshot(); }
        catch (Exception e) { Log.Error("snapshot failed", e); return; }
        string text = state.ToJsonString();
        if (text == _lastStateText) return;

        if (_lastState != null) EmitEvents(_lastState, state);
        _lastState = state;
        _lastStateText = text;
        _server.Broadcast("state", state);
    }

    private static void EmitEvents(JsonObject before, JsonObject after)
    {
        if (before["skills"] is JsonObject b && after["skills"] is JsonObject a)
            foreach (var (id, node) in a)
            {
                int level = node?["level"]?.GetValue<int>() ?? 0;
                int old = b[id]?["level"]?.GetValue<int>() ?? level;
                if (level > old)
                    _server!.Broadcast("event", new JsonObject { ["type"] = "levelUp", ["skill"] = id, ["level"] = level, ["from"] = old });
            }
        string Key(JsonNode? n) => n is JsonArray arr ? string.Join(",", arr.Select(x => $"{x?["skill"]}/{x?["recipe"]}")) : "";
        if (Key(before["active"]) != Key(after["active"]))
            _server!.Broadcast("event", new JsonObject { ["type"] = "actionChanged", ["active"] = after["active"]?.DeepClone() });
        if (before["mode"]?.ToString() != after["mode"]?.ToString() || before["saveLoaded"]?.ToString() != after["saveLoaded"]?.ToString())
            _server!.Broadcast("event", new JsonObject { ["type"] = "modeChanged", ["mode"] = after["mode"]?.DeepClone(), ["saveLoaded"] = after["saveLoaded"]?.DeepClone() });
    }
}
