// melvor-script native bridge: a GDExtension whose only job is to load our C# code into the
// .NET runtime that Melvor Idle 2 (Godot .NET) is already running.
//
// Chain: override.cfg autoload -> loader.gd -> GDExtensionManager.load_extension(this) ->
//        hostfxr (already in the process) -> MelvorScript.Bootstrap.dll -> MelvorScript.Runtime.dll
//
// Everything is logged to bridge.log next to this DLL. It never registers Godot classes.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>

// ---- GDExtension (subset of gdextension_interface.h) ------------------------------------
typedef enum {
  GDEXTENSION_INITIALIZATION_CORE,
  GDEXTENSION_INITIALIZATION_SERVERS,
  GDEXTENSION_INITIALIZATION_SCENE,
  GDEXTENSION_INITIALIZATION_EDITOR,
  GDEXTENSION_MAX_INITIALIZATION_LEVEL,
} GDExtensionInitializationLevel;

typedef struct {
  GDExtensionInitializationLevel minimum_initialization_level;
  void *userdata;
  void (*initialize)(void *userdata, GDExtensionInitializationLevel p_level);
  void (*deinitialize)(void *userdata, GDExtensionInitializationLevel p_level);
} GDExtensionInitialization;

typedef void *GDExtensionInterfaceGetProcAddress;
typedef void *GDExtensionClassLibraryPtr;

// ---- hostfxr (subset of hostfxr.h / coreclr_delegates.h) ---------------------------------
typedef void *hostfxr_handle;
typedef int32_t(__cdecl *hostfxr_initialize_for_runtime_config_fn)(const wchar_t *runtime_config_path,
                                                                    const void *parameters,
                                                                    hostfxr_handle *host_context_handle);
typedef int32_t(__cdecl *hostfxr_get_runtime_delegate_fn)(const hostfxr_handle host_context_handle, int32_t type,
                                                           void **delegate);
typedef int32_t(__cdecl *hostfxr_close_fn)(const hostfxr_handle host_context_handle);

enum { hdt_load_assembly_and_get_function_pointer = 5 };

typedef int(__stdcall *load_assembly_and_get_function_pointer_fn)(const wchar_t *assembly_path,
                                                                   const wchar_t *type_name,
                                                                   const wchar_t *method_name,
                                                                   const wchar_t *delegate_type_name,
                                                                   void *reserved, void **delegate);
#define UNMANAGEDCALLERSONLY_METHOD ((const wchar_t *)-1)

// [UnmanagedCallersOnly] static int Init(IntPtr dirUtf16, int length)
typedef int(__stdcall *bootstrap_init_fn)(const wchar_t *dir, int32_t length);

// ---------------------------------------------------------------------------------------------
static wchar_t g_dir[MAX_PATH];
static FILE *g_log;
static int g_started;

static void log_line(const char *fmt, ...) {
  if (!g_log) return;
  SYSTEMTIME t;
  GetLocalTime(&t);
  fprintf(g_log, "[%02d:%02d:%02d.%03d] ", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
  va_list ap;
  va_start(ap, fmt);
  vfprintf(g_log, fmt, ap);
  va_end(ap);
  fputc('\n', g_log);
  fflush(g_log);
}

static void find_own_dir(void) {
  HMODULE self = NULL;
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     (LPCWSTR)&find_own_dir, &self);
  GetModuleFileNameW(self, g_dir, MAX_PATH);
  wchar_t *slash = wcsrchr(g_dir, L'\\');
  if (slash) *slash = 0;
}

static void path_in_dir(wchar_t *out, const wchar_t *file) { _snwprintf(out, MAX_PATH, L"%ls\\%ls", g_dir, file); }

