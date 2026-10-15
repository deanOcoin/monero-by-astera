import { test, expect } from "@playwright/test";
const address = "8" + "A".repeat(94);
const initial = {
  locked: false,
  wallet: "Personal",
  connection: {
    network: "mainnet",
    mode: "local",
    node: "http://127.0.0.1:18081",
    proxy: "127.0.0.1:9050",
  },
  balance: "3248150000000",
  unlocked: "3100000000000",
  height: 3214118,
  backedUp: true,
  lastSync: 1789401600,
  addresses: [
    {
      index: 0,
      address: "4" + "B".repeat(94),
      label: "Primary account",
      used: true,
      balance: "2148150000000",
      unlocked: "2000000000000",
    },
    {
      index: 1,
      address,
      label: "Everyday",
      used: true,
      balance: "1100000000000",
      unlocked: "1100000000000",
    },
  ],
  transactions: [
    {
      id: "a".repeat(64),
      kind: "in",
      amount: "1100000000000",
      fee: "0",
      timestamp: 1789396000,
      confirmations: 32,
      height: 3214000,
      address,
      subaddress: 1,
    },
  ],
};
async function mock(
  page: any,
  locked = false,
  torFailure = false,
  kind = "software",
  syncFailure = "",
  startupGuide = false,
  extras = {},
) {
  await page.addInitScript(
    ({ initial, locked, torFailure, kind, syncFailure, startupGuide, extras }: any) => {
      if (!startupGuide) localStorage.setItem("monero-by-astera:startup-guide", "off");
      let s = {...structuredClone(initial),...extras};
      s.locked = locked;
      s.kind = kind;
      if (kind === "multisig") {
        s.multisig = { multisig: false, ready: false };
        s.backedUp = false;
      }
      if (torFailure) {
        s.connection.mode = "tor";
        s.connection.node = "http://" + "a".repeat(56) + ".onion:18081";
      }
      s.wallets = ["Personal"];
      (window as any).__calls = [];
      (window as any).__syncFailure = syncFailure;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          const {action,payload} = args;
          if (cmd === "view_preferences") {
            (window as any).__viewCalls ??= [];
            (window as any).__viewCalls.push(args);
            if (args.mode) {
              if ((window as any).__viewError) throw new Error("Could not save the display preference");
              if ((window as any).__delayView) await new Promise<void>(resolve=>{(window as any).__finishView=resolve;});
              localStorage.setItem("monero-by-astera:view",args.mode);
            }
            return {mode:localStorage.getItem("monero-by-astera:view") === "compact" ? "compact" : "full",notice:(window as any).__viewNotice};
          }
          (window as any).__calls.push({ action, payload });
          if (action === "snapshot") { if ((window as any).__snapshotError) throw new Error("Snapshot temporarily unavailable"); return s; }
          if (action === "open") {
            if ((window as any).__openError) throw new Error((window as any).__openError);
            if ((window as any).__delayOpen) await new Promise<void>(resolve => { (window as any).__finishOpen = resolve; });
            s.locked = false;
            return s;
          }
          if (action === "lock") {
            s.locked = true;
            return s;
          }
          if (action === "operation-status") return {phase:"Decrypting wallet files"};
          if (action === "discover-nodes") {
            if ((window as any).__delayDiscovery) await new Promise<void>(resolve => { (window as any).__finishDiscovery = resolve; });
            return {nodes:(window as any).__discoveryNodes ?? [{name:"Checked node",node:"https://checked.example",latencyMs:350,height:3764500}],tested:4,expiresIn:120};
          }
          if (action === "check-tor-proxies") {
            if ((window as any).__delayProxy) await new Promise<void>(resolve => { (window as any).__finishProxy = resolve; });
            return {proxies:(window as any).__proxies ?? [
              {proxy:"127.0.0.1:9050",ready:false,message:"No local proxy answered."},
              {proxy:"127.0.0.1:9150",ready:true,message:"SOCKS5 responded. Onion connectivity has not been tested."}
            ]};
          }
          if (action === "copy") return {};
          if (action === "check-node") {
            return { ready: true, height: 3762700, network: payload.connection.network, message: "Node is reachable and reports it is synced." };
          }
          if (action === "exchange-files")
            return {
              directory: "/private/exchange",
              files: ["unsigned-example.json", "peer-example.json"],
            };
          if (action === "configure") {
            s.connection = payload;
            return s;
          }
          if (action === "address") {
            if ((window as any).__delayAddress) await new Promise<void>(resolve=>{(window as any).__finishAddress=resolve;});
            if ((window as any).__addressError) throw new Error((window as any).__addressError);
            if (payload.index != null) {
              s.addresses.find((a:any)=>a.index===payload.index).label=payload.label;
            } else {
              s.addresses.push({index:Math.max(-1,...s.addresses.map((a:any)=>a.index))+1,address:"8"+"C".repeat(94),label:payload.label,used:false,balance:"0",unlocked:"0"});
            }
            return s;
          }
          if (action === "seed")
            return {
              key: Array.from({ length: 25 }, (_, i) => "word" + (i + 1)).join(
                " ",
              ),
            };
          if (action === "prepare") {
            const split = ["equal","custom"].includes(payload.allocation);
            return {
              id: "review-1",
              address: payload.address,
              amount: "1000000000001",
              fee: "10000000",
              total: "1000010000001",
              txid: "b".repeat(64),
              network: "mainnet",
              expiresIn: 120,
              source: payload.source ?? null,
              sources: payload.sources,
              operation: split ? "relay-batch" : "relay",
              ...(split ? {parts:[{source:0,amount:"500000000001",fee:"5000000",txid:"c".repeat(64)},{source:1,amount:"500000000000",fee:"5000000",txid:"d".repeat(64)}]} : {}),
              ...((window as any).__reviewExtra || {}),
            };
          }
          if (action === "send") {
            if ((window as any).__sendResult) {
              s.lastPayment = (window as any).__sendResult;
              if ((window as any).__failAfterSend) (window as any).__snapshotError = true;
              return s.lastPayment;
            }
            return { status: "sent", txid: "b".repeat(64), saved: true };
          }
          if (action === "refresh") {
            if ((window as any).__syncFailure) {
              s.syncError = (window as any).__syncFailure;
              s.lastSync = null;
              throw new Error(s.syncError);
            }
            if (torFailure) {
              s.syncError = "Tor node unavailable";
              s.lastSync = null;
              throw new Error(s.syncError);
            }
            s.syncError = null;
            s.lastSync = Math.floor(Date.now() / 1000);
            return s;
          }
          if (action === "cancel" || action === "touch") return {};
          throw new Error(action);
        },
      };
    },
    { initial, locked, torFailure, kind, syncFailure, startupGuide, extras },
  );
}
test("missing local daemon keeps guidance visible and only changes route explicitly", async ({ page }) => {
  await mock(page, false, false, "software", "Monero refresh (-38): no connection to daemon");
  await page.goto("/");
  await page.getByRole("button", { name: "Sync wallet", exact: true }).click();
  await page.getByRole("dialog", { name: "Let’s reconnect your wallet" }).waitFor();
  await page.keyboard.press("Escape");
  const notice = page.getByRole("region", { name: "Wallet sync status" });
  await expect(notice.getByRole("heading", { name: "No local Monero node is available" })).toBeVisible();
  await expect(notice).toContainText("does not confirm that no payment has arrived");
  await page.screenshot({ path: "work/ui-sync-error.png" });
  await page.getByRole("button", { name: "Addresses", exact: false }).first().click();
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "configure"))).toEqual([]);
  await notice.getByRole("button", { name: "Lock & change connection" }).click();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toHaveValue("local");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "lock").length)).toBe(1);
});
test("successful retry clears stale sync errors without changing the selected node", async ({ page }) => {
  await mock(page, false, false, "software", "Monero refresh (-38): no connection to daemon");
  await page.goto("/");
  await page.getByRole("button", { name: "Sync wallet", exact: true }).click();
  await page.getByRole("dialog", { name: "Let’s reconnect your wallet" }).waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).__syncFailure = ""; });
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect(page.getByRole("region", { name: "Wallet sync status" })).toHaveCount(0);
  await expect(page.locator(".balance-number")).toContainText("3.24815");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "configure"))).toEqual([]);
});
test("dashboard, exact balances, concealment and address search", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little peace of mind." }),
  ).toBeVisible();
  await expect(page.locator(".balance-number")).toContainText("3.24815");
  await page.screenshot({ path: "work/ui-overview.png" });
  await page.getByRole("button", { name: "Hide balances" }).click();
  await expect(page.locator(".balance-number")).toContainText("••••••");
  await page
    .getByRole("button", { name: "Addresses", exact: false })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Search addresses" })
    .fill("Everyday");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Search addresses" })
    .fill("no-match");
  await expect(page.getByText("No matching addresses.")).toBeVisible();
});
test("new subaddress label is escaped and QR stays local", async ({ page }) => {
  await mock(page);
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:1420") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Receive", exact: true })
    .first()
    .click();
  await expect(page.locator("#qr")).toHaveAttribute("src", /^data:image\/png/);
  await page.getByRole("button", { name: "New address" }).click();
  await page.getByRole("button", {name:"Add label for address 2",exact:true}).click();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("<script>alert(1)</script>");
  await page
    .getByRole("button", { name: "Save label", exact: true })
    .click();
  await expect(page.locator("#receive-address-rows")).toContainText(
    "<script>alert(1)</script>",
  );
  await expect(page.locator("script:not([src])")).toHaveCount(0);
  await page.screenshot({ path: "work/ui-receive.png" });
  expect(external).toEqual([]);
});
test("review requires address suffix and password before invoking send", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Recipient address" }).fill(address);
  await page
    .getByRole("textbox", { name: "Amount", exact: false })
    .fill("1.000000000001");
  await page.getByRole("button", { name: "Review payment" }).click();
  await expect(page.getByRole("dialog")).toContainText("1.000000000001 XMR");
  await page.getByRole("textbox", { name: "Last 6 characters" }).fill("wrong!");
  await page
    .getByLabel("Wallet password", { exact: true })
    .fill("test password only");
  await page.getByRole("button", { name: "Confirm & send" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((x: any) => x.action === "send").length,
    ),
  ).toBe(0);
  await page.getByRole("textbox", { name: "Last 6 characters" }).fill("AAAAAA");
  await page.getByRole("button", { name: "Confirm & send" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment submitted" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((x: any) => x.action === "send").length,
    ),
  ).toBe(1);
});
test("wallet creation tab remains selectable with existing wallets", async ({
  page,
}) => {
  await mock(page, true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create wallet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with your own wallet" }),
  ).toBeVisible();
  await page.screenshot({ path: "work/ui-welcome.png" });
});
test("Escape and switching apps preserve the session; explicit lock still works", async ({ page }) => {
  await mock(page);
  await page.goto("/");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".balance-number")).toHaveCount(1);
  await page.getByRole("button", { name: "Receive", exact: true }).first().click();
  await page.getByRole("button", { name: "New address", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Receive Monero", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "lock"))).toEqual([]);
  await page.keyboard.press("Meta+l");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator(".balance-number")).toHaveCount(0);
});
test("real interaction reports the final input; idle time has no keepalive", async ({ page }) => {
  await page.clock.install({time:new Date("2026-09-17T12:00:00Z")});
  await page.clock.pauseAt(new Date("2026-09-17T12:00:01Z"));
  await mock(page);
  await page.goto("/");
  await page.clock.runFor(600);
  await page.evaluate(() => { (window as any).__calls = []; });
  const touches = () => page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "touch").length);
  await page.mouse.move(450, 450);
  expect(await touches()).toBe(1);
  await page.clock.runFor(200);
  await page.keyboard.press("ArrowDown");
  expect(await touches()).toBe(1);
  await page.clock.runFor(310);
  expect(await touches()).toBe(2);
  await page.clock.fastForward(300_000);
  expect(await touches()).toBe(2);
});

