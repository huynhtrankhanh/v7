use anyhow::{Context, Result};
use libloading::Library;
use serde_json::Value;
use std::cmp::Ordering;
use std::ffi::{c_char, c_int, c_void, CString};
use std::path::Path;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Mutex, OnceLock};

const MAX_CONTEXT_TOKENS: c_int = 2048;

type SettingsCreate =
    unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, *const c_char) -> *mut c_void;
type SettingsDelete = unsafe extern "C" fn(*mut c_void);
type SettingsSetInt = unsafe extern "C" fn(*mut c_void, c_int);
type SettingsSetBool = unsafe extern "C" fn(*mut c_void, bool);
type SettingsSetString = unsafe extern "C" fn(*mut c_void, *const c_char);
type EngineCreate = unsafe extern "C" fn(*const c_void) -> *mut c_void;
type EngineDelete = unsafe extern "C" fn(*mut c_void);
type SessionConfigCreate = unsafe extern "C" fn() -> *mut c_void;
type SessionConfigDelete = unsafe extern "C" fn(*mut c_void);
type SessionConfigSetBool = unsafe extern "C" fn(*mut c_void, bool);
type SessionCreate = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
type SessionDelete = unsafe extern "C" fn(*mut c_void);
type SessionCancel = unsafe extern "C" fn(*mut c_void);
type InputCreate = unsafe extern "C" fn(c_int, *const c_void, usize) -> *mut c_void;
type InputDelete = unsafe extern "C" fn(*mut c_void);
type RunPrefill = unsafe extern "C" fn(*mut c_void, *const *const c_void, usize) -> c_int;
type RunScoring =
    unsafe extern "C" fn(*mut c_void, *const *const c_char, usize, bool) -> *mut c_void;
type ResponsesDelete = unsafe extern "C" fn(*mut c_void);
type ResponsesCount = unsafe extern "C" fn(*const c_void) -> c_int;
type ResponsesHas = unsafe extern "C" fn(*const c_void, c_int) -> bool;
type ResponsesScore = unsafe extern "C" fn(*const c_void, c_int) -> f32;
type ResponsesTokenLength = unsafe extern "C" fn(*const c_void, c_int) -> c_int;

struct Api {
    _library: Library,
    settings_create: SettingsCreate,
    settings_delete: SettingsDelete,
    settings_set_max_tokens: SettingsSetInt,
    settings_set_num_threads: SettingsSetInt,
    settings_set_parallel_loading: SettingsSetBool,
    settings_set_cache_dir: SettingsSetString,
    settings_set_ringbuffer: SettingsSetBool,
    engine_create: EngineCreate,
    engine_delete: EngineDelete,
    session_config_create: SessionConfigCreate,
    session_config_delete: SessionConfigDelete,
    session_config_set_apply_template: SessionConfigSetBool,
    session_create: SessionCreate,
    session_delete: SessionDelete,
    session_cancel: SessionCancel,
    input_create: InputCreate,
    input_delete: InputDelete,
    run_prefill: RunPrefill,
    run_scoring: RunScoring,
    responses_delete: ResponsesDelete,
    responses_count: ResponsesCount,
    responses_has_score: ResponsesHas,
    responses_score: ResponsesScore,
    responses_has_token_length: ResponsesHas,
    responses_token_length: ResponsesTokenLength,
}

unsafe impl Send for Api {}
unsafe impl Sync for Api {}

