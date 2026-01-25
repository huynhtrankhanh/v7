#![allow(dead_code)]
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;

#[derive(Clone, Debug)]
pub struct State {
    pub data: [u8; 128],
}

impl Default for State {
    fn default() -> Self {
        State { data: [0u8; 128] }
    }
}

pub struct Model {
    order: u32,
}

impl Model {
    pub fn new(path: &str) -> Result<Self, String> {
        eprintln!("Mock Model: Loading dummy model from {}", path);
        Ok(Model { order: 5 })
    }

    pub fn score(&self, state: &State, word: &str) -> (f32, State) {
        let idx = self.lookup(word);
        self.score_index(state, idx)
    }

    pub fn score_index(&self, state: &State, word_idx: u32) -> (f32, State) {
        // Return a deterministic pseudo-random score based on word_idx and state
        let mut hasher = DefaultHasher::new();
        state.data.hash(&mut hasher);
        word_idx.hash(&mut hasher);
        let hash = hasher.finish();

        // Map hash to a reasonable log prob range, e.g., -10.0 to -1.0
        let score = -1.0 - ((hash % 900) as f32 / 100.0);

        // Update state somewhat deterministically
        let mut new_state = state.clone();
        new_state.data[0] = (hash & 0xFF) as u8;
        new_state.data[1] = ((hash >> 8) & 0xFF) as u8;

        (score, new_state)
    }

    pub fn lookup(&self, word: &str) -> u32 {
        let mut hasher = DefaultHasher::new();
        word.hash(&mut hasher);
        (hasher.finish() & 0xFFFFFFFF) as u32
    }

    pub fn begin_sentence_state(&self) -> State {
        let mut s = State::default();
        s.data[0] = 1; // Mark as BOS
        s
    }

    pub fn null_context_state(&self) -> State {
        State::default()
    }

    pub fn order(&self) -> u32 {
        self.order
    }
}