test("connection fields match the selected privacy mode", async ({ page }) => {
  await mock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await expect(page.getByLabel("Local SOCKS proxy")).toBeHidden();
  const publicNode = page.getByRole("button", { name: "Find working mainnet nodes" });
  await expect(publicNode).toBeHidden();
  await page.getByRole("combobox", { name: "Connection", exact: true }).selectOption("remote");
  await expect(publicNode).toBeVisible();
  await publicNode.click();
  await expect(page.locator("#discovery-status")).toContainText("Accept the route notice");
  await page.getByRole("checkbox").check();
  await publicNode.click();
  await page.getByRole("button", {name:/Checked node/}).click();
  await expect(page.getByLabel("Node URL")).toHaveValue("https://checked.example");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ["configure", "open", "refresh"].includes(c.action)))).toEqual([]);
  await page.getByRole("combobox", { name: /^Network/ }).selectOption("stagenet");
  await expect(publicNode).toBeHidden();
  await page.getByRole("combobox", { name: /^Network/ }).selectOption("mainnet");
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption("offline");
  await expect(page.getByLabel("Node URL")).toBeHidden();
  await expect(page.getByLabel("Local SOCKS proxy")).toBeHidden();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption("tor");
  await expect(page.getByLabel("Node URL")).toBeVisible();
  await expect(page.getByLabel("Local SOCKS proxy")).toBeVisible();
  await expect(publicNode).toBeVisible();
});

test("Tor failure offers an explicit VPN route without connecting or falling back", async ({
  page,
}) => {
  await mock(page, false, true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sync", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Tor connection unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Monero by Astera has not switched", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use my trusted VPN instead" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Connection", exact: true }),
  ).toHaveValue("vpn");
  await expect(page.getByLabel("Node URL")).toHaveValue("");
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((c: any) => c.action === "configure")
          .length,
    ),
  ).toBe(0);
  await page.getByLabel("Node URL").fill("https://node.example:18081");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(
    page.getByText("VPN + HTTPS", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Wallet password", { exact: true })
    .fill("long test password");
  await page.getByRole("button", { name: "Unlock wallet" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((c: any) => c.action === "open").length,
    ),
  ).toBe(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unlock wallet" }).click();
  const opened = await page.evaluate(() =>
    (window as any).__calls.find((c: any) => c.action === "open"),
  );
  expect(opened.payload.vpnConfirmed).toBe(true);
});
test("Tor recovery exposes direct HTTPS with notice and explicit session consent", async ({ page }) => {
  await mock(page, false, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Sync wallet", exact: true }).click();
  await page.getByRole("button", { name: "Review direct HTTPS option" }).click();
  await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toHaveValue("remote");
  await expect(page.getByText("Direct HTTPS", { exact: true })).toBeVisible();
  await page.getByLabel("Node URL").fill("https://checked.example");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ["configure", "open", "check-node"].includes(c.action)))).toEqual([]);
  await page.getByRole("button", { name: "Save connection" }).click();
  await page.getByLabel("Wallet password", { exact: true }).fill("long test password");
  await page.getByRole("button", { name: "Unlock wallet" }).click();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "open"))).toEqual([]);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unlock wallet" }).click();
  const opened = await page.evaluate(() => (window as any).__calls.find((c: any) => c.action === "open"));
  expect(opened.payload.directConfirmed).toBe(true);
});

test("node checks require route consent and do not save settings or unlock keys", async ({ page }) => {
  await mock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await page.getByRole("combobox", { name: "Connection", exact: true }).selectOption("remote");
  await page.getByLabel("Node URL").fill("https://xmr-node.cakewallet.com:18081");
  await page.getByRole("button", { name: "Check selected node", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.action === "check-node"))).toEqual([]);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Check selected node", exact: true }).click();
  await expect(page.locator("#node-check-result")).toContainText("Ready · mainnet");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ["configure", "open", "refresh"].includes(c.action)))).toEqual([]);
  await page.getByLabel("Node URL", { exact: true }).fill("https://another.example");
  await expect(page.locator("#node-check-result")).toBeEmpty();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.screenshot({ path: "work/ui-direct-connection.png" });
});

