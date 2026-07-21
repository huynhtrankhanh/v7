use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let kenlm_root = env::var_os("KENLM_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(manifest_dir).join("../kenlm"));

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        build_android_kenlm(&kenlm_root);
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
        .cargo_metadata(false)
        .compile("wrapper");
    let wrapper_archive = PathBuf::from(env::var("OUT_DIR").unwrap()).join("libwrapper.a");
    // This package also has an Android-only library target, so Cargo applies
    // rustc-link-lib directives to that library rather than the host binary.
    // Pass the host archives to the binary explicitly and keep their order:
    // Rust objects -> wrapper -> KenLM -> utility/system dependencies.
    println!("cargo:rustc-link-arg-bin=inference-rs=-Wl,--start-group");
    println!(
        "cargo:rustc-link-arg-bin=inference-rs={}",
        wrapper_archive.display()
    );
    println!(
        "cargo:rustc-link-arg-bin=inference-rs={}",
        kenlm_build_lib.join("libkenlm.a").display()
    );
    println!(
        "cargo:rustc-link-arg-bin=inference-rs={}",
        kenlm_build_lib.join("libkenlm_util.a").display()
    );
    println!("cargo:rustc-link-arg-bin=inference-rs=-Wl,--end-group");
    for library in ["stdc++", "pthread", "z", "bz2", "lzma", "dl"] {
        println!("cargo:rustc-link-arg-bin=inference-rs=-l{library}");
    }

    // Re-run if wrapper sources change.
    println!("cargo:rerun-if-changed=cpp/wrapper.cc");
    println!("cargo:rerun-if-changed=cpp/wrapper.h");
}

fn build_android_kenlm(kenlm_root: &PathBuf) {
    let lm_sources = [
        "lm/bhiksha.cc",
        "lm/binary_format.cc",
        "lm/config.cc",
        "lm/lm_exception.cc",
        "lm/model.cc",
        "lm/quantize.cc",
        "lm/read_arpa.cc",
        "lm/search_hashed.cc",
        "lm/search_trie.cc",
        "lm/sizes.cc",
        "lm/trie.cc",
        "lm/trie_sort.cc",
        "lm/value_build.cc",
        "lm/virtual_interface.cc",
        "lm/vocab.cc",
    ];
    let util_sources = [
        "util/bit_packing.cc",
        "util/ersatz_progress.cc",
        "util/exception.cc",
        "util/file.cc",
        "util/file_piece.cc",
        "util/float_to_string.cc",
        "util/integer_to_string.cc",
        "util/mmap.cc",
        "util/murmur_hash.cc",
        "util/parallel_read.cc",
        "util/pool.cc",
        "util/read_compressed.cc",
        "util/scoped.cc",
        "util/spaces.cc",
        "util/string_piece.cc",
        "util/usage.cc",
        "util/double-conversion/bignum-dtoa.cc",
        "util/double-conversion/bignum.cc",
        "util/double-conversion/cached-powers.cc",
        "util/double-conversion/fast-dtoa.cc",
        "util/double-conversion/fixed-dtoa.cc",
        "util/double-conversion/strtod.cc",
        "util/double-conversion/double-to-string.cc",
        "util/double-conversion/string-to-double.cc",
    ];

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .include(kenlm_root)
        .include("cpp")
        .flag("-std=c++11")
        .flag("-O3")
        .flag("-fexceptions")
        .flag("-frtti")
        .flag_if_supported("-Wno-deprecated-declarations")
        .flag_if_supported("-Wno-non-c-typedef-for-linkage")
        .define("KENLM_MAX_ORDER", "6")
        .define("HAVE_CLOCK_GETTIME", None)
        .file("cpp/wrapper.cc");
    for source in lm_sources.iter().chain(util_sources.iter()) {
        build.file(kenlm_root.join(source));
    }
    build.compile("kenlm_android");

    println!("cargo:rustc-link-lib=dylib=c++_shared");
    println!("cargo:rustc-link-lib=dylib=log");
    println!("cargo:rustc-link-lib=dylib=android");
    println!("cargo:rerun-if-env-changed=KENLM_ROOT");
    println!("cargo:rerun-if-changed=cpp/wrapper.cc");
    println!("cargo:rerun-if-changed=cpp/wrapper.h");
    for source in lm_sources.iter().chain(util_sources.iter()) {
        println!(
            "cargo:rerun-if-changed={}",
            kenlm_root.join(source).display()
        );
    }
}
