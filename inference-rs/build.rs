use std::env;
use std::path::PathBuf;

fn main() {
    // If mock feature is enabled, skip KenLM build
    if env::var("CARGO_FEATURE_MOCK").is_ok() {
        println!("cargo:warning=Mock feature enabled, skipping KenLM build.");
        return;
    }

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let kenlm_root = PathBuf::from(manifest_dir).join("../kenlm");

    if !kenlm_root.exists() {
        println!("cargo:warning=KenLM directory not found at {:?}. Skipping C++ build (assuming mock or broken env).", kenlm_root);
        // We can't actually compile without KenLM unless we are in mock mode, but maybe the user wants to force it?
        // If we return here without doing anything, the build will fail later if code tries to link symbols.
        // But if we are in mock mode (which we are not, if we reached here), we expect KenLM.
        // However, to allow 'cargo check' to pass in envs without kenlm, we might just warn.
        // But 'cargo build' will fail.
        // For this task, we will rely on the user running with --features mock.
        return;
    }

    let kenlm_build_lib = kenlm_root.join("build/lib");

    // Compile wrapper
    cc::Build::new()
        .cpp(true)
        .file("cpp/wrapper.cc")
        .include(&kenlm_root)
        .flag("-std=c++11")
        .flag("-O3")
        .define("KENLM_MAX_ORDER", "6")
        .compile("wrapper");

    // Link KenLM libraries
    println!("cargo:rustc-link-search=native={}", kenlm_build_lib.display());
    println!("cargo:rustc-link-lib=static=kenlm");
    println!("cargo:rustc-link-lib=static=kenlm_util");

    // Link system libraries
    // Note: order matters for static linking sometimes, but here we use dylib for system ones
    println!("cargo:rustc-link-lib=dylib=stdc++");
    println!("cargo:rustc-link-lib=dylib=pthread");
    println!("cargo:rustc-link-lib=dylib=z");
    println!("cargo:rustc-link-lib=dylib=bz2");
    println!("cargo:rustc-link-lib=dylib=lzma");
    println!("cargo:rustc-link-lib=dylib=dl");

    // Re-run if these change
    println!("cargo:rerun-if-changed=cpp/wrapper.cc");
    println!("cargo:rerun-if-changed=cpp/wrapper.h");
}
