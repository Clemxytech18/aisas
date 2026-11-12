import { test } from "node:test";
import assert from "node:assert/strict";
import { emailBodyHtml, prepareSignature } from "../src/email-signature";
import { sendPayload } from "../src/campaign-delivery";
import { demoWorkspace, draftMessages } from "../src/domain";
test("legacy profiles remain valid; optional signatory requires a sender and safe image URL", () => {
  assert.deepEqual(prepareSignature({}), {
    sender_name: "",
    signature_text: "",
    signature_image_url: "",
  });
  assert.throws(
    () => prepareSignature({ signature_text: "Company" }),
    /sender name/,
  );
  for (const signature_image_url of [
    "javascript:alert(1)",
    "data:image/svg+xml,bad",
    "http://example.com/image",
    "https://user:password@example.com/image",
  ])
    assert.throws(() =>
      prepareSignature({ sender_name: "Alex", signature_image_url }),
    );
  assert.throws(() => prepareSignature({ sender_name: "Alex\nInjected" }));
  assert.throws(() => prepareSignature({ signature_text: "x".repeat(2001) }));
});
test("all four campaign messages append sender, text then image, safely escaped before tracking pixel", () => {
  const signature = {
    sender_name: "Alex & Co",
    signature_text: "Founder <team>\nExample Ltd",
    signature_image_url: "https://example.com/signature.jpg?x=1&y=2",
  };
  const messages = draftMessages(demoWorkspace().profiles[0]);
  for (const message of messages) {
    const body = sendPayload(
      {
        ...signature,
        message,
        lead: { contact_name: "Sam", company: "Practice" },
        delivery_id: "opaque",
      },
      "campaign",
      "https://example.com/open",
    ).body;
    assert.ok(body.indexOf("Alex &amp; Co") > body.indexOf("Practice"));
    assert.ok(
      body.indexOf("Founder &lt;team&gt;") > body.indexOf("Alex &amp; Co"),
    );
    assert.ok(
      body.indexOf('alt="Email signatory"') >
        body.indexOf("Founder &lt;team&gt;"),
    );
    assert.ok(
      body.indexOf("?token=opaque") > body.indexOf('alt="Email signatory"'),
    );
    assert.match(body, /x=1&amp;y=2/);
    assert.doesNotMatch(body, /Your name/);
  }
});
test("optional image/text may independently be omitted and old application placeholder is removed", () => {
  const nameOnly = emailBodyHtml("Message\n\nBest,\nYour name", {
    sender_name: "Alex",
  });
  assert.equal(nameOnly, "Message<br><br>Alex");
  assert.equal(emailBodyHtml("Hello <Sam>", {}), "Hello &lt;Sam&gt;");
  assert.equal(
    emailBodyHtml("Hello", { sender_name: "Alex", signature_text: "Founder" }),
    "Hello<br><br>Alex<br>Founder",
  );
  assert.match(
    emailBodyHtml("Hello", {
      sender_name: "Alex",
      signature_image_url: "https://example.com/image.jpg",
    }),
    /Alex<br><img/,
  );
});
