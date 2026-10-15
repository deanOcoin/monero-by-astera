use super::*;
use rcgen::{CertificateParams, DistinguishedName, KeyPair, PKCS_ECDSA_P384_SHA384};

// These are disposable transport credentials, never wallet keys or server trust anchors.
pub(crate) struct EphemeralTls {
    pub key: PathBuf,
    pub certificate: PathBuf,
}
impl EphemeralTls {
    pub fn create(root: &Path) -> Result<Self> {
        let id = random();
        let files = Self {
            key: root.join(format!("client-{id}.key")),
            certificate: root.join(format!("client-{id}.crt")),
        };
        let key = KeyPair::generate_for(&PKCS_ECDSA_P384_SHA384)
            .map_err(|_| "Could not generate private connection credentials")?;
        let mut params = CertificateParams::default();
        // Match Monero's anonymous subject; do not embed a user, wallet or machine name.
        params.distinguished_name = DistinguishedName::new();
        let certificate = params
            .self_signed(&key)
            .map_err(|_| "Could not prepare private connection certificate")?;
        let pem = Zeroizing::new(key.serialize_pem());
        private_write(&files.key, pem.as_bytes())?;
        private_write(&files.certificate, certificate.pem().as_bytes())?;
        Ok(files)
    }
}
impl Drop for EphemeralTls {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.key);
        let _ = fs::remove_file(&self.certificate);
    }
}
pub(crate) fn temporary_name(name: &str) -> bool {
    name.strip_prefix("client-")
        .and_then(|n| n.strip_suffix(".key").or_else(|| n.strip_suffix(".crt")))
        .is_some_and(|id| id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_identity_files_are_removed_on_next_start() {
        let root = tempfile::tempdir().unwrap();
        let identity = EphemeralTls::create(root.path()).unwrap();
        let key = identity.key.clone();
        let certificate = identity.certificate.clone();
        std::mem::forget(identity); // Model an abrupt exit before Drop runs.
        fs::write(root.path().join("client-main_wallet.keys"), b"unrelated").unwrap();
        let _engine = Engine::new(
            root.path().to_path_buf(),
            PathBuf::from("unused-in-this-test"),
        )
        .unwrap();
        assert!(!key.exists() && !certificate.exists());
        assert!(root.path().join("client-main_wallet.keys").exists());
    }
    #[test]
    fn identities_are_fresh_private_and_cleaned_up() {
        let root = tempfile::tempdir().unwrap();
        let a = EphemeralTls::create(root.path()).unwrap();
        let b = EphemeralTls::create(root.path()).unwrap();
        assert_ne!(
            fs::read(&a.certificate).unwrap(),
            fs::read(&b.certificate).unwrap()
        );
        for p in [&a.key, &a.certificate, &b.key, &b.certificate] {
            assert_eq!(fs::metadata(p).unwrap().permissions().mode() & 0o777, 0o600);
            assert!(temporary_name(p.file_name().unwrap().to_str().unwrap()));
        }
        let paths = [
            a.key.clone(),
            a.certificate.clone(),
            b.key.clone(),
            b.certificate.clone(),
        ];
        drop(a);
        drop(b);
        assert!(paths.iter().all(|p| !p.exists()));
        assert!(!temporary_name("client-main_wallet.keys"));
        assert!(!temporary_name("client-invalid.key"));
    }
}
