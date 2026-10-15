use super::*;
use std::collections::BTreeSet;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcePlan {
    #[serde(default)]
    pub indices: Vec<u32>,
    #[serde(default)]
    pub allocation: String,
    #[serde(default)]
    pub shares: Vec<SourceShare>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceShare {
    pub index: u32,
    pub amount: String,
}
pub(crate) struct PreparedPart {
    pub metadata: Zeroizing<String>,
    pub review: Value,
}
impl SourcePlan {
    fn amounts(&self, total: u64) -> Result<Vec<(Option<u32>, u64)>> {
        let unique: BTreeSet<_> = self.indices.iter().copied().collect();
        if unique.len() != self.indices.len() || unique.len() > 16 {
            return Err("Choose up to 16 different source addresses".into());
        }
        match self.allocation.as_str() {
            "" | "auto" => {
                if !self.shares.is_empty() {
                    return Err("Custom amounts require custom allocation".into());
                }
                Ok(vec![(None, total)])
            }
            "equal" | "custom" => {
                if unique.len() < 2 {
                    return Err("A split requires at least two addresses".into());
                }
                if self.allocation == "equal" {
                    if !self.shares.is_empty() || total < unique.len() as u64 {
                        return Err(
                            "Amount is too small to split, or contains unexpected shares".into(),
                        );
                    }
                    Ok(unique
                        .into_iter()
                        .enumerate()
                        .map(|(i, index)| {
                            (
                                Some(index),
                                total / self.indices.len() as u64
                                    + u64::from((i as u64) < total % self.indices.len() as u64),
                            )
                        })
                        .collect())
                } else {
                    let mut seen = BTreeSet::new();
                    let mut sum = 0u64;
                    let mut parts = Vec::new();
                    for share in &self.shares {
                        if !unique.contains(&share.index) || !seen.insert(share.index) {
                            return Err(
                                "Custom amounts must match the selected addresses exactly".into()
                            );
                        }
                        let amount = atomic(&share.amount)?;
                        sum = sum.checked_add(amount).ok_or("Amount overflow")?;
                        parts.push((Some(share.index), amount));
                    }
                    if seen != unique || sum != total {
                        return Err("Custom amounts must add up to the payment amount".into());
                    }
                    parts.sort_by_key(|p| p.0);
                    Ok(parts)
                }
            }
            _ => Err("Unknown source allocation".into()),
        }
    }
}

impl Engine {
    pub fn prepare_with_sources(
        &mut self,
        address: &str,
        amount: &str,
        priority: u32,
        plan: SourcePlan,
    ) -> Result<Value> {
        self.unlocked()?;
        self.pending = None;
        self.multisig_ready()?;
        if !self.backup {
            return Err("Verify your recovery phrase before sending".into());
        }
        if self.connection.mode == "offline" {
            return Err("Connect to a node before sending".into());
        }
        if priority > 3 {
            return Err("Invalid fee priority".into());
        }
        let amount = atomic(amount)?;
        let allocations = plan.amounts(amount)?;
        let split = allocations.len() > 1;
        if split && self.kind() != "software" {
            return Err("Exact splits currently require a software wallet. Use Automatic for hardware, watch-only or multisig wallets.".into());
        }
        if ![95, 106].contains(&address.len())
            || !address.bytes().all(|b| b.is_ascii_alphanumeric())
        {
            return Err("Paste a complete Monero address".into());
        }
        let valid = self.rpc()?.call(
            "validate_address",
            json!({"address":address,"any_net_type":false,"allow_openalias":false}),
        )?;
        if valid["valid"] != true {
            return Err("Address checksum or network is invalid".into());
        }
        if !plan.indices.is_empty() {
            let addresses = self
                .rpc()?
                .call("get_address", json!({"account_index":self.account}))?;
            let owned: BTreeSet<_> = addresses["addresses"]
                .as_array()
                .ok_or("Missing addresses")?
                .iter()
                .filter_map(|a| a["address_index"].as_u64())
                .collect();
            if plan.indices.iter().any(|i| !owned.contains(&(*i as u64))) {
                return Err("Selected source address does not belong to this wallet".into());
            }
        }
        self.control.phase("Syncing before payment");
        self.refresh_core()?;
        let mut parts = Vec::new();
        let mut fee_total = 0u64;
        let mut operation = "relay";
        for (i, (source, share)) in allocations.into_iter().enumerate() {
            self.begin_operation(self.operation_epoch)?;
            self.control.phase(&format!(
                "Preparing transaction {}{}",
                i + 1,
                if split { " of split" } else { "" }
            ));
            let mut params = json!({"destinations":[{"address":address,"amount":share}],"account_index":self.account,"priority":priority,"do_not_relay":true,"get_tx_metadata":true});
            let indices = source
                .map(|s| vec![s])
                .unwrap_or_else(|| plan.indices.clone());
            if !indices.is_empty() {
                params["subaddr_indices"] = json!(indices);
            }
            let tx = self.rpc()?.call("transfer", params)?;
            if tx["amount"].as_u64() != Some(share) {
                return Err("Prepared payment amount did not match; nothing was submitted".into());
            }
            let fee = tx["fee"].as_u64().ok_or("Missing fee")?;
            fee_total = fee_total.checked_add(fee).ok_or("Fee overflow")?;
            let key = if tx["unsigned_txset"].as_str().is_some_and(|s| !s.is_empty()) {
                operation = "unsigned";
                "unsigned_txset"
            } else if tx["multisig_txset"].as_str().is_some_and(|s| !s.is_empty()) {
                operation = "multisig";
                "multisig_txset"
            } else {
                "tx_metadata"
            };
            if split && operation != "relay" {
                return Err(
                    "Split signing is unavailable for this wallet; nothing was submitted".into(),
                );
            }
            let metadata = tx[key]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("Missing transaction metadata")?;
            parts.push(PreparedPart { metadata: Zeroizing::new(metadata.into()), review: json!({"source":source.or_else(|| if plan.indices.len()==1 {Some(plan.indices[0])} else {None}),"amount":share.to_string(),"fee":fee.to_string(),"txid":tx["tx_hash"]}) });
        }
        let id = random();
        let total = amount.checked_add(fee_total).ok_or("Amount overflow")?;
        let operation = if split { "relay-batch" } else { operation };
        let mut review = json!({"id":id,"address":address,"amount":amount.to_string(),"fee":fee_total.to_string(),"total":total.to_string(),"txid":parts[0].review["txid"],"network":self.connection.network,"expiresIn":120,"source":if plan.indices.len()==1 {Some(plan.indices[0])} else {None},"sources":plan.indices,"operation":operation,"account":self.account});
        if split {
            review["parts"] = json!(parts.iter().map(|p| &p.review).collect::<Vec<_>>());
        }
        let metadata = if split {
            Zeroizing::new(String::new())
        } else {
            std::mem::take(&mut parts[0].metadata)
        };
        self.pending = Some(Pending {
            id,
            operation: operation.into(),
            metadata,
            review: review.clone(),
            created: Instant::now(),
            parts: if split { parts } else { Vec::new() },
        });
        Ok(review)
    }
    fn persist_receipt(&mut self, receipt: &Value) -> Result<()> {
        self.last_payment = Some(receipt.clone());
        self.rpc()?.call(
            "set_attribute",
            json!({"key":"astra.last_payment","value":receipt.to_string()}),
        )?;
        self.rpc()?.call("store", json!({}))?;
        Ok(())
    }
    pub(crate) fn send_batch(&mut self, pending: Pending) -> Result<Value> {
        let count = pending.parts.len();
        let receipt = dispatch_batch(&pending, |step| match step {
            BatchStep::Canceled => Ok(json!(self.control.epoch() != self.operation_epoch)),
            BatchStep::Persist(receipt) => self.persist_receipt(receipt).map(|_| json!({})),
            BatchStep::Relay(index, metadata) => {
                self.control.phase(&format!(
                    "Submitting transaction {} of {}",
                    index + 1,
                    count
                ));
                self.rpc()?.call("relay_tx", json!({"hex":metadata}))
            }
        });
        self.last_payment = Some(receipt.clone());
        Ok(receipt)
    }
}
enum BatchStep<'a> {
    Canceled,
    Persist(&'a Value),
    Relay(usize, &'a str),
}
fn dispatch_batch(pending: &Pending, mut io: impl FnMut(BatchStep<'_>) -> Result<Value>) -> Value {
    let mut receipt = json!({"status":"not-sent","address":pending.review["address"],"amount":pending.review["amount"],"fee":pending.review["fee"],"createdAt":now(),"account":pending.review["account"],"parts":pending.parts.iter().map(|p|{let mut r=p.review.clone();r["status"]=json!("not-submitted");r}).collect::<Vec<_>>()});
    for (index, part) in pending.parts.iter().enumerate() {
        if io(BatchStep::Canceled).unwrap_or(json!(true)) == true {
            break;
        }
        // Save intent before each relay. A crash leaves a conservative "unknown" receipt.
        receipt["parts"][index]["status"] = json!("unknown");
        receipt["status"] = json!("unknown");
        if io(BatchStep::Persist(&receipt)).is_err() {
            receipt["parts"][index]["status"] = json!("not-submitted");
            receipt["message"] = json!(
                "Could not save submission intent. Remaining transactions were not submitted."
            );
            break;
        }
        let result = io(BatchStep::Relay(index, part.metadata.as_str()));
        if result
            .as_ref()
            .is_ok_and(|r| r["tx_hash"] == part.review["txid"])
        {
            receipt["parts"][index]["status"] = json!("sent");
        } else {
            receipt["message"] = json!("A relay response was uncertain. Submission stopped. Sync and check these transaction IDs before making another payment.");
            break;
        }
    }
    finish_receipt(&mut receipt);
    let saved = io(BatchStep::Persist(&receipt)).is_ok();
    receipt["saved"] = json!(saved);
    receipt
}

fn finish_receipt(receipt: &mut Value) {
    let parts = receipt["parts"]
        .as_array()
        .expect("internally generated receipt");
    let sent = parts.iter().filter(|p| p["status"] == "sent").count();
    let unknown = parts.iter().any(|p| p["status"] == "unknown");
    receipt["status"] = json!(if sent == parts.len() {
        "sent"
    } else if sent > 0 {
        "partial"
    } else if unknown {
        "unknown"
    } else {
        "not-sent"
    });
}
pub(crate) fn valid_receipt(v: &Value) -> bool {
    let Some(parts) = v["parts"].as_array() else {
        return false;
    };
    !parts.is_empty()
        && parts.len() <= 16
        && v["account"]
            .as_u64()
            .is_some_and(|a| u32::try_from(a).is_ok())
        && v["address"].as_str().is_some_and(|s| {
            [95, 106].contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric())
        })
        && v["amount"]
            .as_str()
            .is_some_and(|s| s.parse::<u64>().is_ok_and(|n| n > 0))
        && v["fee"].as_str().is_some_and(|s| s.parse::<u64>().is_ok())
        && ["sent", "partial", "unknown", "not-sent"].contains(&v["status"].as_str().unwrap_or(""))
        && parts.iter().all(|p| {
            p["source"]
                .as_u64()
                .is_some_and(|s| u32::try_from(s).is_ok())
                && ["sent", "unknown", "not-submitted"]
                    .contains(&p["status"].as_str().unwrap_or(""))
                && p["amount"]
                    .as_str()
                    .is_some_and(|s| s.parse::<u64>().is_ok_and(|n| n > 0))
                && p["fee"].as_str().is_some_and(|s| s.parse::<u64>().is_ok())
                && p["txid"]
                    .as_str()
                    .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan(mode: &str, indices: Vec<u32>, shares: Vec<SourceShare>) -> SourcePlan {
        SourcePlan {
            allocation: mode.into(),
            indices,
            shares,
        }
    }
    #[test]
    fn uncertain_relay_stops_remaining_parts_and_keeps_a_receipt() {
        let pending = Pending {
            id: "test".into(),
            operation: "relay-batch".into(),
            metadata: Zeroizing::new(String::new()),
            created: Instant::now(),
            review: json!({"address":"test","amount":"3","fee":"3"}),
            parts: (0..3)
                .map(|i| PreparedPart {
                    metadata: Zeroizing::new(format!("signed-{i}")),
                    review: json!({"txid":format!("tx-{i}"),"source":i,"amount":"1","fee":"1"}),
                })
                .collect(),
        };
        let mut calls = Vec::new();
        let mut saved = Vec::new();
        let result = dispatch_batch(&pending, |step| match step {
            BatchStep::Canceled => Ok(json!(false)),
            BatchStep::Persist(r) => {
                saved.push(r.clone());
                Ok(json!({}))
            }
            BatchStep::Relay(i, _) => {
                calls.push(i);
                if i == 0 {
                    Ok(json!({"tx_hash":"tx-0"}))
                } else {
                    Err("uncertain".into())
                }
            }
        });
        assert_eq!(calls, vec![0, 1]);
        assert_eq!(result["status"], "partial");
        assert_eq!(result["parts"][2]["status"], "not-submitted");
        assert_eq!(saved[0]["parts"][0]["status"], "unknown");
        let blocked = dispatch_batch(&pending, |step| match step {
            BatchStep::Canceled => Ok(json!(false)),
            BatchStep::Persist(_) => Err("disk full".into()),
            BatchStep::Relay(_, _) => panic!("Must persist before broadcasting"),
        });
        assert_eq!(blocked["status"], "not-sent");
        assert_eq!(blocked["saved"], false);
    }
    #[test]
    fn restored_receipt_rejects_malformed_values() {
        let good = json!({"account":0,"address":"8".repeat(95),"amount":"1","fee":"1","status":"unknown","parts":[{"source":1,"amount":"1","fee":"1","txid":"a".repeat(64),"status":"unknown"}]});
        assert!(valid_receipt(&good));
        for (field, value) in [
            ("amount", json!("not-a-number")),
            ("fee", json!("-1")),
            ("address", json!("")),
            ("parts", json!([])),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert!(!valid_receipt(&bad));
        }
        let mut bad = good.clone();
        bad["parts"][0]["txid"] = json!("bad");
        assert!(!valid_receipt(&bad));
    }
    #[test]
    fn equal_split_preserves_every_atomic_unit() {
        let p = plan("equal", vec![9, 2, 5], vec![]);
        assert_eq!(
            p.amounts(10).unwrap(),
            vec![(Some(2), 4), (Some(5), 3), (Some(9), 3)]
        );
        assert!(p.amounts(2).is_err());
        assert_eq!(
            p.amounts(u64::MAX)
                .unwrap()
                .iter()
                .map(|p| p.1 as u128)
                .sum::<u128>(),
            u64::MAX as u128
        );
    }
    #[test]
    fn source_plan_rejects_duplicates_missing_shares_and_overflow() {
        assert!(plan("auto", vec![1, 1], vec![]).amounts(1).is_err());
        assert!(plan("equal", vec![1], vec![]).amounts(1).is_err());
        assert!(plan(
            "custom",
            vec![1, 2],
            vec![SourceShare {
                index: 1,
                amount: "1".into()
            }]
        )
        .amounts(1_000_000_000_000)
        .is_err());
        assert!(plan(
            "custom",
            vec![1, 2],
            vec![
                SourceShare {
                    index: 1,
                    amount: "18446744.073709551615".into()
                },
                SourceShare {
                    index: 2,
                    amount: "1".into()
                }
            ]
        )
        .amounts(u64::MAX)
        .is_err());
        assert!(plan("invalid", vec![], vec![]).amounts(1).is_err());
    }
    #[test]
    fn partial_receipts_never_report_full_success() {
        for (statuses, expected) in [
            (vec!["sent", "unknown", "not-submitted"], "partial"),
            (vec!["unknown", "not-submitted"], "unknown"),
            (vec!["sent", "sent"], "sent"),
            (vec!["not-submitted"], "not-sent"),
        ] {
            let mut r =
                json!({"parts":statuses.iter().map(|s|json!({"status":s})).collect::<Vec<_>>()});
            finish_receipt(&mut r);
            assert_eq!(r["status"], expected);
        }
    }
}
