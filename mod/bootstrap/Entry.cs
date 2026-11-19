using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;

namespace MelvorScript.Bootstrap;

/// <summary>
/// Loaded by the native bridge (hostfxr) into its own isolated load context. It must not reference
/// the game or Godot. It loads MelvorScript.Runtime.dll into a collectible load context that
/// borrows the game's assemblies, so the runtime sees the game's real types and can be unloaded
/// and reloaded while the game runs (`bun run dev`).
/// </summary>
public static class Entry
{
    private const string GameAssembly = "GamesByMalcs.Melvor2";
    private const string RuntimeFile = "MelvorScript.Runtime.dll";

    private static string _dir = "";
    private static AssemblyLoadContext? _game;
    private static RuntimeContext? _context;
    private static Action? _stop;
    private static int _generation;

    private static void Log(string msg)
    {
        try { File.AppendAllText(Path.Combine(_dir, "bootstrap.log"), $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}"); }
        catch { /* nowhere left to report */ }
    }

    /// <summary>Called by the native bridge on Godot's main thread, once per game launch.</summary>
    [UnmanagedCallersOnly]
    public static int Init(IntPtr dirUtf16, int length)
    {
        _dir = Marshal.PtrToStringUni(dirUtf16, length);
        try
        {
            File.WriteAllText(Path.Combine(_dir, "bootstrap.log"), "");
            Log($"bootstrap running on .NET {Environment.Version}, in context '{AssemblyLoadContext.GetLoadContext(typeof(Entry).Assembly)?.Name}'");
            Assembly? game = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == GameAssembly);
            if (game is null)
            {
                Log($"{GameAssembly} is not loaded; is this Melvor Idle 2?");
                return 2;
            }
            _game = AssemblyLoadContext.GetLoadContext(game) ?? AssemblyLoadContext.Default;
            Log($"game assembly {game.GetName().Version} lives in context '{_game.Name}'");
            StartRuntime();
            return 0;
        }
        catch (Exception e)
        {
            Log(e.ToString());
            return 1;
        }
    }

    private static void StartRuntime()
    {
        _generation++;
        _context = new RuntimeContext(_game!, _dir, _generation);
        // From bytes, so the installer can replace the file while the game runs.
        Assembly runtime = _context.LoadFromStream(new MemoryStream(File.ReadAllBytes(Path.Combine(_dir, RuntimeFile))));
        Type entry = runtime.GetType("MelvorScript.Runtime.ModEntry", throwOnError: true)!;
        _stop = entry.GetMethod("Stop", BindingFlags.Public | BindingFlags.Static)?.CreateDelegate<Action>();
        entry.GetMethod("Start", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, [_dir, (Action)Reload, _generation]);
        Log($"runtime #{_generation} started");
    }

    /// <summary>Called by the runtime (on the main thread) to swap itself for the dll on disk.</summary>
    private static void Reload()
    {
        Log($"reloading runtime #{_generation}");
        try { _stop?.Invoke(); }
        catch (Exception e) { Log("stop failed: " + e); }
        _stop = null;
        var old = _context;
        _context = null;
        old?.Unload();
        try { StartRuntime(); }
        catch (Exception e) { Log("reload failed: " + e); }
    }

    /// <summary>Game, Godot and framework assemblies come from the game's context (shared types); ours from the mod folder.</summary>
    private sealed class RuntimeContext(AssemblyLoadContext game, string dir, int generation)
        : AssemblyLoadContext($"melvor-script runtime #{generation}", isCollectible: true)
    {
        protected override Assembly? Load(AssemblyName name)
        {
            string local = Path.Combine(dir, name.Name + ".dll");
            if (File.Exists(local) && name.Name != "MelvorScript.Bootstrap") return LoadFromStream(new MemoryStream(File.ReadAllBytes(local)));
            try { return game.LoadFromAssemblyName(name); }
            catch (FileNotFoundException) { return null; }
        }
    }
}
