use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub(crate) struct IdleTimer {
    last: Option<Duration>,
}

impl IdleTimer {
    pub fn arm(&mut self, now: Duration) {
        self.last = Some(now);
    }
    pub fn disarm(&mut self) {
        self.last = None;
    }
    pub fn active(&self) -> bool {
        self.last.is_some()
    }
    pub fn expired(&self, now: Duration) -> bool {
        self.last
            .is_some_and(|last| now.saturating_sub(last) >= TIMEOUT)
    }
    pub fn touch(&mut self, now: Duration) -> bool {
        // A late input must not revive a session that has already timed out.
        if !self.active() || self.expired(now) {
            return false;
        }
        self.last = Some(now);
        true
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn now() -> Duration {
    use std::sync::OnceLock;
    // Apple's continuous monotonic clock advances during sleep and is unaffected
    // by wall-clock adjustments. Supported by every macOS version we ship for.
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut Timebase) -> libc::c_int;
    }
    static TIMEBASE: OnceLock<(u32, u32)> = OnceLock::new();
    let &(numer, denom) = TIMEBASE.get_or_init(|| {
        let mut info = Timebase { numer: 0, denom: 0 };
        assert_eq!(unsafe { mach_timebase_info(&mut info) }, 0);
        assert_ne!(info.denom, 0);
        (info.numer, info.denom)
    });
    let nanos =
        u128::from(unsafe { mach_continuous_time() }) * u128::from(numer) / u128::from(denom);
    Duration::from_nanos(nanos.min(u128::from(u64::MAX)) as u64)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn now() -> Duration {
    use std::{sync::OnceLock, time::Instant};
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn five_full_minutes_after_the_latest_input() {
        let mut timer = IdleTimer::default();
        timer.arm(Duration::ZERO);
        assert!(!timer.expired(Duration::from_millis(299_999)));
        assert!(timer.touch(Duration::from_millis(299_999)));
        assert!(!timer.expired(Duration::from_millis(599_998)));
        assert!(timer.expired(Duration::from_millis(599_999)));
        assert!(!timer.touch(Duration::from_millis(600_000)));
        assert!(timer.expired(Duration::from_millis(600_000)));
        timer.disarm();
        assert!(!timer.touch(Duration::from_secs(700)));
        timer.arm(Duration::from_secs(700));
        assert!(!timer.expired(Duration::from_secs(999)));
    }
    #[test]
    fn background_observation_does_not_extend_the_session() {
        let mut timer = IdleTimer::default();
        timer.arm(Duration::from_secs(10));
        for second in 10..310 {
            assert!(!timer.expired(Duration::from_secs(second)));
        }
        assert!(timer.expired(Duration::from_secs(310)));
        assert!(now() <= now());
    }
}
