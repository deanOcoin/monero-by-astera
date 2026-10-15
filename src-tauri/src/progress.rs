use serde_json::{json, Value};
use std::time::Instant;

#[derive(Default)]
pub(crate) struct Progress {
    phase: String,
    started: Option<Instant>,
    samples: Vec<(String, u128)>,
}
impl Progress {
    pub fn set(&mut self, phase: &str) {
        if let Some(start) = self.started.take() {
            self.samples
                .push((self.phase.clone(), start.elapsed().as_millis()));
            if self.samples.len() > 32 {
                self.samples.remove(0);
            }
        }
        self.phase = phase.into();
        self.started = Some(Instant::now());
    }
    pub fn snapshot(&self) -> Value {
        json!({"phase":self.phase,"elapsedMs":self.started.map(|t|t.elapsed().as_millis()).unwrap_or(0),"timings":self.samples})
    }
}
