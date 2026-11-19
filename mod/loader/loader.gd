extends Node
# melvor-script loader. Godot starts this script at boot because override.cfg (next to
# Melvor2.exe) lists it as an autoload. It loads the native bridge, which loads the C# runtime.
# Status goes to the game log (logs/godot.log) and user://melvor-script/loader.log.

const DIR := "user://melvor-script/"
const LIB := "melvor_script_bridge.dll"


func _ready() -> void:
	var log := FileAccess.open(DIR + "loader.log", FileAccess.WRITE)
	var say := func(msg: String) -> void:
		print("[melvor-script] ", msg)
		if log:
			log.store_line("%s %s" % [Time.get_datetime_string_from_system(), msg])
			log.flush()

	say.call("loader running (Godot %s)" % Engine.get_version_info().string)
	var lib_path := ProjectSettings.globalize_path(DIR + LIB)
	if not FileAccess.file_exists(DIR + LIB):
		say.call("missing %s: run the installer again" % lib_path)
		return

	# The .gdextension file is written here with an absolute library path, so it doesn't matter
	# how Godot resolves relative paths in an exported game.
	var cfg := ConfigFile.new()
	cfg.set_value("configuration", "entry_symbol", "melvor_script_bridge_init")
	cfg.set_value("configuration", "compatibility_minimum", "4.1")
	cfg.set_value("configuration", "reloadable", false)
	cfg.set_value("libraries", "windows.x86_64", lib_path)
	var cfg_path := DIR + "bridge.gdextension"
	var err := cfg.save(cfg_path)
	if err != OK:
		say.call("could not write %s (error %d)" % [cfg_path, err])
		return

	var status := GDExtensionManager.load_extension(cfg_path)
	# LoadStatus: 0 OK, 1 FAILED, 2 ALREADY_LOADED, 3 NOT_LOADED, 4 NEEDS_RESTART
	say.call("bridge load_extension -> %d (details in bridge.log, bootstrap.log, runtime.log)" % status)
