#![cfg(target_os = "android")]

#[path = "main.rs"]
mod inference;

use inference::EmbeddedInference;
use jni::objects::{JClass, JString};
use jni::sys::{jint, jstring};
use jni::JNIEnv;
use std::ptr;
use std::sync::{Mutex, OnceLock};

struct CachedInference {
    model_id: String,
    dictionary_id: String,
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
    dictionary_id: JString,
    dictionary_source: JString,
    request_body: JString,
) -> jstring {
    let result = (|| -> anyhow::Result<String> {
        // -1 reuses the already loaded model; own real descriptors even on error.
        let model_fd = (model_fd >= 0).then(|| OwnedFd(model_fd));
        let model_id = java_string(&mut env, &model_id)?;
        let dictionary_id = java_string(&mut env, &dictionary_id)?;
        let request_body = java_string(&mut env, &request_body)?;
        let cache = INFERENCE.get_or_init(|| Mutex::new(None));
        let mut guard = cache
            .lock()
            .map_err(|_| anyhow::anyhow!("The inference engine lock was poisoned"))?;

        let needs_load = guard
            .as_ref()
            .map(|cached| cached.model_id != model_id)
            .unwrap_or(true);
        if needs_load {
            let model_fd = model_fd
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("The selected language model is not loaded"))?;
            let mut engine = EmbeddedInference::from_fd(model_fd.0, &model_id).map_err(|error| {
                anyhow::anyhow!(
                    "Unable to memory-map the selected lm.binary file. The document provider must expose a seekable, mappable descriptor; the model is not copied: {error}"
                )
            })?;
            if !dictionary_id.is_empty() && dictionary_id != "__unchanged__" {
                let source = java_string(&mut env, &dictionary_source)?;
                engine.set_lexical_dictionary(Some(&source));
            }
            *guard = Some(CachedInference {
                model_id,
                dictionary_id: if dictionary_id == "__unchanged__" {
                    String::new()
                } else {
                    dictionary_id
                },
                engine,
            });
        } else if dictionary_id != "__unchanged__"
            && guard.as_ref().map(|cached| cached.dictionary_id.as_str())
                != Some(dictionary_id.as_str())
        {
            let cached = guard.as_mut().expect("inference cache was initialized");
            // Do not copy the Java dictionary string on cache hits. It can be
            // many megabytes, even though the request itself is only a few bytes.
            let source = if dictionary_id.is_empty() {
                None
            } else {
                Some(java_string(&mut env, &dictionary_source)?)
            };
            cached.engine.set_lexical_dictionary(source.as_deref());
            cached.dictionary_id = dictionary_id;
        }

        guard
            .as_ref()
            .expect("inference cache was initialized")
            .engine
            .infer_json(&request_body)
    })();
    return_string(&mut env, result)
}
