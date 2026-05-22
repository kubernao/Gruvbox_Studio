pub mod diff_parser;
pub mod error;
pub mod file_ops;
pub mod git_commit_graph;
pub mod markdown;
pub mod merge_resolver;
pub mod watcher;

pub use error::{FileError, FileResult};
pub use file_ops::{
    delete_directory, delete_file, get_file_metadata, list_directory, read_file, write_file,
    FileInfo, FileMetadata,
};
pub use watcher::{
    get_all_events, get_next_event, get_watched_path, is_watching, start_watching, stop_watching,
    FileEvent,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// ---- napi exports (Node native addon) ----

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::time::UNIX_EPOCH;

fn map_file_error(e: FileError) -> Error {
    let (code, msg) = match e {
        FileError::FileNotFound(s) => ("FILE_NOT_FOUND", s),
        FileError::PermissionDenied(s) => ("PERMISSION_DENIED", s),
        FileError::InvalidPath(s) => ("INVALID_PATH", s),
        FileError::IoError(io) => ("IO_ERROR", io.to_string()),
        FileError::InvalidUtf8(s) => ("INVALID_UTF8", s),
        FileError::Other(s) => ("OTHER_ERROR", s),
    };
    Error::from_reason(format!("{}|{}", code, msg))
}

fn ts_secs(st: std::time::SystemTime) -> u64 {
    st.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[napi(object)]
pub struct FileInfoJs {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: f64,
    pub modified_at: f64,
}

#[napi(object)]
pub struct FileMetadataJs {
    pub path: String,
    pub is_directory: bool,
    pub size: f64,
    pub is_file: bool,
    pub is_symlink: bool,
    pub modified_at: f64,
    pub created_at: f64,
    pub permissions_readonly: bool,
}

#[napi]
pub fn napi_read_file(path: String) -> Result<String> {
    read_file(&path).map_err(map_file_error)
}

#[napi]
pub fn napi_write_file(path: String, content: String) -> Result<()> {
    write_file(&path, &content).map_err(map_file_error)
}

#[napi]
pub fn napi_list_directory(path: String) -> Result<Vec<FileInfoJs>> {
    let v = list_directory(&path).map_err(map_file_error)?;
    Ok(v.into_iter()
        .map(|e| FileInfoJs {
            name: e.name,
            path: e.path,
            is_directory: e.is_directory,
            size: e.size as f64,
            modified_at: ts_secs(e.modified_at) as f64,
        })
        .collect())
}

#[napi]
pub fn napi_get_file_metadata(path: String) -> Result<FileMetadataJs> {
    let m = get_file_metadata(&path).map_err(map_file_error)?;
    Ok(FileMetadataJs {
        path: m.path,
        is_directory: m.is_directory,
        size: m.size as f64,
        is_file: m.is_file,
        is_symlink: m.is_symlink,
        modified_at: ts_secs(m.modified_at) as f64,
        created_at: ts_secs(m.created_at) as f64,
        permissions_readonly: m.permissions_readonly,
    })
}

#[napi]
pub fn napi_delete_file(path: String) -> Result<()> {
    delete_file(&path).map_err(map_file_error)
}

#[napi]
pub fn napi_delete_directory(path: String) -> Result<()> {
    delete_directory(&path).map_err(map_file_error)
}

#[napi]
pub fn napi_start_watching(path: String) -> Result<()> {
    start_watching(&path).map_err(map_file_error)
}

#[napi]
pub fn napi_stop_watching() -> Result<()> {
    stop_watching().map(|_| ()).map_err(map_file_error)
}

#[napi]
pub fn napi_is_watching() -> bool {
    is_watching()
}

#[napi]
pub fn napi_get_all_events_json() -> String {
    let v = get_all_events();
    serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string())
}

#[napi]
pub fn napi_get_watched_path() -> Option<String> {
    get_watched_path()
}

#[napi]
pub fn napi_parse_diff_json(diff_text: String) -> Result<String> {
    let rows = diff_parser::parse_unified_diff(&diff_text);
    let blocks = diff_parser::build_change_blocks(&rows);
    serde_json::to_string(&serde_json::json!({ "diffRows": rows, "changeBlocks": blocks }))
        .map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn napi_build_merge_result(
    diff_rows_json: String,
    change_selections_json: String,
    change_blocks_json: String,
) -> Result<String> {
    merge_resolver::build_merge_result(
        &diff_rows_json,
        &change_selections_json,
        &change_blocks_json,
    )
    .map_err(Error::from_reason)
}

#[napi]
pub fn napi_build_commit_graph_json(
    entries_json: String,
    connectivity: String,
    palette_json: Option<String>,
) -> Result<String> {
    git_commit_graph::build_git_log_file_graph_json(
        &entries_json,
        &connectivity,
        palette_json.as_deref(),
    )
    .map_err(Error::from_reason)
}

#[napi]
pub fn napi_render_markdown(source: String) -> Result<String> {
    Ok(markdown::render_markdown(&source))
}
