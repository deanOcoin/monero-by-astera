use crate::{Connection, Result};
use reqwest::{blocking::Client, redirect::Policy, Proxy};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_RESPONSE: u64 = 128 * 1024;

// This probes public node metadata only. No wallet, address or key is required.
pub fn check(c: &Connection, direct_confirmed: bool, vpn_confirmed: bool) -> Result<Value> {
    c.validate()?;
    if c.mode == "offline" {
        return Err(
            "Offline mode does not contact a node. Choose a connection to check it.".into(),
        );
    }
    if c.mode == "remote" && !direct_confirmed {
        return Err(
            "Review and accept the direct-connection notice before checking this node.".into(),
        );
    }
    if c.mode == "vpn" && !vpn_confirmed {
        return Err(
            "Connect your trusted VPN and enable its kill switch, then confirm before checking."
                .into(),
        );
    }
    if c.mode == "tor" {
        crate::tor::require_proxy(&c.proxy)?;
    }
    let client = client(c)?;
    check_using(c, &client)
}

fn client(c: &Connection) -> Result<Client> {
    let tor = c.mode == "tor";
    let mut builder = Client::builder()
        .no_proxy()
        .tls_info(true)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(if tor { 20 } else { 8 }))
        .timeout(Duration::from_secs(if tor { 30 } else { 15 }));
    if c.mode == "tor" {
        // socks5h delegates hostname resolution to Tor. Never resolve onion names locally.
        builder = builder.proxy(
            Proxy::all(format!("socks5h://{}", c.proxy)).map_err(|_| "Invalid local Tor proxy")?,
        );
    }
    builder
        .build()
        .map_err(|_| "Could not initialize the node connection check".into())
}

fn check_using(c: &Connection, client: &Client) -> Result<Value> {
    let response = client.get(format!("{}/get_info", c.node.trim_end_matches('/')))
        .send().map_err(|e| {
            if c.mode == "tor" {
                "The local proxy responded, but this onion node could not be reached. Tor may still be connecting or the node may be down. Wait and retry, or check another onion node. No direct fallback occurred.".to_string()
            } else if e.is_timeout() {
                "The node did not respond within 15 seconds. Retry or choose another node.".to_string()
            } else if ["local", "trusted-local"].contains(&c.mode.as_str()) {
                "No local node responded. Start your synced monerod, or choose a remote connection.".to_string()
            } else {
                "Could not establish a verified HTTPS connection. Check your internet/VPN or choose another node. Certificate checks remain enabled.".to_string()
            }
        })?;
    if !response.status().is_success() {
        return Err(format!("Node returned HTTP {}. It may be unavailable, restricted or redirecting; try another node.", response.status().as_u16()));
    }
    let fingerprint = if c.node.starts_with("https:") {
        let certificate = response
            .extensions()
            .get::<reqwest::tls::TlsInfo>()
            .and_then(|info| info.peer_certificate())
            .ok_or("Could not obtain the verified node certificate. Choose another node.")?;
        Some(format!("{:x}", Sha256::digest(certificate)))
    } else {
        None
    };
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The node response was interrupted. Retry or choose another node.")?;
    let mut result = parse(&bytes, &c.network)?;
    result["node"] = json!(c.node);
    result["route"] = json!(c.mode);
    result["certificateSha256"] = json!(fingerprint);
    result["checkedAt"] = json!(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs());
    Ok(result)
}

fn parse(bytes: &[u8], network: &str) -> Result<Value> {
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("Node response exceeded the safe size limit. Choose another node.".into());
    }
    let info: Value = serde_json::from_slice(bytes).map_err(|_| {
        "This endpoint did not return Monero node information. Check its URL and port."
    })?;
    if info["status"] != "OK" {
        return Err(
            "The node reports it is busy or unavailable. Retry or choose another node.".into(),
        );
    }
    if info["nettype"].as_str() != Some(network) {
        return Err(format!("This node is not reporting the selected {network} network. Choose a matching node; your wallet network has not changed."));
    }
    let height = info["height"]
        .as_u64()
        .filter(|h| *h > 0)
        .ok_or("Node reported an invalid chain height. Choose another node.")?;
    let target = info["target_height"].as_u64().unwrap_or(0);
    let ready = info["synchronized"] == true && info["offline"] == false && target <= height;
    Ok(
        json!({"network":network,"height":height,"targetHeight":target,"ready":ready,
        "message":if ready { "Node is reachable and reports it is synced. This does not verify the operator's honesty or scan your wallet." }
            else { "Node is reachable but is still syncing or offline. Try another node for current balances." }}),
    )
}