impl Api {
    unsafe fn load(path: &Path) -> Result<Self> {
        let library = match Library::new(path) {
            Ok(library) => library,
            Err(path_error) => Library::new("liblitert-lm.so").with_context(|| {
                format!(
                    "Unable to load {} ({path_error}) or resolve liblitert-lm.so in Android's native-library namespace",
                    path.display()
                )
            })?,
        };
        macro_rules! symbol {
            ($name:literal, $kind:ty) => {
                *library
                    .get::<$kind>(concat!($name, "\0").as_bytes())
                    .with_context(|| concat!("Missing LiteRT-LM symbol ", $name))?
            };
        }
        Ok(Self {
            settings_create: symbol!("litert_lm_engine_settings_create", SettingsCreate),
            settings_delete: symbol!("litert_lm_engine_settings_delete", SettingsDelete),
            settings_set_max_tokens: symbol!(
                "litert_lm_engine_settings_set_max_num_tokens",
                SettingsSetInt
            ),
            settings_set_num_threads: symbol!(
                "litert_lm_engine_settings_set_num_threads",
                SettingsSetInt
            ),
            settings_set_parallel_loading: symbol!(
                "litert_lm_engine_settings_set_parallel_file_section_loading",
                SettingsSetBool
            ),
            settings_set_cache_dir: symbol!(
                "litert_lm_engine_settings_set_cache_dir",
                SettingsSetString
            ),
            settings_set_ringbuffer: symbol!(
                "litert_lm_engine_settings_set_use_ringbuffers_local_attention",
                SettingsSetBool
            ),
            engine_create: symbol!("litert_lm_engine_create", EngineCreate),
            engine_delete: symbol!("litert_lm_engine_delete", EngineDelete),
            session_config_create: symbol!("litert_lm_session_config_create", SessionConfigCreate),
            session_config_delete: symbol!("litert_lm_session_config_delete", SessionConfigDelete),
            session_config_set_apply_template: symbol!(
                "litert_lm_session_config_set_apply_prompt_template",
                SessionConfigSetBool
            ),
            session_create: symbol!("litert_lm_engine_create_session", SessionCreate),
            session_delete: symbol!("litert_lm_session_delete", SessionDelete),
            session_cancel: symbol!("litert_lm_session_cancel_process", SessionCancel),
            input_create: symbol!("litert_lm_input_data_create", InputCreate),
            input_delete: symbol!("litert_lm_input_data_delete", InputDelete),
            run_prefill: symbol!("litert_lm_session_run_prefill", RunPrefill),
            run_scoring: symbol!("litert_lm_session_run_text_scoring", RunScoring),
            responses_delete: symbol!("litert_lm_responses_delete", ResponsesDelete),
            responses_count: symbol!("litert_lm_responses_get_num_candidates", ResponsesCount),
            responses_has_score: symbol!("litert_lm_responses_has_score_at", ResponsesHas),
            responses_score: symbol!("litert_lm_responses_get_score_at", ResponsesScore),
            responses_has_token_length: symbol!(
                "litert_lm_responses_has_token_length_at",
                ResponsesHas
            ),
            responses_token_length: symbol!(
                "litert_lm_responses_get_token_length_at",
                ResponsesTokenLength
            ),
            _library: library,
        })
    }
}

struct CachedEngine {
    api: Api,
    engine: *mut c_void,
    model_id: String,
    library_path: String,
    backend: String,
}

unsafe impl Send for CachedEngine {}

impl Drop for CachedEngine {
    fn drop(&mut self) {
        if !self.engine.is_null() {
            unsafe { (self.api.engine_delete)(self.engine) };
        }
    }
}

#[derive(Default)]
struct Status {
    state: String,
    error: String,
    backend: String,
}

static ENGINE: OnceLock<Mutex<Option<CachedEngine>>> = OnceLock::new();
static STATUS: OnceLock<Mutex<Status>> = OnceLock::new();
static ACTIVE_SESSION: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static CANCEL_FUNCTION: AtomicUsize = AtomicUsize::new(0);
static CANCELLATION_EPOCH: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_SESSION_LIFETIME: Mutex<()> = Mutex::new(());

fn status() -> &'static Mutex<Status> {
    STATUS.get_or_init(|| Mutex::new(Status::default()))
}

fn update_status(state: &str, error: &str, backend: &str) {
    if let Ok(mut value) = status().lock() {
        value.state = state.to_owned();
        value.error = error.to_owned();
        value.backend = backend.to_owned();
    }
}

pub fn status_json(enabled: bool, has_model: bool) -> String {
    if !enabled {
        return r#"{"state":"disabled","error":"","backend":""}"#.to_owned();
    }
    if !has_model {
        return r#"{"state":"missing","error":"","backend":""}"#.to_owned();
    }
    let value = status().lock().ok();
    let state = value
        .as_ref()
        .map(|value| value.state.as_str())
        .filter(|state| !state.is_empty())
        .unwrap_or("not_loaded");
    serde_json::json!({
        "state": state,
        "error": value.as_ref().map(|value| value.error.as_str()).unwrap_or(""),
        "backend": value.as_ref().map(|value| value.backend.as_str()).unwrap_or("")
    })
    .to_string()
}