test("beginner hints wait one and a half seconds and Settings disables them across launches", async ({ page }) => {
  await page.clock.install({time:new Date("2026-09-17T12:00:00Z")});
  await page.clock.pauseAt(new Date("2026-09-17T12:00:01Z"));
  await mock(page);
  await page.goto("/");
  const send = page.getByRole("button", { name: "Send", exact: true }).first();
  await send.hover();
  await page.clock.runFor(1400);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(page.getByRole("tooltip")).toContainText("Opening this page sends nothing");
  await expect(send).toHaveAttribute("aria-describedby", "beginner-tooltip");
  await page.screenshot({ path: "work/ui-beginner-tooltip.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show beginner hover explanations" }).uncheck();
  await page.screenshot({ path: "work/ui-settings.png" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await send.hover();
  await page.clock.runFor(2500);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.reload();
  await send.hover();
  await page.clock.runFor(2500);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Show beginner hover explanations" })).not.toBeChecked();
});

test("password hints explain the field without repeating its contents", async ({ page }) => {
  await page.clock.install();
  await mock(page, true);
  await page.goto("/");
  const password = page.getByLabel("Wallet password", { exact: true });
  await password.fill("disposable-input-not-for-display");
  await page.mouse.move(10, 10);
  await password.hover();
  await page.clock.runFor(2100);
  await expect(page.getByRole("tooltip")).toContainText("Enter it only here");
  await expect(page.getByRole("tooltip")).not.toContainText("disposable-input-not-for-display");
});

test("expired payment reviews cannot invoke send", async ({ page }) => {
  await page.clock.install();
  await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Recipient address" }).fill(address);
  await page.getByRole("textbox", { name: "Amount", exact: false }).fill("1");
  await page.getByRole("button", { name: "Review payment" }).click();
  await page
    .getByLabel("Wallet password", { exact: true })
    .fill("test password");
  await page.clock.fastForward(121000);
  await expect(
    page.getByRole("button", { name: "Confirm & send" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Wallet password", { exact: true })).toHaveValue(
    "",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((c: any) => c.action === "send").length,
    ),
  ).toBe(0);
});

test("advanced wallet setup exposes only the applicable fields", async ({
  page,
}) => {
  await mock(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "More wallet options" }).click();
  await expect(
    page.getByRole("textbox", { name: "16-word Polyseed", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Wallet type").selectOption("hardware");
  await expect(
    page.getByRole("textbox", { name: "16-word Polyseed", exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("Device", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Never enter your hardware recovery words here.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Wallet type").selectOption("create-multisig");
  await expect(page.getByLabel("Required signatures")).toBeVisible();
  await expect(page.getByLabel("Device", { exact: true })).toBeHidden();
  await page.screenshot({ path: "work/ui-advanced-setup.png" });
});
test("incomplete multisig setup never shows a receive QR or address", async ({
  page,
}) => {
  await mock(page, false, false, "multisig");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Finish your shared wallet" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Receive", exact: true })
    .first()
    .click();
  await expect(page.locator("#qr")).toHaveCount(0);
  await expect(page.getByText(address, { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue multisig setup & backups" })
    .click();
  await page
    .getByLabel("Operation", { exact: true })
    .selectOption("multisig-step");
  await expect(
    page.getByLabel("Exchange files", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "work/ui-wallet-tools.png" });
});


test("incorrect password feedback expires after three seconds", async ({ page }) => {
  await page.clock.install();
  await mock(page, true);
  await page.goto("/");
  await page.evaluate(() => { (window as any).__openError = "Monero open_wallet (-1): invalid password"; });
  await page.getByLabel("Wallet password", { exact: true }).fill("disposable-incorrect");
  await page.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("invalid password");
  await page.screenshot({ path: "work/ui-password-error.png" });
  await page.clock.runFor(2900);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.clock.runFor(101);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unlock wallet", exact: true })).toBeVisible();
});

test("retry removes the old password alert before unlocking finishes", async ({ page }) => {
  await page.clock.install();
  await mock(page, true);
  await page.goto("/");
  await page.evaluate(() => { (window as any).__openError = "invalid password"; });
  await page.getByLabel("Wallet password", { exact: true }).fill("disposable-wrong");
  await page.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as any).__openError = ""; (window as any).__delayOpen = true; });
  await page.getByLabel("Wallet password", { exact: true }).fill("disposable-correct");
  await page.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await expect(page.locator("body")).toHaveClass("busy");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(650);
  await expect(page.locator("body")).toHaveAttribute("data-progress", /Decrypting wallet files/);
  await page.evaluate(() => { (window as any).__finishOpen(); });
  await expect(page.getByRole("heading", { name: "A little peace of mind." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("connection errors keep a longer reading time", async ({ page }) => {
  await page.clock.install();
  await mock(page, true);
  await page.goto("/");
  await page.evaluate(() => { (window as any).__openError = "HTTPS certificate validation failed"; });
  await page.getByLabel("Wallet password", { exact: true }).fill("disposable-password");
  await page.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("certificate");
  await page.clock.runFor(3100);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("startup guide explains routes, stays local, and skips without changing connection", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:1420") && !request.url().startsWith("data:")) remoteRequests.push(request.url()); });
  await mock(page, true, false, "software", "", true);
  await page.goto("/");
  const guide = page.getByRole("dialog", { name: "A private wallet. Your choice of route." });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: "Skip guide" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(guide.getByRole("button", {name:"Switch to compact view"})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(guide.getByLabel("Show this guide at startup")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(guide.getByRole("button", { name: "Skip guide" })).toBeFocused();
  await expect(guide).toContainText("HTTPS encrypts the connection");
  await expect(guide).toContainText("app cannot verify or enforce it");
  await expect(guide).toContainText("http://127.0.0.1:18081");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px "Manrope"') && document.fonts.check('35px "Outfit"'))).toBe(true);
  await page.screenshot({ path: "work/ui-startup-guide.png" });
  await page.setViewportSize({ width: 920, height: 700 });
  await expect(guide.getByRole("button", { name: "Skip guide" })).toBeInViewport();
  await expect(guide.getByRole("button", { name: "Continue to wallet" })).toBeInViewport();
  await expect(guide.getByLabel("Show this guide at startup")).toBeInViewport();
  await page.screenshot({ path: "work/ui-startup-guide-small.png" });
  await guide.getByRole("button", { name: "Skip guide" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByLabel("Wallet password", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => !["snapshot", "touch"].includes(c.action)))).toEqual([]);
  expect(remoteRequests).toEqual([]);
  await page.reload();
  await expect(guide).toBeVisible();
});

test("startup guide preference persists and the guide can be reopened from Settings", async ({ page }) => {
  await mock(page, true, false, "software", "", true);
  await page.goto("/");
  await page.getByLabel("Show this guide at startup").uncheck();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Show connection guide at startup")).not.toBeChecked();
  await page.getByRole("button", { name: "Read the connection guide" }).click();
  await expect(page.getByRole("dialog", { name: "A private wallet. Your choice of route." })).toBeVisible();
  await page.getByLabel("Show this guide at startup").check();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "A private wallet. Your choice of route." })).toBeVisible();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "A private wallet. Your choice of route.", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toHaveValue("local");
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ["configure", "check-node", "open"].includes(c.action)))).toEqual([]);
});


test("node discovery shows only checked results and expires them", async ({ page }) => {
  await page.clock.install();await mock(page,true);await page.goto("/");
  await page.getByRole("button",{name:"Connection settings"}).click();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await page.getByRole("combobox",{name:"Connection",exact:true}).selectOption("remote");
  await expect(page.locator(".checked-node")).toHaveCount(0);
  await page.getByRole("button",{name:"Find working mainnet nodes"}).click();
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='discover-nodes'))).toEqual([]);
  await page.getByRole("checkbox").check();
  await page.evaluate(()=>{(window as any).__delayDiscovery=true;});
  await page.getByRole("button",{name:"Find working mainnet nodes"}).click();
  await expect(page.locator(".checked-node")).toHaveCount(0);
  await page.evaluate(()=>{(window as any).__finishDiscovery();});
  await expect(page.locator(".checked-node")).toHaveCount(1);
  await page.screenshot({path:"work/ui-checked-nodes.png"});
  await page.setViewportSize({width:920,height:700});
  await expect(page.getByRole("button",{name:"Save connection",exact:true})).toBeInViewport();
  await page.screenshot({path:"work/ui-checked-nodes-small.png"});
  await page.clock.runFor(120001);
  await expect(page.locator(".checked-node")).toHaveCount(0);
  await expect(page.locator("#discovery-status")).toContainText("expired");
});

test("route changes discard in-flight node results", async ({ page }) => {
  await mock(page,true);await page.goto("/");await page.getByRole("button",{name:"Connection settings"}).click();
  await page.getByRole("button", { name: "Edit saved connection", exact: true }).click();
  await page.getByRole("combobox",{name:"Connection",exact:true}).selectOption("remote");await page.getByRole("checkbox").check();
  await page.evaluate(()=>{(window as any).__delayDiscovery=true;});await page.getByRole("button",{name:"Find working mainnet nodes"}).click();
  await page.getByRole("combobox",{name:"Connection",exact:true}).selectOption("tor");await page.evaluate(()=>{(window as any).__finishDiscovery();});
  await expect(page.locator(".checked-node")).toHaveCount(0);await expect(page.getByRole("combobox",{name:"Connection",exact:true})).toHaveValue("tor");
});

test("multiple sources offer exact equal shares and review each fee", async ({ page }) => {
  await mock(page);await page.goto("/");await page.getByRole("button",{name:"Send",exact:true}).first().click();
  await page.getByLabel("Recipient address").fill(address);await page.locator('input[name="amount"]').fill("1.000000000001");
  await page.getByText("Transaction options",{exact:true}).click();await page.getByRole("combobox",{name:"Spend from",exact:true}).selectOption("multiple");
  await page.getByRole("combobox",{name:"Allocation",exact:true}).selectOption("equal");
  await page.locator('input[name="sources"][value="0"]').check();await page.locator('input[name="sources"][value="1"]').check();
  await expect(page.locator('[data-share="0"]')).toHaveText("0.500000000001 XMR");await expect(page.locator('[data-share="1"]')).toHaveText("0.5 XMR");
  await page.screenshot({path:"work/ui-split-send.png"});
  await page.getByRole("button",{name:"Review payment"}).click();
  const prepared=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.action==='prepare'));
  expect(prepared.payload.sources).toEqual([0,1]);expect(prepared.payload.allocation).toBe('equal');
  await expect(page.getByRole("dialog")).toContainText("2 separate transactions");await expect(page.getByRole("button",{name:"Confirm & send"})).toBeVisible();
  await page.screenshot({path:"work/ui-split-review.png"});
});

test("custom source amounts must match total and wallet name navigates home", async ({ page }) => {
  await mock(page);await page.goto("/");await page.getByRole("button",{name:"Send",exact:true}).first().click();
  await page.getByLabel("Recipient address").fill(address);await page.locator('input[name="amount"]').fill("1.000000000001");
  await page.getByText("Transaction options",{exact:true}).click();await page.getByRole("combobox",{name:"Spend from",exact:true}).selectOption("multiple");await page.getByRole("combobox",{name:"Allocation",exact:true}).selectOption("custom");
  await page.locator('input[name="sources"][value="0"]').check();await page.locator('input[name="sources"][value="1"]').check();
  await page.getByLabel("Amount from Primary account",{exact:true}).fill("0.3");await page.getByLabel("Amount from Everyday",{exact:true}).fill("0.5");
  await page.getByRole("button",{name:"Review payment"}).click();await expect(page.getByRole("alert")).toContainText("must add up");
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='prepare'))).toEqual([]);
  await page.getByLabel("Amount from Everyday",{exact:true}).fill("0.700000000001");await page.getByRole("button",{name:"Review payment"}).click();
  const prepared=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.action==='prepare'));expect(prepared.payload.shares).toEqual([{index:0,amount:'0.3'},{index:1,amount:'0.700000000001'}]);
  await page.keyboard.press("Escape");await page.getByRole("button",{name:"Wallet overview",exact:true}).click();await expect(page.getByRole("heading",{name:"A little peace of mind."})).toBeVisible();
});


