import { test } from "node:test";
import assert from "node:assert/strict";
import { xmr, amountValid, escape } from "../../src/types.ts";
test("amount formatting preserves atomic precision above JS safe integers", () => {
  assert.equal(xmr("9008123456789012"), "9008.123456789012");
  assert.equal(xmr("1"), "0.000000000001");
  assert.equal(xmr("1000000000000"), "1");
  assert.equal(xmr("0"), "0");
});
test("input rejects non-decimal, zero, negative, exponent and excess precision", () => {
  for (const input of [
    "",
    "0",
    "0.000000000000",
    "1e3",
    "-1",
    "Infinity",
    "1.0000000000001",
    "1.2.3",
    " 1",
    "01",
    "1.",
  ])
    assert.equal(amountValid(input), false, input);
  for (const input of ["1", "0.000000000001", "19.421999999999"])
    assert.equal(amountValid(input), true, input);
});
test("labels, node URLs and RPC messages cannot inject HTML", () => {
  assert.equal(
    escape('<img src=x onerror="evil()">'),
    "&lt;img src=x onerror=&quot;evil()&quot;&gt;",
  );
  assert.equal(escape("A&B's"), "A&amp;B&#39;s");
});
test("unsigned 64-bit limits agree with the wallet engine", () => {
  assert.equal(amountValid("18446744.073709551615"), true);
  assert.equal(xmr("18446744073709551615"), "18446744.073709551615");
  assert.equal(amountValid("18446744.073709551616"), false);
  assert.equal(amountValid("18446745"), false);
  assert.equal(amountValid("9".repeat(1000)), false);
});