pub fn cancel() {
    // Serialize pointer use with session deletion without holding this lock
    // during the scoring call itself.
    let _lifetime = ACTIVE_SESSION_LIFETIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    CANCELLATION_EPOCH.fetch_add(1, AtomicOrdering::AcqRel);
    let session = ACTIVE_SESSION.load(AtomicOrdering::Acquire);
    if session.is_null() {
        return;
    }
    let function = CANCEL_FUNCTION.load(AtomicOrdering::Acquire);
    if function != 0 {
        let cancel: SessionCancel = unsafe { std::mem::transmute(function) };
        unsafe { cancel(session) };
    }
}

pub fn cancellation_epoch() -> usize {
    CANCELLATION_EPOCH.load(AtomicOrdering::Acquire)
}

pub struct Config<'a> {
    pub enabled: bool,
    pub model_path: &'a str,
    pub model_id: &'a str,
    pub cache_dir: &'a str,
    pub library_dir: &'a str,
    pub top_k: usize,
    pub cpu_threads: c_int,
    pub cancellation_epoch: usize,
}

pub fn preload(config: &Config<'_>) -> Result<()> {
    if !config.enabled {
        *ENGINE.get_or_init(|| Mutex::new(None)).lock().unwrap() = None;
        update_status("disabled", "", "");
        return Ok(());
    }
    let mut guard = ENGINE.get_or_init(|| Mutex::new(None)).lock().unwrap();
    match ensure_engine(&mut guard, config, false) {
        Ok(_) => Ok(()),
        Err(gpu_error) => {
            *guard = None;
            ensure_engine(&mut guard, config, true)
                .map(|_| ())
                .map_err(|cpu_error| {
                    anyhow::anyhow!(
                        "GPU preload failed: {gpu_error}; CPU fallback failed: {cpu_error}"
                    )
                })
        }
    }
}

pub fn rerank_json(response_body: &str, config: &Config<'_>) -> Result<String> {
    if !config.enabled || config.top_k < 2 {
        return Ok(response_body.to_owned());
    }
    if cancellation_epoch() != config.cancellation_epoch {
        return Ok(response_body.to_owned());
    }
    let mut response: Value = serde_json::from_str(response_body)?;
    let candidates = response
        .get_mut("candidates")
        .and_then(Value::as_array_mut)
        .context("Inference response has no candidate array")?;
    let count = config.top_k.min(candidates.len());
    if count < 2 {
        return Ok(response_body.to_owned());
    }
    let texts = candidates[..count]
        .iter()
        .map(candidate_text)
        .collect::<Result<Vec<_>>>()?;

    let mut guard = ENGINE.get_or_init(|| Mutex::new(None)).lock().unwrap();
    // Once a device has fallen back to CPU, keep that cached backend instead of
    // paying for a known-failing GPU initialization on every key press.
    let using_cached_cpu = guard.as_ref().map(|value| value.backend.as_str()) == Some("cpu");
    let first_attempt = score(&mut guard, config, &texts, using_cached_cpu);
    let scores = match first_attempt {
        Ok(scores) => scores,
        Err(_) if cancellation_epoch() != config.cancellation_epoch => {
            mark_ready(&guard);
            return Ok(response_body.to_owned());
        }
        Err(gpu_error) if !using_cached_cpu => {
            *guard = None;
            match score(&mut guard, config, &texts, true) {
                Ok(scores) => scores,
                Err(_) if cancellation_epoch() != config.cancellation_epoch => {
                    mark_ready(&guard);
                    return Ok(response_body.to_owned());
                }
                Err(cpu_error) => {
                    anyhow::bail!(
                        "GPU scoring failed: {gpu_error}; CPU fallback failed: {cpu_error}"
                    );
                }
            }
        }
        Err(error) => return Err(error),
    };

    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by(|left, right| {
        scores[*right]
            .partial_cmp(&scores[*left])
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.cmp(right))
    });
    let original: Vec<Value> = candidates[..count].to_vec();
    for (destination, source) in order.into_iter().enumerate() {
        candidates[destination] = original[source].clone();
    }
    mark_ready(&guard);
    Ok(response.to_string())
}