test("partial split receipt remains visible when the following balance read fails", async ({ page }) => {
  await mock(page); await page.goto("/");
  await page.evaluate(() => {
    (window as any).__failAfterSend = true;
    (window as any).__sendResult = {status:"partial", saved:true, message:"A relay response was uncertain. Submission stopped.", parts:[
      {source:0,amount:"500000000001",fee:"5000000",txid:"c".repeat(64),status:"sent"},
      {source:1,amount:"500000000000",fee:"5000000",txid:"d".repeat(64),status:"unknown"}
    ]};
  });
  await page.getByRole("button", {name:"Send",exact:true}).first().click();
  await page.getByLabel("Recipient address").fill(address);
  await page.locator('input[name="amount"]').fill("1.000000000001");
  await page.getByText("Transaction options", {exact:true}).click();
  await page.getByRole("combobox", {name:"Spend from",exact:true}).selectOption("multiple");
  await page.getByRole("combobox", {name:"Allocation",exact:true}).selectOption("equal");
  await page.locator('input[name="sources"][value="0"]').check();
  await page.locator('input[name="sources"][value="1"]').check();
  await page.getByRole("button", {name:"Review payment"}).click();
  await page.getByLabel("Last 6 characters of the recipient address").fill(address.slice(-6));
  await page.getByLabel("Wallet password", {exact:true}).fill("disposable-password");
  await page.getByRole("button", {name:"Confirm & send"}).click();
  const receipt = page.getByRole("dialog", {name:"Review split payment status"});
  await expect(receipt).toContainText("Submission stopped");
  await expect(receipt.locator(".receipt-status")).toHaveText(["sent","unknown"]);
  await expect(receipt).toContainText("d".repeat(64));
  expect(await page.evaluate(() => (window as any).__calls.filter((c:any) => c.action === "send").length)).toBe(1);
  await page.screenshot({path:"work/ui-partial-receipt.png"});
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"A previous split needs review.",exact:false}).click();
  await expect(receipt).toContainText("d".repeat(64));
});


test("connection entry points share the startup chooser even when startup is disabled", async ({ page }) => {
  await mock(page, true); await page.goto("/");
  const guide = page.getByRole("dialog", {name:"A private wallet. Your choice of route."});
  await page.getByRole("button", {name:"Connection settings",exact:true}).click();
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", {name:"Tor onion node",exact:false})).toBeVisible();
  await page.getByRole("button", {name:"Edit saved connection",exact:true}).click();
  await expect(guide).toBeVisible();
  await expect(page.getByLabel("Node URL")).toHaveValue(initial.connection.node);
  await page.getByLabel("Node URL").fill("http://127.0.0.1:9999");
  await page.getByRole("button", {name:"All routes",exact:false}).click();
  await expect(guide).toContainText(initial.connection.node);
  await page.getByRole("button", {name:"Skip guide",exact:false}).click();
  await page.getByRole("button", {name:"Settings",exact:true}).click();
  await page.getByRole("button", {name:"Wallet connection settings",exact:true}).click();
  await expect(guide).toBeVisible();
  await page.getByRole("button", {name:"My own node",exact:false}).click();
  await expect(page.getByLabel("Node URL")).toHaveValue(initial.connection.node);
  await page.getByRole("button", {name:"Cancel",exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>!["snapshot","touch"].includes(c.action)))).toEqual([]);
});

test("manual route editing locks an open wallet before showing its configuration", async ({ page }) => {
  await mock(page); await page.goto("/");
  await page.getByRole("button", {name:"Settings",exact:true}).click();
  await page.getByRole("button", {name:"Read the connection guide",exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='lock'))).toEqual([]);
  await page.getByRole("button", {name:"Tor onion node",exact:false}).click();
  await expect(page.getByRole("combobox", {name:"Connection",exact:true})).toHaveValue("tor");
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='lock').length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>["configure","check-node","discover-nodes","check-tor-proxies"].includes(c.action)))).toEqual([]);
});

