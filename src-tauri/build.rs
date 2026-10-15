fn main() {
    let dir = "vendor/polyseed";
    let mut build = cc::Build::new();
    build
        .include(format!("{dir}/include"))
        .define("POLYSEED_STATIC", None)
        .std("c11");
    for entry in std::fs::read_dir(format!("{dir}/src")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|s| s == "c") {
            build.file(path);
        }
    }
    build.compile("polyseed");
    println!("cargo:rerun-if-changed=vendor/polyseed");
    tauri_build::build();
}