fn mark_ready(engine: &Option<CachedEngine>) {
    let Some(engine) = engine.as_ref() else {
        update_status("not_loaded", "", "");
        return;
    };
    update_status("ready", "", &engine.backend);
}

fn candidate_text(candidate: &Value) -> Result<String> {
    candidate
        .as_array()
        .context("Candidate is not an array")?
        .iter()
        .map(|part| {
            part.as_str()
                .map(str::to_owned)
                .context("Candidate part is not text")
        })
        .collect()
}

fn ensure_engine<'a>(
    slot: &'a mut Option<CachedEngine>,
    config: &Config<'_>,
    force_cpu: bool,
) -> Result<&'a mut CachedEngine> {
    let backend = if force_cpu { "cpu" } else { "gpu" };
    let library_path = Path::new(config.library_dir).join("liblitert-lm.so");
    let library_path_text = library_path.to_string_lossy().into_owned();
    let reusable = slot.as_ref().is_some_and(|current| {
        current.model_id == config.model_id
            && current.backend == backend
            && current.library_path == library_path_text
    });
    if reusable {
        return Ok(slot.as_mut().unwrap());
    }

    *slot = None;
    update_status("loading", "", backend);
    let api = unsafe { Api::load(&library_path)? };
    CANCEL_FUNCTION.store(api.session_cancel as usize, AtomicOrdering::Release);
    let model = CString::new(config.model_path)?;
    let backend_c = CString::new(backend)?;
    let cache = CString::new(config.cache_dir)?;
    let settings = unsafe {
        (api.settings_create)(model.as_ptr(), backend_c.as_ptr(), ptr::null(), ptr::null())
    };
    if settings.is_null() {
        anyhow::bail!("LiteRT-LM rejected {backend} engine settings");
    }
    unsafe {
        (api.settings_set_max_tokens)(settings, MAX_CONTEXT_TOKENS);
        (api.settings_set_num_threads)(settings, config.cpu_threads.max(1));
        (api.settings_set_parallel_loading)(settings, true);
        (api.settings_set_cache_dir)(settings, cache.as_ptr());
        (api.settings_set_ringbuffer)(settings, true);
    }
    let engine = unsafe { (api.engine_create)(settings) };
    unsafe { (api.settings_delete)(settings) };
    if engine.is_null() {
        anyhow::bail!("LiteRT-LM could not initialize the {backend} backend");
    }
    *slot = Some(CachedEngine {
        api,
        engine,
        model_id: config.model_id.to_owned(),
        library_path: library_path_text,
        backend: backend.to_owned(),
    });
    update_status("ready", "", backend);
    Ok(slot.as_mut().unwrap())
}