test("Tor proxy detection is explicit, honest, and never saves a route", async ({ page }) => {
  await mock(page,true); await page.goto("/");
  await page.getByRole("button", {name:"Connection settings",exact:true}).click();
  await page.getByRole("button", {name:"Tor onion node",exact:false}).click();
  await expect(page.getByRole("dialog")).toContainText("Keep it running");
  await expect(page.getByRole("dialog")).toContainText("Tor never switches to direct");
  await page.setViewportSize({width:920,height:700});
  await expect(page.getByRole("button", {name:"Save connection",exact:true})).toBeInViewport();
  await page.screenshot({path:"work/ui-tor-setup-small.png"});
  await page.getByRole("button", {name:"Check local Tor proxies",exact:true}).click();
  await expect(page.locator("#tor-status")).toContainText("does not prove the proxy is Tor");
  await expect(page.getByRole("button", {name:"Use 127.0.0.1:9050",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Use 127.0.0.1:9150",exact:true})).toBeVisible();
  await page.screenshot({path:"work/ui-tor-diagnostics.png"});
  await page.getByRole("button", {name:"Use 127.0.0.1:9150",exact:true}).click();
  await expect(page.getByLabel("Local SOCKS proxy")).toHaveValue("127.0.0.1:9150");
  await expect(page.locator("#tor-status")).toContainText("Nothing is saved yet");
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>["configure","check-node","discover-nodes","open","refresh"].includes(c.action)))).toEqual([]);
  await page.getByRole("button", {name:"Find working mainnet nodes",exact:true}).click();
  const call=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.action==='discover-nodes'));
  expect(call.payload.connection.mode).toBe("tor");expect(call.payload.connection.proxy).toBe("127.0.0.1:9150");
});

test("proxy checks discard stale responses after edits, cancellation or route changes", async ({ page }) => {
  await mock(page,true);await page.goto("/");
  await page.getByRole("button", {name:"Connection settings",exact:true}).click();
  await page.getByRole("button", {name:"Tor onion node",exact:false}).click();
  await page.evaluate(()=>{(window as any).__delayProxy=true;});
  await page.getByRole("button", {name:"Check local Tor proxies",exact:true}).click();
  await page.getByLabel("Local SOCKS proxy").fill("[::1]:9050");
  await page.evaluate(()=>{(window as any).__finishProxy();});
  await expect(page.locator("#tor-proxies")).toBeEmpty();
  await expect(page.getByRole("button", {name:"Check local Tor proxies",exact:true})).toBeEnabled();
  await page.getByRole("button", {name:"Check local Tor proxies",exact:true}).click();
  await page.getByRole("combobox", {name:"Connection",exact:true}).selectOption("vpn");
  await page.evaluate(()=>{(window as any).__finishProxy();});
  await expect(page.locator("#tor-setup")).toBeHidden();
  await page.getByRole("combobox", {name:"Connection",exact:true}).selectOption("tor");
  await page.getByRole("button", {name:"Check local Tor proxies",exact:true}).click();
  await page.getByRole("button", {name:"All routes",exact:false}).click();
  await page.evaluate(()=>{(window as any).__finishProxy();});
  await expect(page.locator("#tor-proxies")).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Tor onion node",exact:false})).toBeVisible();
});

test("missing Tor explains recovery and leaves manual proxy entry usable", async ({ page }) => {
  await mock(page,true);await page.goto("/");
  await page.getByRole("button", {name:"Connection settings",exact:true}).click();
  await page.getByRole("button", {name:"Tor onion node",exact:false}).click();
  await page.evaluate(()=>{(window as any).__proxies=[{proxy:"127.0.0.1:9050",ready:false,message:"No local proxy answered."}];});
  await page.getByRole("button", {name:"Check local Tor proxies",exact:true}).click();
  await expect(page.locator("#tor-status")).toContainText("Start Tor or connect Tor Browser");
  await expect(page.locator("#tor-proxies button")).toHaveCount(0);
  await page.getByLabel("Local SOCKS proxy").fill("127.0.0.1:9999");
  await expect(page.locator("#tor-status")).toBeEmpty();
  await page.getByRole("button", {name:"All routes",exact:false}).click();
  await page.getByRole("button", {name:"Use offline",exact:true}).click();
  await expect(page.getByLabel("Node URL")).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='configure'))).toEqual([]);
});

test("full view is the default; compact choice and dismissed introduction survive reload", async ({page})=>{
  await mock(page,true);await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-view','full');
  await expect(page.getByRole('complementary',{name:'Compact view introduction'})).toBeVisible();
  await page.getByLabel('Wallet password',{exact:true}).fill('disposable draft password');
  const original = await page.locator('#wallet-form').elementHandle();
  await page.getByRole('button',{name:'Switch to compact view',exact:true}).click();
  await page.setViewportSize({width:820,height:620});
  await expect(page.locator('html')).toHaveAttribute('data-view','compact');
  expect(await original!.evaluate(el=>el===document.querySelector('#wallet-form'))).toBe(true);
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('disposable draft password');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('disposable');
  await page.screenshot({path:'work/ui-compact-locked.png'});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-view','compact');
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Switch to full view',exact:true}).click();
  await page.setViewportSize({width:1180,height:820});
  await expect(page.getByRole('complementary',{name:'Compact view introduction'})).toBeHidden();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-view','full');
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>!['snapshot','touch'].includes(c.action)))).toEqual([]);
});

test("compact send retains exact split drafts and form identity through both switches", async ({page})=>{
  await mock(page);await page.goto('/');
  await page.getByRole('button',{name:'Send',exact:true}).first().click();
  await page.getByLabel('Recipient address').fill(address);
  await page.locator('input[name=amount]').fill('1.000000000001');
  await page.getByText('Transaction options',{exact:true}).click();
  await page.getByRole('combobox',{name:'Spend from',exact:true}).selectOption('multiple');
  await page.getByRole('combobox',{name:'Allocation',exact:true}).selectOption('custom');
  await page.locator('input[name=sources][value="0"]').check();await page.locator('input[name=sources][value="1"]').check();
  await page.getByLabel('Amount from Primary account',{exact:true}).fill('0.3');
  await page.getByLabel('Amount from Everyday',{exact:true}).fill('0.700000000001');
  const original=await page.locator('#send-form').elementHandle();
  await page.getByRole('button',{name:'Switch to compact view',exact:true}).click();await page.setViewportSize({width:820,height:620});
  await expect(page.locator('#send-form details')).toHaveAttribute('open','');
  await expect(page.getByLabel('Amount from Everyday',{exact:true})).toHaveValue('0.700000000001');
  await page.screenshot({path:'work/ui-compact-send.png'});
  await page.getByRole('button',{name:'Switch to full view',exact:true}).click();
  expect(await original!.evaluate(el=>el===document.querySelector('#send-form'))).toBe(true);
  await expect(page.getByLabel('Recipient address')).toHaveValue(address);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>['prepare','send','cancel','lock'].includes(c.action)))).toEqual([]);
});

test("review switching preserves the approval and its original expiry", async ({page})=>{
  await page.clock.install();await mock(page);await page.goto('/');
  await page.getByRole('button',{name:'Send',exact:true}).first().click();
  await page.getByLabel('Recipient address').fill(address);await page.locator('input[name=amount]').fill('1');
  await page.getByRole('button',{name:'Review payment',exact:true}).click();
  const review=await page.locator('#confirm-form').elementHandle();
  await page.getByLabel('Wallet password',{exact:true}).fill('test-only password');
  await page.clock.runFor(60000);
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();
  await page.setViewportSize({width:720,height:540});
  expect(await review!.evaluate(el=>el===document.querySelector('#confirm-form'))).toBe(true);
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('test-only password');
  await expect(page.getByRole('dialog')).toContainText(address);
  await page.screenshot({path:'work/ui-compact-review.png'});
  await compactPageTo(page,page.getByRole('button',{name:'Confirm & send',exact:true}),true);
  await expect(page.getByRole('button',{name:'Confirm & send',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='cancel'))).toEqual([]);
  await page.clock.runFor(61000);
  await expect(page.getByRole('button',{name:'Confirm & send',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('');
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='prepare').length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='send'))).toEqual([]);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='cancel').length)).toBe(1);
});

