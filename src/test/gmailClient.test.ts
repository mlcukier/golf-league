import { describe, expect, it } from "vitest";
import { encodeHeaderValue } from "../email/gmailClient.js";

/**
 * Regression test for a real bug: sendEmail/sendThreadReply used to put a
 * subject's raw UTF-8 bytes straight into the Subject header. Headers are
 * ASCII-only per RFC 5322, so an em dash (as in "Results — Event Name",
 * which every digest subject contains) rendered as mojibake ("Ã¢Â€Â”") in
 * the actual inbox. The fix is RFC 2047 encoded-word encoding for any
 * non-ASCII header value.
 */
describe("encodeHeaderValue", () => {
  it("leaves a pure-ASCII value untouched", () => {
    expect(encodeHeaderValue("Reminder: pick BMW Championship before it starts")).toBe(
      "Reminder: pick BMW Championship before it starts"
    );
  });

  it("RFC 2047 encodes a value with an em dash, and it decodes back losslessly", () => {
    const subject = "Results — The Sony Open in Hawaii";
    const encoded = encodeHeaderValue(subject);
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);

    const b64 = encoded.slice("=?UTF-8?B?".length, -"?=".length);
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(subject);
  });
});
