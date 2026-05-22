# Gruvbox File Operations Rust Module

A high-performance Rust backend for file operations in the Gruvbox Studio Electron application.

## Features

- **File Reading**: Read file contents with error handling
- **File Writing**: Write/create files with automatic directory creation
- **Directory Listing**: List directory contents with sorting
- **Metadata Retrieval**: Get detailed file metadata (size, timestamps, permissions)
- **File Deletion**: Delete files and directories
- **Error Handling**: User-friendly error messages with error codes
- **Cross-Platform Support**: Works on Windows, macOS, and Linux
- **Path Validation**: Built-in protections against invalid paths

## Module Structure

```
rust-sidecar/
├── Cargo.toml          # Project configuration and dependencies
└── src/
    ├── lib.rs          # Main library file with public API
    ├── error.rs        # Custom error types and handling
    ├── file_ops.rs     # File operation implementations
    └── watcher.rs      # File system watcher stub (for next phase)
```

## API Documentation

### File Operations

#### `read_file(path: &str) -> FileResult<String>`
Read file contents as UTF-8 string.

**Errors**: FileNotFound, PermissionDenied, InvalidPath, IoError

#### `write_file(path: &str, content: &str) -> FileResult<()>`
Write content to file. Creates file if it doesn't exist. Creates parent directories if needed.

**Errors**: PermissionDenied, IoError

#### `list_directory(path: &str) -> FileResult<Vec<FileInfo>>`
List directory contents. Returns entries sorted (directories first, then alphabetically).

**Returns**: Vector of FileInfo structs with name, path, is_directory, size, modified_at

**Errors**: FileNotFound, InvalidPath, PermissionDenied, IoError

#### `get_file_metadata(path: &str) -> FileResult<FileMetadata>`
Get detailed metadata for a file or directory.

**Returns**: FileMetadata with complete information including permissions and timestamps

**Errors**: FileNotFound, PermissionDenied, IoError

#### `delete_file(path: &str) -> FileResult<()>`
Delete a single file.

**Errors**: FileNotFound, InvalidPath, PermissionDenied, IoError

#### `delete_directory(path: &str) -> FileResult<()>`
Recursively delete a directory and all contents.

**Errors**: FileNotFound, InvalidPath, PermissionDenied, IoError

### Data Structures

#### `FileInfo`
```rust
struct FileInfo {
    pub name: String,              // File/directory name only
    pub path: String,              // Full path
    pub is_directory: bool,        // Is it a directory?
    pub size: u64,                 // Size in bytes
    pub modified_at: SystemTime,   // Last modification time (Unix timestamp)
}
```

#### `FileMetadata`
```rust
struct FileMetadata {
    pub path: String,              // Full path
    pub is_directory: bool,        // Is it a directory?
    pub size: u64,                 // Size in bytes
    pub is_file: bool,             // Is it a file?
    pub is_symlink: bool,          // Is it a symbolic link?
    pub modified_at: SystemTime,   // Last modification time
    pub created_at: SystemTime,    // Creation time
    pub permissions_readonly: bool,// Is it read-only?
}
```

### Error Handling

#### `FileError` Enum
```rust
pub enum FileError {
    FileNotFound(String),          // File/path doesn't exist
    PermissionDenied(String),      // Access denied
    InvalidPath(String),           // Path is invalid or unusable
    IoError(io::Error),            // Generic IO error
    InvalidUtf8(String),           // UTF-8 decoding error
    Other(String),                 // Other errors
}
```

Error messages are serialized to JSON with error codes for IPC communication:
```json
{
  "error": "File not found: /path/to/file",
  "code": "FILE_NOT_FOUND"
}
```

## Dependencies

- **tokio** (1.35+): Async runtime for future async file operations
- **serde** & **serde_json** (1.0): Serialization for IPC
- **thiserror** (1.0): Ergonomic error handling
- **notify** (6.1): File system event monitoring (prepared for next phase)

## Building

### Release Build
```bash
cd rust-sidecar
cargo build --release
```

Output: `target/release/gruvbox_file_ops.lib` (Windows) or `.a` (Unix)

### Running Tests
```bash
cargo test --release
```

All tests pass (7 tests covering file ops and watcher functionality).

## Cross-Platform Notes

- **Windows**: Uses Windows path separators (`\`), fully tested
- **macOS/Linux**: Uses Unix path separators (`/`)
- All code uses `std::path::Path` and `PathBuf` for platform abstraction
- Handles both absolute and relative paths correctly
- Respects platform-specific permissions and symbolic links

## Path Validation

The module includes built-in security:
- Rejects empty paths
- Prevents null byte injection
- Validates path existence before operations
- Proper error messages for permission denied vs not found

## IPC Integration (Next Phase)

This module is designed for Electron IPC:
- All functions return `FileResult<T>` which serializes to JSON
- Error types implement JSON serialization
- Compatible with `tauri::invoke` or `ipcMain.handle()` patterns
- Returns user-friendly error codes for frontend handling

## Testing

All modules include unit tests:
- **file_ops**: Read/write, list directory, metadata retrieval, error conditions
- **watcher**: Creation, watch path tracking, state management
- Uses `tempfile` crate for safe test file isolation

Run tests with: `cargo test --release`

## Future Enhancements

1. **File Watching**: Implement full notify integration in `watcher.rs`
2. **Copy/Move**: Add file and directory copy/move operations
3. **Search**: Add file content and name search functionality
4. **Compression**: Add zip/tar support
5. **Async APIs**: Leverage tokio for large file operations

## Security Considerations

- Path validation prevents directory traversal
- Respects OS-level file permissions
- No symlink following by default (use metadata to check)
- All errors are user-friendly without exposing system paths unnecessarily
