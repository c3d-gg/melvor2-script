using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace MelvorScript.Runtime;

/// <summary>runtime.log in the mod folder, plus the game log for the important lines.</summary>
internal static class Log
{
    private static readonly object Gate = new();
    private static string? _path;

    public static void Init(string dir, bool append)
    {
        _path = System.IO.Path.Combine(dir, "runtime.log");
        if (!append) File.WriteAllText(_path, "");
    }

    public static void Info(string msg, bool toGame = false)
    {
        lock (Gate)
        {
            if (_path != null) File.AppendAllText(_path, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{System.Environment.NewLine}");
        }
        if (toGame) MainThread.Post(() => GD.Print("[melvor-script] " + msg));
    }

    public static void Error(string msg, Exception? e = null) => Info($"ERROR {msg}{(e != null ? ": " + e : "")}", toGame: true);
}

/// <summary>~/.melvor2-scripting/config.json: shared with the TypeScript client (port + token).</summary>
internal sealed class Config
{
    public const int DefaultPort = 7338;
    public int Port { get; private set; } = DefaultPort;
    public string Token { get; private set; } = "";
    public static string FilePath =>
        System.Environment.GetEnvironmentVariable("MELVOR2_SCRIPT_CONFIG")
        ?? System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile), ".melvor2-scripting", "config.json");

    public static Config LoadOrCreate()
    {
        var cfg = new Config();
        JsonObject obj = new();
        try
        {
            if (File.Exists(FilePath)) obj = JsonNode.Parse(File.ReadAllText(FilePath)) as JsonObject ?? new JsonObject();
        }
        catch (Exception e)
        {
            Log.Error($"bad config file {FilePath}, keeping it and using defaults", e);
            cfg.Token = NewToken();
            return cfg;
        }
        if (obj["port"] is JsonValue p && p.TryGetValue(out int port)) cfg.Port = port;
        if (obj["token"] is JsonValue t && t.TryGetValue(out string? token) && !string.IsNullOrEmpty(token)) cfg.Token = token;
        if (string.IsNullOrEmpty(cfg.Token))
        {
            cfg.Token = NewToken();
            obj["port"] = cfg.Port;
            obj["token"] = cfg.Token;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, obj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            Log.Info($"wrote a new token to {FilePath}");
        }
        return cfg;
    }

    private static string NewToken() =>
        Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
}

/// <summary>
/// Everything that touches the game runs here, on Godot's main thread, between frames
/// (SceneTree.process_frame). Network threads hand work over with <see cref="Run{T}"/>.
/// </summary>
internal static class MainThread
{
    private static readonly ConcurrentQueue<Action> Queue = new();
    private static readonly List<Action> FrameHandlers = new();
    private static int _mainThreadId;

    public static bool IsMain => System.Environment.CurrentManagedThreadId == _mainThreadId;

    public static void Install()
    {
        _mainThreadId = System.Environment.CurrentManagedThreadId;
        var tree = (SceneTree)Engine.GetMainLoop();
        tree.ProcessFrame += Pump;
    }

    /// <summary>Unhook from Godot so this copy of the runtime can be unloaded (hot reload).</summary>
    public static void Uninstall()
    {
        var tree = (SceneTree)Engine.GetMainLoop();
        tree.ProcessFrame -= Pump;
        FrameHandlers.Clear();
        while (Queue.TryDequeue(out _)) { }
    }

    public static void OnFrame(Action handler) => FrameHandlers.Add(handler);

    public static void Post(Action work) => Queue.Enqueue(work);

    public static Task<T> Run<T>(Func<T> work)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Queue.Enqueue(() =>
        {
            try { tcs.SetResult(work()); }
            catch (Exception e) { tcs.SetException(e); }
        });
        return tcs.Task;
    }

    private static void Pump()
    {
        var budget = System.Diagnostics.Stopwatch.StartNew();
        while (budget.ElapsedMilliseconds < 8 && Queue.TryDequeue(out var work))
        {
            try { work(); }
            catch (Exception e) { Log.Error("main-thread work failed", e); }
        }
        foreach (var handler in FrameHandlers)
        {
            try { handler(); }
            catch (Exception e) { Log.Error("frame handler failed", e); }
        }
    }
}

/// <summary>An error the client sees as { code, message, data }.</summary>
internal sealed class RpcException(string code, string message, JsonNode? data = null) : Exception(message)
{
    public string Code { get; } = code;
    public JsonNode? Payload { get; } = data;
}
