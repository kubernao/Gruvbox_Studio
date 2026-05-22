use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("IO error: {0}")]
    IoError(#[from] io::Error),

    #[error("Invalid UTF-8: {0}")]
    InvalidUtf8(String),

    #[error("Other error: {0}")]
    Other(String),
}

pub type FileResult<T> = Result<T, FileError>;

impl From<FileError> for serde_json::Value {
    fn from(err: FileError) -> Self {
        serde_json::json!({
            "error": err.to_string(),
            "code": match err {
                FileError::FileNotFound(_) => "FILE_NOT_FOUND",
                FileError::PermissionDenied(_) => "PERMISSION_DENIED",
                FileError::InvalidPath(_) => "INVALID_PATH",
                FileError::IoError(_) => "IO_ERROR",
                FileError::InvalidUtf8(_) => "INVALID_UTF8",
                FileError::Other(_) => "OTHER_ERROR",
            }
        })
    }
}
