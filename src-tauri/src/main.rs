#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize, Deserialize)]
struct VaultSettings {
    base_path: String,
}

const LIVE_RUNTIME_DIR_NAME: &str = "_runtime";
const LIVE_DATABASE_FILE_NAME: &str = "atrium.db";
const LIVE_MEDIA_DIR_NAME: &str = "media";

fn default_vault_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;

    Ok(base_dir.join("Digital_Atrium_Vault"))
}

fn vault_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join("vault-settings.json"))
}

fn current_vault_base_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings_path = vault_settings_path(app)?;

    if settings_path.exists() {
        let contents = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let settings: VaultSettings = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
        Ok(PathBuf::from(settings.base_path))
    } else {
        default_vault_dir(app)
    }
}

fn live_runtime_dir(base_path: &std::path::Path) -> PathBuf {
    base_path.join(LIVE_RUNTIME_DIR_NAME)
}

fn live_database_path(base_path: &std::path::Path) -> PathBuf {
    live_runtime_dir(base_path).join(LIVE_DATABASE_FILE_NAME)
}

fn live_media_dir(base_path: &std::path::Path) -> PathBuf {
    live_runtime_dir(base_path).join(LIVE_MEDIA_DIR_NAME)
}

fn legacy_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(config_dir.join(LIVE_DATABASE_FILE_NAME))
}

fn ensure_parent_dir(path: &std::path::Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn seed_database_if_needed(source_path: &std::path::Path, target_path: &std::path::Path) -> Result<(), String> {
    if target_path.exists() || !source_path.exists() || source_path == target_path {
        return Ok(());
    }

    ensure_parent_dir(target_path)?;
    fs::copy(source_path, target_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn copy_dir_recursive_if_needed(source_path: &std::path::Path, target_path: &std::path::Path) -> Result<(), String> {
    if !source_path.exists() || source_path == target_path {
        return Ok(());
    }

    fs::create_dir_all(target_path).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(source_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_entry_path = entry.path();
        let target_entry_path = target_path.join(entry.file_name());

        if source_entry_path.is_dir() {
            copy_dir_recursive_if_needed(&source_entry_path, &target_entry_path)?;
        } else {
            ensure_parent_dir(&target_entry_path)?;
            fs::copy(&source_entry_path, &target_entry_path)
                .map(|_| ())
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn get_vault_base_path(app: tauri::AppHandle) -> Result<String, String> {
    let base_path = current_vault_base_path(&app)?;

    fs::create_dir_all(&base_path).map_err(|e| e.to_string())?;
    Ok(base_path.to_string_lossy().to_string())
}

#[tauri::command]
fn set_vault_base_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let previous_base_path = current_vault_base_path(&app)?;
    let previous_live_database = live_database_path(&previous_base_path);
    let legacy_database = legacy_database_path(&app)?;

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Vault folder path cannot be empty".into());
    }

    let base_path = PathBuf::from(trimmed);
    fs::create_dir_all(&base_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(live_runtime_dir(&base_path)).map_err(|e| e.to_string())?;

    let settings_path = vault_settings_path(&app)?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let settings = VaultSettings {
        base_path: base_path.to_string_lossy().to_string(),
    };

    let contents = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, contents).map_err(|e| e.to_string())?;

    copy_dir_recursive_if_needed(&live_runtime_dir(&previous_base_path), &live_runtime_dir(&base_path))?;

    let next_live_database = live_database_path(&base_path);
    if previous_live_database.exists() {
        seed_database_if_needed(&previous_live_database, &next_live_database)?;
    } else {
        seed_database_if_needed(&legacy_database, &next_live_database)?;
    }

    Ok(base_path.to_string_lossy().to_string())
}

#[tauri::command]
fn prepare_live_database(app: tauri::AppHandle) -> Result<String, String> {
    let base_path = current_vault_base_path(&app)?;
    fs::create_dir_all(&base_path).map_err(|e| e.to_string())?;

    let target_database = live_database_path(&base_path);
    fs::create_dir_all(live_runtime_dir(&base_path)).map_err(|e| e.to_string())?;
    fs::create_dir_all(live_media_dir(&base_path)).map_err(|e| e.to_string())?;

    let legacy_database = legacy_database_path(&app)?;
    seed_database_if_needed(&legacy_database, &target_database)?;

    Ok(target_database.to_string_lossy().to_string())
}

#[tauri::command]
fn vault_path_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

// Used to fold real local media file sizes into the atrium storage-usage
// figure (see get_lobby_size_bytes in localDb.ts) -- Postgres/web has actual
// Supabase Storage object sizes to sum, desktop's equivalent is this.
// Returns 0 rather than an error for a missing file, since a trace's
// underlying file can legitimately be gone (moved/deleted outside the app)
// without that being a fatal condition for a size estimate.
#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    match fs::metadata(PathBuf::from(path)) {
        Ok(metadata) => Ok(metadata.len()),
        Err(_) => Ok(0),
    }
}

#[tauri::command]
fn write_vault_text_file(path: String, contents: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(file_path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(file_path, bytes).map_err(|e| e.to_string())
}

// Returns an ipc::Response rather than a Vec<u8>.
//
// Tauri serialises a Vec<u8> return value as a JSON array of numbers -- one
// decimal number and a comma per byte. A 10MB file becomes tens of megabytes
// of JSON text to build here, ship across the IPC boundary, parse in the
// webview, and then walk element by element into a Uint8Array. That is the
// real cost behind paged PDFs feeling slow next to page-per-trace: opening one
// reads the whole document back through this path, while page-per-trace
// renders from a buffer already in memory and never reads it back at all.
//
// ipc::Response sends the bytes over Tauri's binary channel with no
// serialisation. Every local image, audio and video file goes through here
// too, so this isn't only about PDFs.
#[tauri::command]
fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(PathBuf::from(path)).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn copy_file_to_path(source_path: String, destination_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let destination = PathBuf::from(destination_path);

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_path(source_path: String, destination_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Ok(());
    }

    let destination = PathBuf::from(destination_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match fs::rename(&source, &destination) {
        Ok(_) => Ok(()),
        Err(_) => {
            fs::copy(&source, &destination)
                .map(|_| ())
                .map_err(|e| e.to_string())?;
            fs::remove_file(&source).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Ok(());
    }

    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = PathBuf::from(old_path);
    if !old.exists() {
        return Ok(());
    }

    let new = PathBuf::from(new_path);
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::rename(old, new).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // Self-update. `process` supplies the relaunch that has to follow an
        // install, since the running binary is the one being replaced.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir,
            get_vault_base_path,
            set_vault_base_path,
            prepare_live_database,
            vault_path_exists,
            get_file_size,
            write_vault_text_file,
            write_binary_file,
            read_binary_file,
            copy_file_to_path,
            move_path,
            remove_path,
            rename_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
