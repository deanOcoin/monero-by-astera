//! Thin binding to the unmodified vendored Polyseed library; crypto and Unicode come from Rust crates.
use curve25519_dalek::scalar::Scalar;
use monero::{Address, Network, PrivateKey, PublicKey};
use rand::{rngs::OsRng, RngCore};
use sha3::{Digest, Keccak256};
use std::{
    ffi::{c_char, c_void, CStr},
    sync::Once,
};
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};
#[repr(C)]
struct Dependencies {
    random: unsafe extern "C" fn(*mut c_void, usize),
    pbkdf2: unsafe extern "C" fn(*const u8, usize, *const u8, usize, u64, *mut u8, usize),
    zero: unsafe extern "C" fn(*mut c_void, usize),
    nfc: unsafe extern "C" fn(*const c_char, *mut c_char) -> usize,
    nfkd: unsafe extern "C" fn(*const c_char, *mut c_char) -> usize,
    time: Option<unsafe extern "C" fn() -> u64>,
    alloc: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
    free: Option<unsafe extern "C" fn(*mut c_void)>,
}
unsafe extern "C" fn random(p: *mut c_void, n: usize) {
    OsRng.fill_bytes(std::slice::from_raw_parts_mut(p.cast::<u8>(), n));
}
unsafe extern "C" fn pbkdf2(
    p: *const u8,
    pn: usize,
    s: *const u8,
    sn: usize,
    i: u64,
    k: *mut u8,
    kn: usize,
) {
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
        std::slice::from_raw_parts(p, pn),
        std::slice::from_raw_parts(s, sn),
        i as u32,
        std::slice::from_raw_parts_mut(k, kn),
    );
}
unsafe extern "C" fn zero(p: *mut c_void, n: usize) {
    std::slice::from_raw_parts_mut(p.cast::<u8>(), n).zeroize();
}
unsafe fn normalize(p: *const c_char, o: *mut c_char, compose: bool) -> usize {
    let source = CStr::from_ptr(p).to_str().unwrap_or("");
    let normalized = Zeroizing::new(if compose {
        source.nfc().collect::<String>()
    } else {
        source.nfkd().collect::<String>()
    });
    // Caller prevalidates normalized lengths. Fail closed if upstream ever supplies an oversized string.
    if normalized.len() >= 576 {
        *o = 0;
        return 0;
    }
    std::ptr::copy_nonoverlapping(normalized.as_ptr(), o.cast::<u8>(), normalized.len());
    *o.add(normalized.len()) = 0;
    normalized.len()
}
unsafe extern "C" fn nfc(p: *const c_char, o: *mut c_char) -> usize {
    normalize(p, o, true)
}
unsafe extern "C" fn nfkd(p: *const c_char, o: *mut c_char) -> usize {
    normalize(p, o, false)
}
extern "C" {
    fn polyseed_inject(d: *const Dependencies);
    fn polyseed_decode(
        s: *const c_char,
        coin: i32,
        lang: *mut *const c_void,
        out: *mut *mut c_void,
    ) -> i32;
    fn polyseed_free(s: *mut c_void);
    fn polyseed_keygen(s: *const c_void, coin: i32, size: usize, key: *mut u8);
    fn polyseed_is_encrypted(s: *const c_void) -> i32;
    fn polyseed_crypt(s: *mut c_void, p: *const c_char);
    fn polyseed_get_birthday(s: *const c_void) -> u64;
}
struct Seed(*mut c_void);
impl Drop for Seed {
    fn drop(&mut self) {
        unsafe { polyseed_free(self.0) }
    }
}
fn c_string(s: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    if s.contains('\0') || s.len() >= 576 || s.nfkd().map(char::len_utf8).sum::<usize>() >= 576 {
        return Err("Polyseed text is too long or invalid".into());
    }
    let mut b = Zeroizing::new(s.as_bytes().to_vec());
    b.push(0);
    Ok(b)
}
pub struct Recovered {
    pub address: String,
    pub spend: Zeroizing<String>,
    pub view: Zeroizing<String>,
    pub birthday: u64,
}
pub fn recover(phrase: &str, passphrase: &str, network: &str) -> Result<Recovered, String> {
    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        polyseed_inject(&Dependencies {
            random,
            pbkdf2,
            zero,
            nfc,
            nfkd,
            time: None,
            alloc: None,
            free: None,
        })
    });
    let phrase = c_string(phrase)?;
    let pass = c_string(passphrase)?;
    let mut ptr = std::ptr::null_mut();
    let code =
        unsafe { polyseed_decode(phrase.as_ptr().cast(), 0, std::ptr::null_mut(), &mut ptr) };
    if code != 0 {
        return Err(format!(
            "Polyseed validation failed (code {code}). Check the words, checksum and language."
        ));
    }
    let seed = Seed(ptr);
    let encrypted = unsafe { polyseed_is_encrypted(seed.0) } != 0;
    if encrypted && passphrase.is_empty() {
        return Err(
            "This Polyseed requires its seed passphrase (separate from the wallet password)".into(),
        );
    }
    if !encrypted && !passphrase.is_empty() {
        return Err("This Polyseed is not encrypted; leave the seed passphrase empty".into());
    }
    if encrypted {
        unsafe { polyseed_crypt(seed.0, pass.as_ptr().cast()) };
    }
    let mut bytes = Zeroizing::new([0u8; 32]);
    unsafe { polyseed_keygen(seed.0, 0, 32, bytes.as_mut_ptr()) };
    let mut spend = PrivateKey::from_scalar(Scalar::from_bytes_mod_order(*bytes));
    let mut view = PrivateKey::from_scalar(Scalar::from_bytes_mod_order(
        Keccak256::digest(spend.as_bytes()).into(),
    ));
    let net = match network {
        "mainnet" => Network::Mainnet,
        "stagenet" => Network::Stagenet,
        "testnet" => Network::Testnet,
        _ => return Err("Invalid network".into()),
    };
    let address = Address::standard(
        net,
        PublicKey::from_private_key(&spend),
        PublicKey::from_private_key(&view),
    )
    .to_string();
    let result = Recovered {
        address,
        spend: Zeroizing::new(spend.to_string()),
        view: Zeroizing::new(view.to_string()),
        birthday: unsafe { polyseed_get_birthday(seed.0) },
    };
    spend.scalar.zeroize();
    view.scalar.zeroize();
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    const PHRASE:&str="raven tail swear infant grief assist regular lamp duck valid someone little harsh puppy airport language";
    #[test]
    fn independent_pbkdf2_and_encrypted_seed_vector() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../docs/polyseed-reference-vector.json"))
                .unwrap();
        let plain = recover(v["phrase"].as_str().unwrap(), "", "mainnet").unwrap();
        assert_eq!(plain.spend.as_str(), v["spend"].as_str().unwrap());
        let recovered = recover(
            v["encrypted_phrase"].as_str().unwrap(),
            v["passphrase"].as_str().unwrap(),
            "mainnet",
        )
        .unwrap();
        assert_eq!(recovered.address, plain.address);
        assert!(recover(v["encrypted_phrase"].as_str().unwrap(), "", "mainnet").is_err());
        assert_ne!(
            recover(
                v["encrypted_phrase"].as_str().unwrap(),
                "wrong password",
                "mainnet"
            )
            .unwrap()
            .address,
            plain.address
        );
    }
    #[test]
    fn upstream_phrase_and_checksum() {
        let first = recover(PHRASE, "", "mainnet").unwrap();
        let abbreviated = recover(
            "rave tail swea infan grie assi regul lamp duck vali some litt hars pupp airp langua",
            "",
            "mainnet",
        )
        .unwrap();
        assert_eq!(first.address, abbreviated.address);
        assert_eq!(first.spend.as_str(), abbreviated.spend.as_str());
        assert!(recover(&PHRASE.replace("raven", "tail"), "", "mainnet").is_err());
        assert!(recover(PHRASE, "unexpected", "mainnet").is_err());
        assert!(recover(&"x".repeat(600), "", "mainnet").is_err());
    }
}