test("compact receive preserves the selected address and requested QR amount", async ({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Receive',exact:true}).first().click();
  await page.getByRole('button',{name:'Choose receiving address',exact:true}).click();
  await page.getByRole('button',{name:'Receive at address 0',exact:true}).click();
  await page.locator('#request-amount').fill('0.123456789012');
  await expect(page.locator('#qr-caption')).toContainText('includes the requested amount');
  await expect(page.locator('#qr')).toHaveAttribute('src',/^data:image/);
  const qr=await page.locator('#qr').getAttribute('src');
  await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:820,height:620});
  await expect(page.locator('#receive-select')).toHaveAttribute('data-address-index','0');
  await expect(page.locator('#request-amount')).toHaveValue('0.123456789012');
  await expect(page.locator('#qr')).toHaveAttribute('src',qr!);
  await page.screenshot({path:'work/ui-compact-receive.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("compact navigation keeps overview, addresses, activity and tools accessible", async ({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();
  await page.setViewportSize({width:720,height:540});
  await page.screenshot({path:'work/ui-compact-overview.png'});
  await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Addresses',exact:true}).click();
  await page.getByLabel('Search addresses').fill('Everyday');
  await expect(page.locator('#address-rows tr')).toHaveCount(1);
  await page.screenshot({path:'work/ui-compact-addresses.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('navigation').getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('heading',{name:'All transactions'})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'Open wallet tools'}).click();
  await page.getByLabel('Operation',{exact:true}).selectOption('import-outputs');
  await compactPageTo(page,page.getByLabel('Exchange files',{exact:false}),true);
  await expect(page.getByLabel('Exchange files',{exact:false})).toBeVisible();
});

test("compact connection pages retain a Tor draft without scrolling", async ({page})=>{
  await mock(page,true,false,'software','',true);await page.goto('/');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.screenshot({path:'work/ui-compact-guide.png'});
  await page.getByRole('button',{name:'Tor onion node',exact:false}).click();
  await compactPageTo(page,page.getByLabel('Local SOCKS proxy'),true);
  await page.getByLabel('Local SOCKS proxy').fill('127.0.0.1:9150');
  await compactPageTo(page,page.getByLabel('Node URL'),true);
  await page.getByLabel('Node URL').fill('http://'+'a'.repeat(56)+'.onion:18081');
  await compactPageTo(page,page.getByText('1. Start Tor · setup instructions',{exact:true}),true);
  await page.getByText('1. Start Tor · setup instructions',{exact:true}).click();
  await compactPageTo(page,page.getByText('When Tor will not connect',{exact:true}),true);
  await page.getByText('When Tor will not connect',{exact:true}).click();
  await compactPageTo(page,page.getByRole('button',{name:'Save connection',exact:true}),true);
  await assertCompactFits(page,true);
  await expect(page.getByRole('button',{name:'Save connection',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('dialog').getByRole('button',{name:'Switch to full view',exact:true}).click();await page.setViewportSize({width:1180,height:820});
  await expect(page.getByLabel('Local SOCKS proxy')).toHaveValue('127.0.0.1:9150');
  await expect(page.locator('.tor-instructions').first()).toHaveAttribute('open','');
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>['configure','open','check-node','check-tor-proxies'].includes(c.action)))).toEqual([]);
});

test("failed preference saves preserve the mode and draft; rapid switches serialize", async ({page})=>{
  await mock(page,true);await page.goto('/');await page.getByLabel('Wallet password',{exact:true}).fill('unsaved test');
  await page.evaluate(()=>{(window as any).__viewError=true;});
  await page.getByRole('button',{name:'Switch to compact view'}).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.locator('html')).toHaveAttribute('data-view','full');
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('unsaved test');
  await page.evaluate(()=>{(window as any).__viewError=false;(window as any).__delayView=true;(window as any).__viewCalls=[];});
  await page.getByRole('button',{name:'Switch to compact view'}).click();
  await expect(page.getByRole('button',{name:'Switch to compact view'})).toBeDisabled();
  await page.evaluate(()=>{document.querySelector<HTMLButtonElement>('.view-toggle')!.click();});
  expect(await page.evaluate(()=>(window as any).__viewCalls.length)).toBe(1);
  await page.evaluate(()=>{(window as any).__finishView();});
  await expect(page.getByRole('button',{name:'Switch to full view'})).toBeEnabled();
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('unsaved test');
});

test("compact view keeps sync failure and route consent warnings visible", async ({page})=>{
  await mock(page,false,true);await page.goto('/');
  await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.getByRole('button',{name:'Sync wallet',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('has not switched to a direct connection');
  await page.getByRole('button',{name:'Review direct HTTPS option'}).click();
  await compactPageTo(page,page.getByRole('checkbox',{name:/I accept this route/}),true);
  await expect(page.getByRole('checkbox',{name:/I accept this route/})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Nodes see your IP and timing');
  await compactPageTo(page,page.getByRole('button',{name:'Save connection',exact:true}),true);
  await assertCompactFits(page,true);
  await expect(page.getByRole('button',{name:'Save connection',exact:true})).toBeInViewport();
});

test("view introduction can be restored and fullscreen notice does not reset a draft", async ({page})=>{
  await mock(page,true);await page.goto('/');
  await page.evaluate(()=>{(window as any).__viewNotice='View saved. Leave full screen to use this view’s window size.';});
  await page.getByLabel('Wallet password',{exact:true}).fill('still local');
  await page.getByRole('button',{name:'Switch to compact view'}).click();
  await expect(page.getByRole('status').filter({hasText:'Leave full screen'})).toBeVisible();
  await expect(page.getByLabel('Wallet password',{exact:true})).toHaveValue('still local');
  await page.getByRole('button',{name:'Switch to full view'}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Show the view introduction again'}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Compact view introduction'})).toBeVisible();
});

async function compactPageTo(page: any, target: any, dialog = false) {
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  if (await page.locator('html').getAttribute('data-view') !== 'compact') return;
  const deck = dialog ? page.getByRole('dialog') : page.locator('main');
  const pager = deck.locator(':scope > .compact-pager');
  for (let i=0;i<80;i++) {
    if (await target.isVisible()) return;
    const next = pager.getByRole('button',{name:'Next →',exact:true,includeHidden:true});
    if (await next.isDisabled()) {
      const back = pager.getByRole('button',{name:'← Back',exact:true,includeHidden:true});
      while (await back.isEnabled()) await back.click();
    } else await next.click();
  }
  throw new Error('Compact page containing target was not reachable');
}
async function assertCompactFits(page: any, dialog = false) {
  await expect.poll(async()=>page.evaluate((isDialog:boolean)=>{
    const root=document.querySelector<HTMLElement>(isDialog?'.modal':'main')!;
    const rect=root.getBoundingClientRect();
    const offenders=Array.from(root.querySelectorAll<HTMLElement>('button,input,select,textarea,label,p,code,tr,h1,h2,h3,.source-row')).filter(el=>{
      if (!el.checkVisibility() || getComputedStyle(el).visibility==='hidden') return false;
      const r=el.getBoundingClientRect();
      return r.bottom>rect.bottom+1 || r.top<rect.top-1 || r.right>rect.right+1 || r.left<rect.left-1;
    }).map(el=>el.tagName+':'+el.textContent?.slice(0,50));
    return {window:document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight,root:root.scrollHeight<=root.clientHeight+1 && root.scrollWidth<=root.clientWidth+1,offenders};
  },dialog)).toEqual({window:true,root:true,offenders:[]});
}
test('compact fixed pages fit every tab and keep navigation visible at minimum size',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();
  await page.setViewportSize({width:720,height:540});
  for(const name of ['Overview','Send','Receive','Addresses','Activity','Tools']) {
    await page.locator('.compact-nav').getByRole('button',{name,exact:true}).click();
    const next=page.locator('main > .compact-pager').getByRole('button',{name:'Next →',includeHidden:true});
    for(let i=0;i<30;i++) {
      await page.screenshot({path:'work/fixed-probe-'+name+'-'+i+'.png'});
      await assertCompactFits(page);
      await expect(page.locator('.compact-nav')).toBeInViewport({ratio:1});
      if(await next.isDisabled()) break;
      await next.click();
    }
  }
});

async function visitCompactPages(page:any, dialog=false, visit=async()=>{}) {
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const deck=dialog?page.getByRole('dialog'):page.locator('main');
  const jump=deck.locator(':scope > .compact-pager select');
  await expect(jump).toHaveCount(1);
  const count=await jump.locator('option').count();
  expect(count).toBeGreaterThan(0);expect(count).toBeLessThan(80);
  for(let i=0;i<count;i++) {
    if(count>1) await jump.selectOption(String(i));
    await assertCompactFits(page,dialog);await visit();
  }
}
test('compact receive keeps address, QR, copy and amount together at minimum size',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();
  await page.setViewportSize({width:720,height:540});await page.locator('.compact-nav').getByRole('button',{name:'Receive',exact:true}).click();
  for(const selector of ['#receive-select','#qr','.receive-card .full-address','[data-action="copy-address"]','#request-amount']) {
    await expect(page.locator(selector)).toBeInViewport({ratio:1});
  }
  await assertCompactFits(page);await page.screenshot({path:'work/fixed-receive.png'});
});
test('compact large address and activity lists expose every row without overflow and search resets pagination',async({page})=>{
  const addresses=Array.from({length:45},(_,i)=>({...initial.addresses[1],index:i,label:i===44?'Last '+ 'x'.repeat(70):'Address '+i}));
  const transactions=Array.from({length:45},(_,i)=>({...initial.transactions[0],id:i.toString(16).padStart(64,'a')}));
  await mock(page,false,false,'software','',false,{addresses,transactions});await page.goto('/');
  await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.locator('.compact-nav').getByRole('button',{name:'Addresses',exact:true}).click();
  const rows=new Set<string>();await visitCompactPages(page,false,async()=>{
    for(const label of await page.locator('#address-rows tr:visible td:first-child b').allTextContents()) rows.add(label);
  });expect(rows.size).toBe(45);
  await compactPageTo(page,page.getByLabel('Search addresses'));await page.getByLabel('Search addresses').fill('Last');
  await expect(page.locator('#address-rows tr')).toHaveCount(1);await expect(page.locator('#address-rows tr')).toBeInViewport({ratio:1});await assertCompactFits(page);
  await page.locator('.compact-nav').getByRole('button',{name:'Activity',exact:true}).click();
  const txs=new Set<string>();await visitCompactPages(page,false,async()=>{
    for(const id of await page.locator('main .tx-row:visible').evaluateAll(els=>els.map(e=>e.getAttribute('data-tx')!))) txs.add(id);
  });expect(txs.size).toBe(45);
});
test('compact Tor instructions, proxy results, node discovery and settings all fit as pages',async({page})=>{
  await mock(page,true,false,'software','',true);await page.goto('/');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await visitCompactPages(page,true);
  await compactPageTo(page,page.getByRole('button',{name:'Tor onion node',exact:false}),true);await page.getByRole('button',{name:'Tor onion node',exact:false}).click();
  for(const text of ['1. Start Tor · setup instructions','Install with Homebrew · optional','When Tor will not connect']) {
    await compactPageTo(page,page.getByText(text,{exact:true}),true);await page.getByText(text,{exact:true}).click();
  }
  await compactPageTo(page,page.getByRole('button',{name:'Check local Tor proxies'}),true);await page.getByRole('button',{name:'Check local Tor proxies'}).click();
  await compactPageTo(page,page.getByRole('button',{name:'Use 127.0.0.1:9150',exact:true}),true);await page.getByRole('button',{name:'Use 127.0.0.1:9150',exact:true}).click();
  await compactPageTo(page,page.getByRole('button',{name:'Find working mainnet nodes',exact:true}),true);await page.getByRole('button',{name:'Find working mainnet nodes',exact:true}).click();
  await visitCompactPages(page,true);await page.screenshot({path:'work/fixed-connection.png'});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Settings',exact:true}).click();await visitCompactPages(page,true);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>['open','configure','send'].includes(c.action)))).toEqual([]);
});
test('compact restore and wallet tools reveal invalid off-page fields without losing entered values',async({page})=>{
  await mock(page,true);await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.getByRole('button',{name:'Restore wallet',exact:true}).click();
  await visitCompactPages(page);
  const submit=page.getByRole('button',{name:'Restore my wallet',exact:true});await compactPageTo(page,submit);await submit.click();
  await expect(page.locator('#wallet-form input[name=name]')).toBeFocused();await expect(page.locator('#wallet-form input[name=name]')).toBeInViewport({ratio:1});
  await page.locator('#wallet-form input[name=name]').fill('Restored');
  await compactPageTo(page,page.getByRole('button',{name:'More wallet options',exact:true}));await page.getByRole('button',{name:'More wallet options',exact:true}).click();
  for(const type of ['polyseed','hardware','create-watch','restore-backup','create-multisig']) {
    await compactPageTo(page,page.getByRole('combobox',{name:'Wallet type',exact:true}),true);await page.getByRole('combobox',{name:'Wallet type',exact:true}).selectOption(type);await visitCompactPages(page,true);
  }
});
test('compact split review cannot be skipped with Enter and resize never restarts authorization',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Send',exact:true}).first().click();
  await page.getByLabel('Recipient address').fill(address);await page.locator('input[name=amount]').fill('1');
  await page.evaluate(()=>{(window as any).__reviewExtra={parts:Array.from({length:16},(_,source)=>({source,amount:'62500000000',fee:'5000000',txid:String(source).repeat(64).slice(0,64)}))};});
  await page.getByRole('button',{name:'Review payment',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  const jump=page.getByRole('dialog').locator(':scope > .compact-pager select');await expect(jump.locator('option')).not.toHaveCount(1);
  const count=await jump.locator('option').count();await jump.selectOption(String(count-1));
  // A synthetic submit exercises the UI guard without satisfying credential validation.
  await page.locator('#confirm-form').evaluate(form=>form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='send'))).toEqual([]);
  await visitCompactPages(page,true);await page.setViewportSize({width:820,height:620});await visitCompactPages(page,true);
  await page.getByRole('dialog').getByRole('button',{name:'Switch to full view'}).click();
  await expect(page.locator('.review-values dt')).toHaveCount(20);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>['prepare','cancel'].includes(c.action)).map((c:any)=>c.action))).toEqual(['prepare']);
});
test('compact custom source allocation survives paging and submits only the chosen addresses',async({page})=>{
  const addresses=Array.from({length:20},(_,i)=>({...initial.addresses[1],index:i,label:'Source '+i}));
  await mock(page,false,false,'software','',false,{addresses});await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.locator('.compact-nav').getByRole('button',{name:'Send',exact:true}).click();await page.getByLabel('Recipient address').fill(address);await page.locator('input[name=amount]').fill('1.000000000001');
  await page.getByText('Transaction options',{exact:true}).click();
  await compactPageTo(page,page.getByRole('combobox',{name:'Spend from',exact:true}));await page.getByRole('combobox',{name:'Spend from',exact:true}).selectOption('multiple');
  await compactPageTo(page,page.getByRole('combobox',{name:'Allocation',exact:true}));await page.getByRole('combobox',{name:'Allocation',exact:true}).selectOption('custom');
  for(const [index,amount] of [[0,'0.3'],[19,'0.700000000001']]) {
    const box=page.locator(`input[name=sources][value="${index}"]`);await compactPageTo(page,box);await box.check();await page.getByLabel(`Amount from Source ${index}`,{exact:true}).fill(String(amount));
  }
  await visitCompactPages(page);await page.setViewportSize({width:820,height:620});await visitCompactPages(page);
  const review=page.getByRole('button',{name:'Review payment',exact:true});await compactPageTo(page,review);await review.click();
  const prepared=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.action==='prepare').payload);
  expect(prepared.sources).toEqual([0,19]);expect(prepared.allocation).toBe('custom');expect(prepared.shares).toEqual([{index:0,amount:'0.3'},{index:19,amount:'0.700000000001'}]);
  await visitCompactPages(page,true);expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='send'))).toEqual([]);
});
test('compact long source labels stay complete and reviewable without an oversized page',async({page})=>{
  const addresses=Array.from({length:16},(_,i)=>({...initial.addresses[1],index:i,label:'Label '+i+' '+ 'word '.repeat(14)}));
  await mock(page,false,false,'software','',false,{addresses});await page.goto('/');await page.getByRole('button',{name:'Send',exact:true}).first().click();
  await page.getByLabel('Recipient address').fill(address);await page.locator('input[name=amount]').fill('1');
  await page.evaluate(()=>{(window as any).__reviewExtra={sources:Array.from({length:16},(_,i)=>i)};});
  await page.getByRole('button',{name:'Review payment',exact:true}).click();const original=await page.locator('.review-values').textContent();
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});await visitCompactPages(page,true);
  await page.getByRole('dialog').getByRole('button',{name:'Switch to full view'}).click();await expect(page.locator('.review-values')).toHaveText(original!);
});
test('compact pagination initializes even when animation frames are suspended',async({page})=>{
  await mock(page,true);await page.addInitScript(()=>{localStorage.setItem('monero-by-astera:view','compact');window.requestAnimationFrame=()=>0;});
  await page.setViewportSize({width:720,height:540});await page.goto('/');
  await page.getByRole('button',{name:'Restore wallet',exact:true}).click();
  const pager=page.locator('main > .compact-pager');await expect(pager).toBeVisible();await assertCompactFits(page);
  await pager.getByRole('button',{name:'Next →'}).click();await expect(pager.locator('select')).toHaveValue('1');await assertCompactFits(page);
});