// Fixed, reviewable candidates. They are never offered in the UI until live checks pass.
const HTTPS_CANDIDATES: &[(&str, &str)] = &[
    ("OpenInternet", "https://monero.openinternet.io"),
    ("Cake Wallet", "https://xmr-node.cakewallet.com:18081"),
    ("Monero.fail", "https://node.monero.fail"),
    ("Seth for Privacy", "https://node.sethforprivacy.com"),
];
const TOR_CANDIDATES: &[(&str, &str)] = &[
    (
        "Plowsof",
        "http://plowsof3t5hogddwabaeiyrno25efmzfxyro2vligremt7sxpsclfaid.onion:18089",
    ),
    (
        "Rucknium",
        "http://rucknium757bokwv3ss35ftgc3gzb7hgbvvglbg3hisp7tsj2fkd2nyd.onion:18081",
    ),
    (
        "StormyCloud",
        "http://a6orjo6aiotog3njppja5jwnd3rexzfjiejxnojvw74p3kma45fundid.onion:18089",
    ),
    (
        "Boldsuck",
        "http://ip4zpbps7unk6xhlanqtw24f75akfbl3upeckfjqjks7ftfnk4i73oid.onion:18081",
    ),
];
fn fee_usable(bytes: &[u8]) -> bool {
    if bytes.len() as u64 > MAX_RESPONSE {
        return false;
    }
    let Ok(v) = serde_json::from_slice::<Value>(bytes) else {
        return false;
    };
    v["error"].is_null()
        && v["result"]["status"] == "OK"
        && (v["result"]["fee"].as_u64().is_some_and(|f| f > 0)
            || v["result"]["fees"].as_array().is_some_and(|fees| {
                !fees.is_empty() && fees.iter().all(|f| f.as_u64().is_some_and(|f| f > 0))
            }))
}
pub fn discover(
    c: &Connection,
    direct: bool,
    vpn: bool,
    control: &crate::Control,
    epoch: u64,
) -> Result<Value> {
    if c.network != "mainnet" {
        return Err(
            "The checked node list is for mainnet only. Use a custom test-network node.".into(),
        );
    }
    if !["remote", "vpn", "tor"].contains(&c.mode.as_str()) {
        return Err("Choose HTTPS, VPN or Tor to find public nodes.".into());
    }
    if c.mode == "remote" && !direct {
        return Err("Accept the direct-connection notice before checking public nodes.".into());
    }
    if c.mode == "vpn" && !vpn {
        return Err("Confirm your VPN and kill switch before checking public nodes.".into());
    }
    let candidates = if c.mode == "tor" {
        TOR_CANDIDATES
    } else {
        HTTPS_CANDIDATES
    };
    let mut check_config = c.clone();
    check_config.node = candidates[0].1.into();
    check_config.validate()?;
    if c.mode == "tor" {
        crate::tor::require_proxy(&c.proxy)?;
    }
    let client = client(&check_config)?;
    let mut results = Vec::new();
    for chunk in candidates.chunks(3) {
        if control.epoch() != epoch {
            return Err("Node discovery canceled".into());
        }
        let checked = std::thread::scope(|scope| {
            let jobs: Vec<_> = chunk.iter().map(|(name,url)| {
                let mut config = c.clone(); config.node=(*url).into(); let client=client.clone();
                scope.spawn(move || -> Option<Value> {
                    let start=std::time::Instant::now();
                    config.validate().ok()?;
                    let mut result=check_using(&config,&client).ok()?;
                    if result["ready"]!=true {return None;}
                    let response=client.post(format!("{url}/json_rpc")).timeout(Duration::from_secs(if config.mode == "tor" { 15 } else { 8 })).json(&json!({"jsonrpc":"2.0","id":"check","method":"get_fee_estimate","params":{"grace_blocks":10}})).send().ok()?;
                    if !response.status().is_success() {return None;}
                    let mut bytes=Vec::new();response.take(MAX_RESPONSE+1).read_to_end(&mut bytes).ok()?;
                    if !fee_usable(&bytes) {return None;}
                    result["name"]=json!(name);result["latencyMs"]=json!(start.elapsed().as_millis());Some(result)
                })
            }).collect();
            jobs.into_iter()
                .filter_map(|j| j.join().ok().flatten())
                .collect::<Vec<_>>()
        });
        results.extend(checked);
    }
    if control.epoch() != epoch {
        return Err("Node discovery canceled".into());
    }
    results.sort_by_key(|r| r["latencyMs"].as_u64().unwrap_or(u64::MAX));
    Ok(json!({"nodes":results,"tested":candidates.len(),"route":c.mode,"expiresIn":120}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener};
    fn info() -> Value {
        json!({"status":"OK","nettype":"mainnet","height":42,"target_height":0,"synchronized":true,"offline":false})
    }
    #[test]
    fn discovery_requires_useful_fee_response_and_valid_candidates() {
        assert!(fee_usable(br#"{"result":{"status":"OK","fee":20000}}"#));
        assert!(!fee_usable(
            br#"{"error":{"code":-1},"result":{"status":"OK","fee":20000}}"#
        ));
        assert!(!fee_usable(
            br#"{"result":{"status":"PAYMENT REQUIRED","fee":20000}}"#
        ));
        for (mode, candidates) in [("remote", HTTPS_CANDIDATES), ("tor", TOR_CANDIDATES)] {
            for (_, url) in candidates {
                Connection {
                    mode: mode.into(),
                    node: (*url).into(),
                    ..Connection::default()
                }
                .validate()
                .unwrap();
            }
        }
    }
    #[test]
    fn distinguishes_ready_syncing_wrong_network_and_invalid_responses() {
        let mut i = info();
        assert_eq!(
            parse(i.to_string().as_bytes(), "mainnet").unwrap()["ready"],
            true
        );
        i["synchronized"] = json!(false);
        assert_eq!(
            parse(i.to_string().as_bytes(), "mainnet").unwrap()["ready"],
            false
        );
        assert!(parse(i.to_string().as_bytes(), "stagenet").is_err());
        assert!(parse(b"<html>not a node</html>", "mainnet").is_err());
        assert!(parse(&vec![b' '; MAX_RESPONSE as usize + 1], "mainnet").is_err());
    }
    #[test]
    fn direct_and_vpn_probes_require_explicit_consent() {
        let mut c = Connection {
            mode: "remote".into(),
            node: "https://127.0.0.1:1".into(),
            ..Connection::default()
        };
        assert!(check(&c, false, true).unwrap_err().contains("accept"));
        c.mode = "vpn".into();
        assert!(check(&c, true, false).unwrap_err().contains("confirm"));
    }
    #[test]
    fn local_probe_reads_metadata_and_refuses_redirects() {
        for redirect in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let c = Connection {
                node: format!("http://{}", listener.local_addr().unwrap()),
                ..Connection::default()
            };
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut buffer = [0; 2048];
                let received = socket.read(&mut buffer).unwrap();
                assert!(received > 0);
                let body = info().to_string();
                let response = if redirect {
                    "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/get_info\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
                } else {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                };
                socket.write_all(response.as_bytes()).unwrap();
            });
            let result = check(&c, false, false);
            if redirect {
                assert!(result.unwrap_err().contains("HTTP 302"));
            } else {
                assert_eq!(result.unwrap()["height"], 42);
            }
            server.join().unwrap();
        }
    }
    #[test]
    fn tor_probe_sends_hostname_to_socks_and_fails_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy = listener.local_addr().unwrap().to_string();
        let hostname = format!("{}.onion", "a".repeat(56));
        let expected = hostname.clone();
        let server = std::thread::spawn(move || {
            // First connection is the local-only diagnostic preflight.
            let (mut diagnostic, _) = listener.accept().unwrap();
            diagnostic
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut hello = [0; 3];
            diagnostic.read_exact(&mut hello).unwrap();
            assert_eq!(hello, [5, 1, 0]);
            diagnostic.write_all(&[5, 0]).unwrap();
            let mut extra = [0; 1];
            assert_eq!(diagnostic.read(&mut extra).unwrap(), 0);
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut greeting = [0; 2];
            s.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting[0], 5);
            let mut methods = vec![0; greeting[1] as usize];
            s.read_exact(&mut methods).unwrap();
            s.write_all(&[5, 0]).unwrap();
            let mut connect = [0; 5];
            s.read_exact(&mut connect).unwrap();
            assert_eq!(&connect[..4], &[5, 1, 0, 3]);
            let mut host = vec![0; connect[4] as usize];
            s.read_exact(&mut host).unwrap();
            assert_eq!(String::from_utf8(host).unwrap(), expected);
            s.write_all(&[5, 1, 0, 1, 0, 0, 0, 0, 0, 0]).unwrap();
        });
        let c = Connection {
            mode: "tor".into(),
            node: format!("http://{hostname}"),
            proxy,
            ..Connection::default()
        };
        assert!(check(&c, false, false)
            .unwrap_err()
            .contains("No direct fallback"));
        server.join().unwrap();
    }
}
