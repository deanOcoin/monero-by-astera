export type Connection = {
  network: "mainnet" | "stagenet" | "testnet";
  mode: "local" | "trusted-local" | "remote" | "tor" | "vpn" | "offline";
  node: string;
  proxy: string;
};
export type Address = {
  index: number;
  address: string;
  label: string;
  used: boolean;
  balance: string;
  unlocked: string;
};
export type Tx = {
  id: string;
  kind: string;
  amount: string;
  fee: string;
  timestamp: number;
  confirmations: number;
  height: number;
  address: string;
  subaddress: number;
};
export type Snapshot = {
  kind?: "software" | "hardware" | "watch" | "multisig";
  multisig?: {
    multisig: boolean;
    ready: boolean;
    threshold: number;
    total: number;
  };
  account?: number;
  accounts?: {
    index: number;
    label: string;
    address: string;
    balance: string;
    unlocked: string;
  }[];
  locked: boolean;
  wallets?: string[];
  wallet?: string;
  connection: Connection;
  balance?: string;
  unlocked?: string;
  height?: number;
  addresses?: Address[];
  transactions?: Tx[];
  backedUp?: boolean;
  lastSync?: number;
  syncError?: string;
  lastPayment?: {status: string; [key: string]: unknown};
};
export type Review = {
  id: string;
  address: string;
  amount: string;
  fee: string;
  total: string;
  txid: string;
  network: string;
  expiresIn: number;
  source: number | null;
  sources?: number[];
  parts?: { source: number | null; amount: string; fee: string; txid: string }[];
  operation?: string;
};
export function xmr(value: string = "0", max = 12): string {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 1000000000000n;
  const fraction = (abs % 1000000000000n)
    .toString()
    .padStart(12, "0")
    .slice(0, max)
    .replace(/0+$/, "");
  return sign + whole.toString() + (fraction ? "." + fraction : "");
}
export function amountValid(value: string) {
  if (value.length > 21 || !/^(0|[1-9]\d*)(\.\d{1,12})?$/.test(value))
    return false;
  const [whole, fraction = ""] = value.split(".");
  const atoms =
    BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, "0"));
  return atoms > 0n && atoms <= 18446744073709551615n;
}
export function escape(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
