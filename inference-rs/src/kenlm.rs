#![allow(dead_code)]
use std::ffi::{CString};
use libc::{c_void, c_float, c_uint};

mod ffi {
    use super::*;
    #[repr(C)]
    pub struct Model(c_void);

    extern "C" {
        pub fn load_model(path: *const i8) -> *mut Model;
        pub fn destroy_model(model: *mut Model);
        pub fn score_model(model: *mut Model, in_state: *const c_void, new_word: c_uint, out_state: *mut c_void) -> c_float;
        pub fn get_word_index(model: *mut Model, word: *const i8) -> c_uint;
        pub fn get_state_size(model: *mut Model) -> usize;
        pub fn begin_sentence_write(model: *mut Model, to: *mut c_void);
        pub fn null_context_write(model: *mut Model, to: *mut c_void);
        pub fn get_order(model: *mut Model) -> c_uint;
    }
}

pub struct Model {
    ptr: *mut ffi::Model,
    state_size: usize,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct State {
    pub data: [u8; 128], // Large enough for KenLM order 6
}

impl Default for State {
    fn default() -> Self {
        State { data: [0u8; 128] }
    }
}

unsafe impl Send for Model {}
unsafe impl Sync for Model {}

#[allow(dead_code)]
impl Model {
    pub fn new(path: &str) -> Result<Self, String> {
        let c_path = CString::new(path).map_err(|e| e.to_string())?;
        let ptr = unsafe { ffi::load_model(c_path.as_ptr()) };
        if ptr.is_null() {
            return Err(format!("Failed to load model from {}", path));
        }
        let state_size = unsafe { ffi::get_state_size(ptr) };
        if state_size > 128 {
            return Err(format!("Model state size {} exceeds buffer size 128", state_size));
        }
        Ok(Model { ptr, state_size })
    }

    pub fn score(&self, state: &State, word: &str) -> (f32, State) {
        let word_c = CString::new(word).unwrap_or_default();
        let word_idx = unsafe { ffi::get_word_index(self.ptr, word_c.as_ptr()) };
        
        self.score_index(state, word_idx)
    }
    
    pub fn score_index(&self, state: &State, word_idx: u32) -> (f32, State) {
        let mut out_state = State::default();
        let score = unsafe {
            ffi::score_model(
                self.ptr,
                state.data.as_ptr() as *const c_void,
                word_idx,
                out_state.data.as_mut_ptr() as *mut c_void
            )
        };
        (score, out_state)
    }

    pub fn lookup(&self, word: &str) -> u32 {
         let word_c = CString::new(word).unwrap_or_default();
         unsafe { ffi::get_word_index(self.ptr, word_c.as_ptr()) }
    }

    pub fn begin_sentence_state(&self) -> State {
        let mut state = State::default();
        unsafe { ffi::begin_sentence_write(self.ptr, state.data.as_mut_ptr() as *mut c_void) };
        state
    }
    
    pub fn null_context_state(&self) -> State {
        let mut state = State::default();
        unsafe { ffi::null_context_write(self.ptr, state.data.as_mut_ptr() as *mut c_void) };
        state
    }

    pub fn order(&self) -> u32 {
        unsafe { ffi::get_order(self.ptr) }
    }
}

impl Drop for Model {
    fn drop(&mut self) {
        unsafe { ffi::destroy_model(self.ptr) };
    }
}