static load_assembly_and_get_function_pointer_fn get_loader(HMODULE hostfxr) {
  hostfxr_initialize_for_runtime_config_fn init_cfg =
      (hostfxr_initialize_for_runtime_config_fn)GetProcAddress(hostfxr, "hostfxr_initialize_for_runtime_config");
  hostfxr_get_runtime_delegate_fn get_delegate =
      (hostfxr_get_runtime_delegate_fn)GetProcAddress(hostfxr, "hostfxr_get_runtime_delegate");
  hostfxr_close_fn close_fn = (hostfxr_close_fn)GetProcAddress(hostfxr, "hostfxr_close");
  if (!init_cfg || !get_delegate) {
    log_line("hostfxr exports missing (init=%p get_delegate=%p)", (void *)init_cfg, (void *)get_delegate);
    return NULL;
  }

  void *fn = NULL;

  // A: a secondary context from our runtimeconfig.json (the documented way to load a component
  //    into a process whose runtime is already running). 1/2 = "already initialized", both fine.
  wchar_t cfg[MAX_PATH];
  path_in_dir(cfg, L"MelvorScript.Bootstrap.runtimeconfig.json");
  hostfxr_handle h = NULL;
  int32_t rc = init_cfg(cfg, NULL, &h);
  log_line("A: hostfxr_initialize_for_runtime_config -> 0x%08x", (unsigned)rc);
  if (rc >= 0 && h) {
    rc = get_delegate(h, hdt_load_assembly_and_get_function_pointer, &fn);
    log_line("A: get_runtime_delegate -> 0x%08x (%p)", (unsigned)rc, fn);
    if (close_fn) close_fn(h);
    if (rc >= 0 && fn) return (load_assembly_and_get_function_pointer_fn)fn;
  }

  // B: the active (primary) context Godot created. Passing NULL asks hostfxr for it.
  rc = get_delegate(NULL, hdt_load_assembly_and_get_function_pointer, &fn);
  log_line("B: get_runtime_delegate(active) -> 0x%08x (%p)", (unsigned)rc, fn);
  if (rc >= 0 && fn) return (load_assembly_and_get_function_pointer_fn)fn;
  return NULL;
}

static void start_dotnet(void) {
  if (g_started) return;
  g_started = 1;

  HMODULE hostfxr = GetModuleHandleW(L"hostfxr.dll");
  log_line("hostfxr module: %p", (void *)hostfxr);
  if (!hostfxr) return;

  load_assembly_and_get_function_pointer_fn load = get_loader(hostfxr);
  if (!load) {
    log_line("no way to load assemblies; giving up");
    return;
  }

  wchar_t asm_path[MAX_PATH];
  path_in_dir(asm_path, L"MelvorScript.Bootstrap.dll");
  bootstrap_init_fn init = NULL;
  int rc = load(asm_path, L"MelvorScript.Bootstrap.Entry, MelvorScript.Bootstrap", L"Init", UNMANAGEDCALLERSONLY_METHOD,
                NULL, (void **)&init);
  log_line("load_assembly_and_get_function_pointer -> 0x%08x (%p)", (unsigned)rc, (void *)init);
  if (rc < 0 || !init) return;

  rc = init(g_dir, (int32_t)wcslen(g_dir));
  log_line("bootstrap Init -> %d", rc);
}

static void on_initialize(void *userdata, GDExtensionInitializationLevel level) {
  (void)userdata;
  log_line("initialize level %d", (int)level);
  if (level == GDEXTENSION_INITIALIZATION_SCENE) start_dotnet();
}

static void on_deinitialize(void *userdata, GDExtensionInitializationLevel level) {
  (void)userdata;
  (void)level;
}

__declspec(dllexport) uint8_t melvor_script_bridge_init(GDExtensionInterfaceGetProcAddress get_proc_address,
                                                        GDExtensionClassLibraryPtr library,
                                                        GDExtensionInitialization *r_initialization) {
  (void)get_proc_address;
  (void)library;
  find_own_dir();
  wchar_t log_path[MAX_PATH];
  path_in_dir(log_path, L"bridge.log");
  g_log = _wfopen(log_path, L"w");
  log_line("melvor-script bridge loaded from %ls", g_dir);

  r_initialization->minimum_initialization_level = GDEXTENSION_INITIALIZATION_SCENE;
  r_initialization->userdata = NULL;
  r_initialization->initialize = on_initialize;
  r_initialization->deinitialize = on_deinitialize;
  return 1;
}
