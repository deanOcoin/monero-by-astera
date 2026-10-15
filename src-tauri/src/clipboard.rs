use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub trait ClipboardAccess {
    fn text(&mut self) -> Option<String>;
    fn write(&mut self, value: &str) -> Result<(), String>;
    fn erase(&mut self) -> Result<(), String>;
}
impl ClipboardAccess for arboard::Clipboard {
    fn text(&mut self) -> Option<String> {
        self.get_text().ok()
    }
    fn write(&mut self, value: &str) -> Result<(), String> {
        self.set_text(value).map_err(|_| "Cannot copy".into())
    }
    fn erase(&mut self) -> Result<(), String> {
        self.clear().map_err(|_| "Cannot clear clipboard".into())
    }
}
#[derive(Default)]
pub struct ClipboardLease {
    expected: Option<Zeroizing<String>>,
    expires: Option<Instant>,
}
impl ClipboardLease {
    pub fn copy(
        &mut self,
        clipboard: &mut impl ClipboardAccess,
        value: &str,
        now: Instant,
    ) -> Result<(), String> {
        clipboard.write(value)?;
        self.expected = Some(Zeroizing::new(value.into()));
        self.expires = Some(now + Duration::from_secs(30));
        Ok(())
    }
    pub fn due(&self, now: Instant) -> bool {
        self.expires.is_some_and(|e| now >= e)
    }
    pub fn tracked(&self) -> bool {
        self.expected.is_some()
    }
    pub fn clear(&mut self, clipboard: &mut impl ClipboardAccess) -> Result<(), String> {
        if let Some(expected) = &self.expected {
            if clipboard.text().as_deref() == Some(expected.as_str()) {
                clipboard.erase()?;
            }
        }
        self.expected = None;
        self.expires = None;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake(String);
    impl ClipboardAccess for Fake {
        fn text(&mut self) -> Option<String> {
            Some(self.0.clone())
        }
        fn write(&mut self, v: &str) -> Result<(), String> {
            self.0 = v.into();
            Ok(())
        }
        fn erase(&mut self) -> Result<(), String> {
            self.0.clear();
            Ok(())
        }
    }
    #[test]
    fn repeated_copy_renews_expiry() {
        let mut c = Fake::default();
        let mut l = ClipboardLease::default();
        let t = Instant::now();
        l.copy(&mut c, "address", t).unwrap();
        assert!(!l.due(t + Duration::from_secs(29)));
        assert!(l.due(t + Duration::from_secs(30)));
        l.copy(&mut c, "address", t + Duration::from_secs(20))
            .unwrap();
        assert!(!l.due(t + Duration::from_secs(30)));
        assert!(l.due(t + Duration::from_secs(50)));
        l.clear(&mut c).unwrap();
        assert!(c.0.is_empty());
        assert!(!l.tracked());
    }
    #[test]
    fn preserve_replacement_and_clear_on_lock() {
        let mut c = Fake::default();
        let mut l = ClipboardLease::default();
        l.copy(&mut c, "wallet address", Instant::now()).unwrap();
        c.0 = "user's newer clipboard".into();
        l.clear(&mut c).unwrap();
        assert_eq!(c.0, "user's newer clipboard");
        l.copy(&mut c, "transaction id", Instant::now()).unwrap();
        l.clear(&mut c).unwrap();
        assert!(c.0.is_empty());
    }
}