fn score(
    slot: &mut Option<CachedEngine>,
    config: &Config<'_>,
    texts: &[String],
    force_cpu: bool,
) -> Result<Vec<f32>> {
    let engine = ensure_engine(slot, config, force_cpu)?;
    update_status("ranking", "", &engine.backend);
    let prefix_len = shared_prefix_boundary(texts);
    let prefix = &texts[0][..prefix_len];
    let prefix_input =
        unsafe { (engine.api.input_create)(0, prefix.as_ptr().cast(), prefix.len()) };
    if prefix_input.is_null() {
        anyhow::bail!("LiteRT-LM could not create the shared-prefix input");
    }
    let session_config = unsafe { (engine.api.session_config_create)() };
    if session_config.is_null() {
        unsafe { (engine.api.input_delete)(prefix_input) };
        anyhow::bail!("LiteRT-LM could not create a scoring session config");
    }
    unsafe { (engine.api.session_config_set_apply_template)(session_config, false) };
    let session = unsafe { (engine.api.session_create)(engine.engine, session_config) };
    unsafe { (engine.api.session_config_delete)(session_config) };
    if session.is_null() {
        unsafe { (engine.api.input_delete)(prefix_input) };
        anyhow::bail!("LiteRT-LM could not create a scoring session");
    }
    let cancelled_before_start = {
        let _lifetime = ACTIVE_SESSION_LIFETIME
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if cancellation_epoch() != config.cancellation_epoch {
            true
        } else {
            ACTIVE_SESSION.store(session, AtomicOrdering::Release);
            false
        }
    };
    if cancelled_before_start {
        unsafe {
            (engine.api.input_delete)(prefix_input);
            (engine.api.session_delete)(session);
        }
        anyhow::bail!("LiteRT-LM scoring request was superseded");
    }

    let result = (|| {
        let inputs = [prefix_input as *const c_void];
        let prefill_status = unsafe { (engine.api.run_prefill)(session, inputs.as_ptr(), 1) };
        if prefill_status != 0 {
            anyhow::bail!("LiteRT-LM shared-prefix prefill failed ({prefill_status})");
        }
        let suffixes = texts
            .iter()
            .map(|text| CString::new(&text[prefix_len..]))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let suffix_ptrs: Vec<*const c_char> = suffixes.iter().map(|value| value.as_ptr()).collect();
        let responses = unsafe {
            (engine.api.run_scoring)(session, suffix_ptrs.as_ptr(), suffix_ptrs.len(), true)
        };
        if responses.is_null() {
            anyhow::bail!("LiteRT-LM batched text scoring returned no response");
        }
        let scores_result = (|| {
            let count = unsafe { (engine.api.responses_count)(responses) };
            if count as usize != texts.len() {
                anyhow::bail!(
                    "LiteRT-LM returned {count} scores for {} candidates",
                    texts.len()
                );
            }
            let mut scores = Vec::with_capacity(texts.len());
            for index in 0..count {
                let has_score = unsafe { (engine.api.responses_has_score)(responses, index) };
                let has_length =
                    unsafe { (engine.api.responses_has_token_length)(responses, index) };
                if !has_score || !has_length {
                    anyhow::bail!("LiteRT-LM omitted score metadata for candidate {index}");
                }
                let total = unsafe { (engine.api.responses_score)(responses, index) };
                let tokens = unsafe { (engine.api.responses_token_length)(responses, index) };
                if !total.is_finite() || tokens <= 0 {
                    anyhow::bail!("LiteRT-LM returned an invalid score for candidate {index}");
                }
                scores.push(total / tokens as f32);
            }
            Ok(scores)
        })();
        unsafe { (engine.api.responses_delete)(responses) };
        scores_result
    })();

    {
        let _lifetime = ACTIVE_SESSION_LIFETIME
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        ACTIVE_SESSION.store(ptr::null_mut(), AtomicOrdering::Release);
    }
    unsafe {
        (engine.api.input_delete)(prefix_input);
        (engine.api.session_delete)(session);
    }
    result
}

fn shared_prefix_boundary(texts: &[String]) -> usize {
    let first = match texts.first() {
        Some(value) => value,
        None => return 0,
    };
    let mut matched = 0;
    for (offset, character) in first.char_indices() {
        if texts[1..]
            .iter()
            .all(|candidate| candidate[offset..].starts_with(character))
        {
            matched = offset + character.len_utf8();
        } else {
            break;
        }
    }
    first[..matched]
        .char_indices()
        .filter_map(|(offset, character)| {
            character
                .is_whitespace()
                .then_some(offset + character.len_utf8())
        })
        .last()
        .unwrap_or(0)
}

pub fn record_error(error: &anyhow::Error) {
    let backend = status()
        .lock()
        .ok()
        .map(|value| value.backend.clone())
        .unwrap_or_default();
    update_status("error", &error.to_string(), &backend);
}

#[cfg(test)]
mod tests {
    use super::shared_prefix_boundary;

    #[test]
    fn shared_prefix_stops_at_complete_word() {
        let values = vec!["xin chào bạn".to_owned(), "xin chào tôi".to_owned()];
        assert_eq!(&values[0][..shared_prefix_boundary(&values)], "xin chào ");
    }

    #[test]
    fn shared_prefix_never_splits_utf8_or_word() {
        let values = vec!["đúng rồi".to_owned(), "đừng đi".to_owned()];
        assert_eq!(shared_prefix_boundary(&values), 0);
    }
}
