//! Display preferences only: no wallet, node, credentials or transaction state.
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, os::unix::fs::OpenOptionsExt, path::PathBuf};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Full,
    Compact,
}
impl Mode {
    pub fn minimum(self) -> Dimensions {
        match self {
            Self::Full => Dimensions {
                width: 920.0,
                height: 700.0,
            },
            Self::Compact => Dimensions {
                width: 720.0,
                height: 540.0,
            },
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Dimensions {
    pub width: f64,
    pub height: f64,
}
impl Dimensions {
    pub fn valid(self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && (480.0..=7680.0).contains(&self.width)
            && (360.0..=4320.0).contains(&self.height)
    }
    pub fn fit(self, minimum: Self, available: Self) -> Self {
        Self {
            width: self.width.max(minimum.width).min(available.width.max(1.0)),
            height: self
                .height
                .max(minimum.height)
                .min(available.height.max(1.0)),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub mode: Mode,
    pub full: Dimensions,
    pub compact: Dimensions,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            mode: Mode::Full,
            full: Dimensions {
                width: 1180.0,
                height: 820.0,
            },
            compact: Dimensions {
                width: 820.0,
                height: 620.0,
            },
        }
    }
}
impl Preferences {
    pub fn size(&self) -> Dimensions {
        if self.mode == Mode::Compact {
            self.compact
        } else {
            self.full
        }
    }
    pub fn remember(&mut self, size: Dimensions) {
        if size.valid() {
            if self.mode == Mode::Compact {
                self.compact = size;
            } else {
                self.full = size;
            }
        }
    }
}
pub struct Store {
    pub prefs: Preferences,
    path: PathBuf,
    pub pending_resize: bool,
}
impl Store {
    pub fn load(path: PathBuf) -> Self {
        // A corrupt or obsolete cosmetic preference must never prevent wallet access.
        let prefs = fs::metadata(&path)
            .ok()
            .filter(|m| m.len() <= 4096)
            .and_then(|_| fs::read(&path).ok())
            .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok())
            .filter(|p| p.full.valid() && p.compact.valid())
            .unwrap_or_default();
        Self {
            prefs,
            path,
            pending_resize: false,
        }
    }
    pub fn save(&mut self, next: Preferences) -> Result<(), String> {
        let temp = self
            .path
            .with_extension(format!("tmp-{:016x}", rand::random::<u64>()));
        let write = || -> Result<(), Box<dyn std::error::Error>> {
            let bytes = serde_json::to_vec(&next)?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temp, &self.path)?;
            Ok(())
        };
        if write().is_err() {
            let _ = fs::remove_file(temp);
            return Err("Could not save the display preference. Your current view and wallet are unchanged.".into());
        }
        self.prefs = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn missing_corrupt_and_oversized_preferences_fall_back_to_full() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-preferences.json");
        assert_eq!(Store::load(path.clone()).prefs.mode, Mode::Full);
        for bad in [
            b"broken".to_vec(),
            b"{\"mode\":\"other\"}".to_vec(),
            vec![b'x'; 4097],
            br#"{"mode":"compact","compact":{"width":-1,"height":620}}"#.to_vec(),
        ] {
            fs::write(&path, bad).unwrap();
            assert_eq!(Store::load(path.clone()).prefs.mode, Mode::Full);
        }
    }
    #[test]
    fn each_view_keeps_its_size_and_writes_only_display_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-preferences.json");
        let mut store = Store::load(path.clone());
        let mut next = store.prefs.clone();
        next.remember(Dimensions {
            width: 1250.0,
            height: 850.0,
        });
        next.mode = Mode::Compact;
        store.save(next).unwrap();
        let loaded = Store::load(path.clone());
        assert_eq!(loaded.prefs.mode, Mode::Compact);
        assert_eq!(loaded.prefs.full.width, 1250.0);
        assert_eq!(loaded.prefs.size().width, 820.0);
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn failed_preference_write_does_not_commit_a_mode_change() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::load(dir.path().join("absent/prefs.json"));
        let next = Preferences {
            mode: Mode::Compact,
            ..Preferences::default()
        };
        assert!(store.save(next).is_err());
        assert_eq!(store.prefs.mode, Mode::Full);
    }
    #[test]
    fn tiny_displays_and_invalid_dimensions_cannot_escape_bounds() {
        let size = Preferences::default().full.fit(
            Mode::Full.minimum(),
            Dimensions {
                width: 800.0,
                height: 500.0,
            },
        );
        assert_eq!(size.width, 800.0);
        assert_eq!(size.height, 500.0);
        assert!(!Dimensions {
            width: f64::NAN,
            height: 600.0
        }
        .valid());
        let mut p = Preferences::default();
        p.remember(Dimensions {
            width: f64::INFINITY,
            height: 0.0,
        });
        assert_eq!(p.full.width, 1180.0);
    }
}
