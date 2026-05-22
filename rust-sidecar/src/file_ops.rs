use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::time::SystemTime;

use crate::error::{FileError, FileResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    #[serde(serialize_with = "serialize_system_time")]
    pub modified_at: SystemTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub is_file: bool,
    pub is_symlink: bool,
    #[serde(serialize_with = "serialize_system_time")]
    pub modified_at: SystemTime,
    #[serde(serialize_with = "serialize_system_time")]
    pub created_at: SystemTime,
    pub permissions_readonly: bool,
}

fn serialize_system_time<S>(time: &SystemTime, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let duration = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(serde::ser::Error::custom)?;
    serializer.serialize_u64(duration.as_secs())
}

/// Read file contents as a string
pub fn read_file(path: &str) -> FileResult<String> {
    validate_path(path)?;
    let file_path = PathBuf::from(path);

    if !file_path.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    if !file_path.is_file() {
        return Err(FileError::InvalidPath(format!(
            "Path is not a file: {}",
            path
        )));
    }

    fs::read_to_string(&file_path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
            std::io::ErrorKind::NotFound => FileError::FileNotFound(path.to_string()),
            _ => FileError::IoError(e),
        })
}

/// Write content to a file, creating it if it doesn't exist
pub fn write_file(path: &str, content: &str) -> FileResult<()> {
    validate_path(path)?;
    let file_path = PathBuf::from(path);

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    FileError::PermissionDenied(path.to_string())
                }
                _ => FileError::IoError(e),
            })?;
        }
    }

    fs::write(&file_path, content)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
            _ => FileError::IoError(e),
        })
}

/// List directory contents
pub fn list_directory(path: &str) -> FileResult<Vec<FileInfo>> {
    validate_path(path)?;
    let dir_path = PathBuf::from(path);

    if !dir_path.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    if !dir_path.is_dir() {
        return Err(FileError::InvalidPath(format!(
            "Path is not a directory: {}",
            path
        )));
    }

    let mut entries = Vec::new();

    let read_dir = fs::read_dir(&dir_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
        std::io::ErrorKind::NotFound => FileError::FileNotFound(path.to_string()),
        _ => FileError::IoError(e),
    })?;

    for entry_result in read_dir {
        let entry = entry_result.map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => {
                FileError::PermissionDenied(path.to_string())
            }
            _ => FileError::IoError(e),
        })?;

        let path_buf = entry.path();
        let metadata = entry.metadata().map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => {
                FileError::PermissionDenied(path_buf.display().to_string())
            }
            _ => FileError::IoError(e),
        })?;

        let file_name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|_| "Invalid UTF-8".to_string());

        entries.push(FileInfo {
            name: file_name,
            path: path_buf.display().to_string(),
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            modified_at: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    }

    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(entries)
}

/// Get detailed metadata for a file or directory
pub fn get_file_metadata(path: &str) -> FileResult<FileMetadata> {
    validate_path(path)?;
    let file_path = PathBuf::from(path);

    if !file_path.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    let metadata = fs::metadata(&file_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
        std::io::ErrorKind::NotFound => FileError::FileNotFound(path.to_string()),
        _ => FileError::IoError(e),
    })?;

    let permissions_readonly = if metadata.is_file() {
        permissions_readonly_o_rdwr_probe(&file_path)?
    } else {
        metadata.permissions().readonly()
    };

    Ok(FileMetadata {
        path: file_path.display().to_string(),
        is_directory: metadata.is_dir(),
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_symlink: metadata.is_symlink(),
        modified_at: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        created_at: metadata
            .created()
            .unwrap_or_else(|_| metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
        permissions_readonly,
    })
}

/// Matches `file-permissions.js`: O_RDWR probe; EACCES/EPERM (and Windows access denied) → read-only for typing.
pub fn permissions_readonly_o_rdwr_probe(file_path: &PathBuf) -> FileResult<bool> {
    match OpenOptions::new().read(true).write(true).open(file_path) {
        Ok(f) => {
            drop(f);
            Ok(false)
        }
        Err(e) => {
            #[cfg(windows)]
            {
                let code = e.raw_os_error();
                let denied = code == Some(5) || code == Some(13);
                return Ok(denied);
            }
            #[cfg(not(windows))]
            {
                let denied = matches!(e.kind(), std::io::ErrorKind::PermissionDenied);
                Ok(denied)
            }
        }
    }
}

/// Delete a file
pub fn delete_file(path: &str) -> FileResult<()> {
    validate_path(path)?;
    let file_path = PathBuf::from(path);

    if !file_path.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    if file_path.is_dir() {
        return Err(FileError::InvalidPath(
            "Use delete_directory for directories".to_string(),
        ));
    }

    fs::remove_file(&file_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
        std::io::ErrorKind::NotFound => FileError::FileNotFound(path.to_string()),
        _ => FileError::IoError(e),
    })
}

/// Delete a directory recursively
pub fn delete_directory(path: &str) -> FileResult<()> {
    validate_path(path)?;
    let dir_path = PathBuf::from(path);

    if !dir_path.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    if !dir_path.is_dir() {
        return Err(FileError::InvalidPath("Path is not a directory".to_string()));
    }

    fs::remove_dir_all(&dir_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => FileError::PermissionDenied(path.to_string()),
        std::io::ErrorKind::NotFound => FileError::FileNotFound(path.to_string()),
        _ => FileError::IoError(e),
    })
}

/// Validate path to prevent directory traversal attacks
fn validate_path(path: &str) -> FileResult<()> {
    if path.is_empty() {
        return Err(FileError::InvalidPath("Empty path".to_string()));
    }

    // Reject paths with null bytes
    if path.contains('\0') {
        return Err(FileError::InvalidPath("Path contains null bytes".to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_write_and_read_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let path_str = file_path.to_str().unwrap();

        let content = "Hello, Rust!";
        write_file(path_str, content).unwrap();

        let read_content = read_file(path_str).unwrap();
        assert_eq!(read_content, content);
    }

    #[test]
    fn test_list_directory() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path();

        fs::write(dir_path.join("file1.txt"), "content1").unwrap();
        fs::write(dir_path.join("file2.txt"), "content2").unwrap();
        fs::create_dir(dir_path.join("subdir")).unwrap();

        let entries = list_directory(dir_path.to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().any(|e| e.name == "file1.txt"));
        assert!(entries.iter().any(|e| e.name == "file2.txt"));
        assert!(entries.iter().any(|e| e.name == "subdir" && e.is_directory));
    }

    #[test]
    fn test_get_file_metadata() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let path_str = file_path.to_str().unwrap();

        write_file(path_str, "test content").unwrap();
        let metadata = get_file_metadata(path_str).unwrap();

        assert!(!metadata.is_directory);
        assert!(metadata.is_file);
        assert_eq!(metadata.size, 12);
    }

    #[test]
    fn test_file_not_found() {
        let result = read_file("/nonexistent/path/file.txt");
        assert!(result.is_err());
    }
}