for (const view of ['full','compact']) {
  test(`${view} receive grid creates without labels and supports add/edit/clear afterward`,async({page})=>{
    await mock(page);await page.goto('/');
    if(view==='compact') {await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});}
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Receive',exact:true}).click();
    await page.locator('#request-amount').fill('0.123456789012');
    await page.getByRole('button',{name:'New address',exact:true}).click();
    const grid=page.getByRole('dialog',{name:'Choose receiving address',exact:true});await expect(grid).toBeVisible();
    await expect(page.locator('#receive-address-rows tr.selected')).toContainText('#2');
    await expect(page.locator('#receive-address-rows tr.selected code')).toHaveText('8'+'C'.repeat(94));
    await expect(grid.getByRole('textbox',{name:'Label',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='address').map((c:any)=>c.payload))).toEqual([{label:''}]);
    if(view==='compact') await assertCompactFits(page,true);
    await grid.getByRole('button',{name:'Add label for address 2',exact:true}).click();
    await page.getByRole('textbox',{name:'Label',exact:true}).fill('Coffee');await page.getByRole('button',{name:'Save label',exact:true}).click();
    await expect(page.locator('#receive-address-rows')).toContainText('Coffee');
    await page.getByRole('button',{name:'Edit label for address 2',exact:true}).click();await page.getByRole('textbox',{name:'Label',exact:true}).fill('Changed');await page.keyboard.press('Escape');
    await expect(page.locator('#receive-address-rows')).toContainText('Coffee');
    await page.getByRole('button',{name:'Edit label for address 2',exact:true}).click();await page.getByRole('textbox',{name:'Label',exact:true}).fill('');await page.getByRole('button',{name:'Save label',exact:true}).click();
    await expect(page.getByRole('button',{name:'Add label for address 2',exact:true})).toBeVisible();
    await page.screenshot({path:`work/receive-grid-${view}.png`});
    await page.getByRole('button',{name:'Receive at address 2',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('#receive-select')).toHaveAttribute('data-address-index','2');
    await expect(page.locator('#request-amount')).toHaveValue('0.123456789012');await expect(page.locator('#qr-caption')).toContainText('includes the requested amount');
    await expect(page.locator('.receive-card .full-address')).toHaveText('8'+'C'.repeat(94));
    await expect(page.locator('#qr')).toHaveAttribute('src',/^data:image/);
    if(view==='compact') await assertCompactFits(page);
    await page.screenshot({path:`work/receive-selected-${view}.png`});
  });
}
test('compact receiving grid searches full addresses and indices, retains edits through resize and exposes every row',async({page})=>{
  const addresses=Array.from({length:45},(_,i)=>({...initial.addresses[1],index:i,label:i===44?'Last label':'',address:'8'+String(i).padStart(2,'0')+'D'.repeat(92)}));
  await mock(page,false,false,'software','',false,{addresses});await page.goto('/');await page.getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});
  await page.locator('.compact-nav').getByRole('button',{name:'Receive',exact:true}).click();await page.getByRole('button',{name:'Choose receiving address',exact:true}).click();
  const seen=new Set<string>();await visitCompactPages(page,true,async()=>{
    await expect(page.getByRole('textbox',{name:'Search receiving addresses'})).toBeInViewport({ratio:1});
    await expect(page.getByRole('dialog').getByRole('button',{name:'New address',exact:true})).toBeInViewport({ratio:1});
    for(const index of await page.locator('#receive-address-rows tr:visible .receive-grid-index').allTextContents()) seen.add(index);
  });expect(seen.size).toBe(45);
  await page.getByRole('textbox',{name:'Search receiving addresses'}).fill('44');await expect(page.locator('#receive-address-rows tr')).toHaveCount(1);await expect(page.locator('#receive-address-rows tr')).toContainText('#44');
  await page.getByRole('button',{name:'Edit label for address 44',exact:true}).click();await page.getByRole('textbox',{name:'Label',exact:true}).fill('Preserved label draft');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to full view'}).click();await page.setViewportSize({width:1180,height:820});await expect(page.getByRole('textbox',{name:'Label',exact:true})).toHaveValue('Preserved label draft');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to compact view'}).click();await page.setViewportSize({width:720,height:540});await page.getByRole('button',{name:'Save label',exact:true}).click();await assertCompactFits(page,true);
  await page.getByRole('textbox',{name:'Search receiving addresses'}).fill(addresses[12].address);await expect(page.locator('#receive-address-rows tr')).toHaveCount(1);await page.locator('#receive-address-rows .receive-grid-index').click();
  await expect(page.locator('.receive-card .full-address')).toHaveText(addresses[12].address);
  await page.getByRole('button',{name:'Choose receiving address',exact:true}).click();await page.getByRole('textbox',{name:'Search receiving addresses'}).fill('not-present');await expect(page.getByText('No matching addresses.',{exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'New address',exact:true}).click();await expect(page.locator('#receive-address-rows tr.selected')).toContainText('#45');await expect(page.getByRole('button',{name:'Add label for address 45',exact:true})).toBeVisible();await assertCompactFits(page,true);
});
test('address creation serializes repeated clicks and fails without inventing an address',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Receive',exact:true}).first().click();await page.getByRole('button',{name:'Choose receiving address',exact:true}).click();
  await page.evaluate(()=>{(window as any).__delayAddress=true;(window as any).__addressError='Could not store the new address';});
  await page.getByRole('dialog').getByRole('button',{name:'New address',exact:true}).click();
  await page.evaluate(()=>{document.querySelector<HTMLButtonElement>('.modal [data-action="new-address"]')!.click();});
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.action==='address').length)).toBe(1);
  await page.evaluate(()=>{(window as any).__finishAddress();});await expect(page.getByRole('alert')).toContainText('Could not store');await expect(page.locator('#receive-address-rows tr')).toHaveCount(2);await expect(page.locator('#receive-select')).toHaveAttribute('data-address-index','1');
  await page.evaluate(()=>{(window as any).__delayAddress=false;(window as any).__addressError='';});await page.getByRole('dialog').getByRole('button',{name:'New address',exact:true}).click();await expect(page.locator('#receive-address-rows tr')).toHaveCount(3);
});
test('locking during address creation prevents a late response from restoring the grid or receive amount',async({page})=>{
  await mock(page);await page.goto('/');await page.getByRole('button',{name:'Receive',exact:true}).first().click();await page.locator('#request-amount').fill('0.5');await page.evaluate(()=>{(window as any).__delayAddress=true;});await page.getByRole('button',{name:'New address',exact:true}).click();
  await page.keyboard.press('Meta+l');await expect(page.getByRole('button',{name:'Unlock wallet',exact:true})).toBeVisible();await page.evaluate(()=>{(window as any).__finishAddress();});await expect(page.getByRole('alert')).toContainText('Wallet session changed');await expect(page.locator('#receive-address-rows')).toHaveCount(0);await expect(page.locator('#request-amount')).toHaveCount(0);
});
