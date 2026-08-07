#![cfg(target_os = "android")]

#[path = "main.rs"]
mod inference;
mod litert_reranker;

use inference::EmbeddedInference;
use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jint, jstring};
use jni::JNIEnv;
use litert_reranker::Config;
use std::ptr;
use std::sync::{Mutex, OnceLock};

struct CachedInference {
    model_id: String,
    engine: EmbeddedInference,
}

static INFERENCE: OnceLock<Mutex<Option<CachedInference>>> = OnceLock::new();

struct OwnedFd(jint);

impl Drop for OwnedFd {
    fn drop(&mut self) {
        unsafe { libc::close(self.0) };
    }
}

fn java_string(env: &mut JNIEnv<'_>, value: &JString<'_>) -> anyhow::Result<String> {
    Ok(env.get_string(value)?.into())
}

fn return_string(env: &mut JNIEnv<'_>, result: anyhow::Result<String>) -> jstring {
    match result {
        Ok(response) => match env.new_string(response) {
            Ok(value) => value.into_raw(),
            Err(error) => {
                let _ = env.throw_new(
                    "java/lang/RuntimeException",
                    format!("Unable to return native result: {error}"),
                );
                ptr::null_mut()
            }
        },
        Err(error) => {
            let _ = env.throw_new("java/lang/RuntimeException", error.to_string());
            ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_huynhtrankhanh_v7ime_NativeInference_inferNative(
    mut env: JNIEnv,
    _class: JClass,
    model_fd: jint,
    model_id: JString,
    request_body: JString,
    reranker_enabled: jboolean,
    reranker_model_path: JString,
    reranker_model_id: JString,
    reranker_cache_dir: JString,
    native_library_dir: JString,
    reranker_top_k: jint,
    cpu_threads: jint,
) -> jstring {
    let result = (|| -> anyhow::Result<String> {
        if model_fd < 0 {
            anyhow::bail!("The selected language model could not be opened");
        }
        let model_fd = OwnedFd(model_fd);
        let model_id = java_string(&mut env, &model_id)?;
        let request_body = java_string(&mut env, &request_body)?;
        let reranker_model_path = java_string(&mut env, &reranker_model_path)?;
        let reranker_model_id = java_string(&mut env, &reranker_model_id)?;
        let reranker_cache_dir = java_string(&mut env, &reranker_cache_dir)?;
        let native_library_dir = java_string(&mut env, &native_library_dir)?;
        let reranker_epoch = litert_reranker::cancellation_epoch();
        let cache = INFERENCE.get_or_init(|| Mutex::new(None));
        let mut guard = cache
            .lock()
            .map_err(|_| anyhow::anyhow!("The inference engine lock was poisoned"))?;

        let needs_load = guard
            .as_ref()
            .map(|cached| cached.model_id != model_id)
            .unwrap_or(true);
        if needs_load {
            let engine = EmbeddedInference::from_fd(model_fd.0, &model_id).map_err(|error| {
                anyhow::anyhow!(
                    "Unable to memory-map the selected lm.binary file. The document provider must expose a seekable, mappable descriptor; the model is not copied: {error}"
                )
            })?;
            *guard = Some(CachedInference { model_id, engine });
        }

        let response = guard
            .as_ref()
            .expect("inference cache was initialized")
            .engine
            .infer_json(&request_body)?;
        let config = Config {
            enabled: reranker_enabled != 0 && !reranker_model_path.is_empty(),
            model_path: &reranker_model_path,
            model_id: &reranker_model_id,
            cache_dir: &reranker_cache_dir,
            library_dir: &native_library_dir,
            top_k: reranker_top_k.max(2) as usize,
            cpu_threads,
            cancellation_epoch: reranker_epoch,
        };
        match litert_reranker::rerank_json(&response, &config) {
            Ok(reranked) => Ok(reranked),
            Err(error) => {
                // Experimental scoring is fail-open: KenLM remains usable.
                litert_reranker::record_error(&error);
                Ok(response)
            }
        }
    })();
    return_string(&mut env, result)
}

#[no_mangle]
pub extern "system" fn Java_com_huynhtrankhanh_v7ime_NativeInference_preloadRerankerNative(
    mut env: JNIEnv,
    _class: JClass,
    enabled: jboolean,
    model_path: JString,
    model_id: JString,
    cache_dir: JString,
    native_library_dir: JString,
    top_k: jint,
    cpu_threads: jint,
) {
    let result = (|| -> anyhow::Result<()> {
        let model_path = java_string(&mut env, &model_path)?;
        let model_id = java_string(&mut env, &model_id)?;
        let cache_dir = java_string(&mut env, &cache_dir)?;
        let native_library_dir = java_string(&mut env, &native_library_dir)?;
        let config = Config {
            enabled: enabled != 0 && !model_path.is_empty(),
            model_path: &model_path,
            model_id: &model_id,
            cache_dir: &cache_dir,
            library_dir: &native_library_dir,
            top_k: top_k.max(2) as usize,
            cpu_threads,
            cancellation_epoch: litert_reranker::cancellation_epoch(),
        };
        litert_reranker::preload(&config)
    })();
    if let Err(error) = result {
        litert_reranker::record_error(&error);
    }
}

#[no_mangle]
pub extern "system" fn Java_com_huynhtrankhanh_v7ime_NativeInference_cancelRerankerNative(
    _env: JNIEnv,
    _class: JClass,
) {
    litert_reranker::cancel();
}

#[no_mangle]
pub extern "system" fn Java_com_huynhtrankhanh_v7ime_NativeInference_rerankerStatusNative(
    mut env: JNIEnv,
    _class: JClass,
    enabled: jboolean,
    has_model: jboolean,
) -> jstring {
    return_string(
        &mut env,
        Ok(litert_reranker::status_json(enabled != 0, has_model != 0)),
    )
}
