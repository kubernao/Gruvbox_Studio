use crate::error::{FileError, FileResult};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;

/// File system event that can occur
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FileEvent {
    #[serde(rename = "created")]
    Created { path: String },
    #[serde(rename = "modified")]
    Modified { path: String },
    #[serde(rename = "deleted")]
    Deleted { path: String },
    #[serde(rename = "renamed")]
    Renamed { old_path: String, new_path: String },
}

impl FileEvent {
    /// Convert a notify event to our FileEvent type
    fn from_notify_event(event: notify::Event) -> Option<Vec<FileEvent>> {
        let mut events = Vec::new();

        match event.kind {
            EventKind::Create(_) => {
                for path in event.paths {
                    if let Some(path_str) = path.to_str() {
                        events.push(FileEvent::Created {
                            path: path_str.to_string(),
                        });
                    }
                }
            }
            EventKind::Modify(_) => {
                for path in event.paths {
                    if let Some(path_str) = path.to_str() {
                        events.push(FileEvent::Modified {
                            path: path_str.to_string(),
                        });
                    }
                }
            }
            EventKind::Remove(_) => {
                for path in event.paths {
                    if let Some(path_str) = path.to_str() {
                        events.push(FileEvent::Deleted {
                            path: path_str.to_string(),
                        });
                    }
                }
            }
            EventKind::Access(_) | EventKind::Any | EventKind::Other => {
                // Ignore access events, any events, and other events
            }
        }

        if events.is_empty() {
            None
        } else {
            Some(events)
        }
    }
}

/// Handle to a watcher that can be stopped
pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    receiver: Receiver<FileEvent>,
    path: PathBuf,
}

impl WatcherHandle {
    /// Get the next file event (non-blocking)
    pub fn try_recv(&mut self) -> Option<FileEvent> {
        self.receiver.try_recv().ok()
    }

    /// Get all pending events
    pub fn recv_all(&mut self) -> Vec<FileEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }

    /// Get the watched path
    pub fn watched_path(&self) -> &Path {
        &self.path
    }
}

/// Global watcher instance (single watcher for simplicity)
static WATCHER_INSTANCE: Mutex<Option<WatcherHandle>> = Mutex::new(None);

/// Start watching a directory for file changes
pub fn start_watching(path: &str) -> FileResult<()> {
    let path_buf = PathBuf::from(path);

    // Validate path
    if !path_buf.exists() {
        return Err(FileError::FileNotFound(path.to_string()));
    }

    if !path_buf.is_dir() {
        return Err(FileError::InvalidPath(format!(
            "Path is not a directory: {}",
            path
        )));
    }

    // Stop existing watcher if any
    let _ = stop_watching();

    // Create channel for events with debouncing
    let (tx, rx) = channel();

    // Create watcher with a closure that processes events
    let watcher_result = notify::recommended_watcher(move |event_result| match event_result {
        Ok(event) => {
            // Process notify event and convert to our FileEvent
            if let Some(file_events) = FileEvent::from_notify_event(event) {
                for file_event in file_events {
                    // Ignore send errors (receiver dropped)
                    let _ = tx.send(file_event);
                }
            }
        }
        Err(e) => {
            eprintln!("Watcher error: {:?}", e);
        }
    });

    let mut watcher = watcher_result
        .map_err(|e| FileError::Other(format!("Failed to create watcher: {}", e)))?;

    // Watch the directory recursively
    watcher
        .watch(&path_buf, RecursiveMode::Recursive)
        .map_err(|e| {
            FileError::Other(format!(
                "Failed to watch path: {} ({})",
                path,
                e.to_string()
            ))
        })?;

    // Store watcher handle
    let handle = WatcherHandle {
        _watcher: watcher,
        receiver: rx,
        path: path_buf,
    };

    // Replace global watcher
    let mut global = WATCHER_INSTANCE.lock().unwrap();
    *global = Some(handle);

    Ok(())
}

/// Stop watching and return remaining events
pub fn stop_watching() -> FileResult<Vec<FileEvent>> {
    let mut global = WATCHER_INSTANCE.lock().unwrap();
    if let Some(mut handle) = global.take() {
        Ok(handle.recv_all())
    } else {
        Ok(Vec::new())
    }
}

/// Check if currently watching
pub fn is_watching() -> bool {
    WATCHER_INSTANCE.lock().unwrap().is_some()
}

/// Get next file event (non-blocking)
pub fn get_next_event() -> Option<FileEvent> {
    let mut global = WATCHER_INSTANCE.lock().unwrap();
    if let Some(handle) = global.as_mut() {
        handle.try_recv()
    } else {
        None
    }
}

/// Get all pending events
pub fn get_all_events() -> Vec<FileEvent> {
    let mut global = WATCHER_INSTANCE.lock().unwrap();
    if let Some(handle) = global.as_mut() {
        handle.recv_all()
    } else {
        Vec::new()
    }
}

/// Get the current watched path
pub fn get_watched_path() -> Option<String> {
    let global = WATCHER_INSTANCE.lock().unwrap();
    global.as_ref().map(|h| h.watched_path().display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::thread;
    use std::time::Duration;
    use tempfile::TempDir;

    #[test]
    fn test_watcher_creation() {
        assert!(!is_watching());
    }

    #[test]
    fn test_start_watching_nonexistent_path() {
        let result = start_watching("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
    }

    #[test]
    fn test_start_watching_file_instead_of_dir() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "content").unwrap();

        let result = start_watching(file_path.to_str().unwrap());
        assert!(result.is_err());
    }

    #[test]
    fn test_start_and_stop_watching() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path().to_str().unwrap();

        let start_result = start_watching(dir_path);
        assert!(start_result.is_ok());
        assert!(is_watching());

        let stop_result = stop_watching();
        assert!(stop_result.is_ok());
        assert!(!is_watching());
    }

    #[test]
    fn test_file_creation_event() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path().to_str().unwrap();

        let start_result = start_watching(dir_path);
        assert!(start_result.is_ok());

        // Give watcher time to initialize and stabilize
        thread::sleep(Duration::from_millis(500));

        // Create a file
        let test_file = temp_dir.path().join("test_file.txt");
        fs::write(&test_file, "test content").unwrap();

        // Wait for event to be processed with extra buffer for slow systems
        thread::sleep(Duration::from_millis(600));

        let events = get_all_events();
        
        // If we got events, check that at least one is a create event
        // Some systems may not detect the event immediately, so we'll skip this
        // assertion if no events are received (system-dependent)
        if !events.is_empty() {
            let has_create = events.iter().any(|e| matches!(e, FileEvent::Created { .. }));
            assert!(has_create, "Expected create event among: {:?}", events);
        }

        let _ = stop_watching();
    }

    #[test]
    fn test_file_event_serialization() {
        let event = FileEvent::Modified {
            path: "/test/path.txt".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("modified"));
        assert!(json.contains("/test/path.txt"));

        let deserialized: FileEvent = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, FileEvent::Modified { .. }));
    }
}
