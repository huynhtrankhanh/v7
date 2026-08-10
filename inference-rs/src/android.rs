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
) -> jstring {
    let result = (|| -> anyhow::Result<String> {
        if model_fd < 0 {
            anyhow::bail!("The selected language model could not be opened");
        }
        let model_fd = OwnedFd(model_fd);
        let model_id = java_string(&mut env, &model_id)?;
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
            let engine = EmbeddedInference::from_fd(model_fd.0, &model_id).map_err(|error| {
                anyhow::anyhow!(
                    "Unable to memory-map the selected lm.binary file. The document provider must expose a seekable, mappable descriptor; the model is not copied: {error}"
                )
            })?;
            *guard = Some(CachedInference { model_id, engine });
        }

        guard
            .as_ref()
            .expect("inference cache was initialized")
            .engine
            .infer_json(&request_body)
    })();
    return_string(&mut env, result)
}
