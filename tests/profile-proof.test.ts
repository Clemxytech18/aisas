import { test } from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace, draftMessages, validateMessages } from "../src/domain";
import {
  prepareProfile,
  optionalProofUrl,
  withProfileProof,
  sequenceProfile,
  SEQUENCE_INSTRUCTIONS,
} from "../src/profile-proof";
test("proof links are optional for legacy and new audience profiles", () => {
  const profile = demoWorkspace().profiles[0];
  assert.equal(prepareProfile(profile).demo_video_url, "");
  assert.equal(
    prepareProfile({ ...profile, demo_video_url: "", work_sample_url: "" })
      .work_sample_url,
    "",
  );
  assert.throws(() => prepareProfile({ ...profile, usp: " " }), /Complete/);
});
test("reference URL validation allows public web links and rejects executable schemes or credentials", () => {
  assert.equal(
    optionalProofUrl("www.example.com/work", "work sample"),
    "https://www.example.com/work",
  );
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.com",
    "https://bad example.com",
    "https://example.com/" + "x".repeat(2048),
  ])
    assert.throws(() => optionalProofUrl(value, "video demo"));
});
test("optional references appear in the first demo message without duplicates or follow-up changes", () => {
  const profile = {
    ...demoWorkspace().profiles[0],
    demo_video_url: "https://example.com/demo",
    work_sample_url: "https://example.com/work",
  };
  const messages = draftMessages(profile);
  assert.equal(validateMessages(messages), true);
  for (const url of [profile.demo_video_url, profile.work_sample_url])
    assert.ok(messages[0].body.includes(url));
  assert.ok(
    messages.slice(1).every((m) => !m.body.includes(profile.demo_video_url)),
  );
  assert.deepEqual(withProfileProof(messages, profile), messages);
  const alreadyMentioned = messages.map((m) => ({ ...m }));
  alreadyMentioned[0].body = "Here is a demo: " + profile.demo_video_url;
  const supplemented = withProfileProof(alreadyMentioned, profile);
  assert.equal(
    supplemented[0].body.split(profile.demo_video_url).length - 1,
    1,
  );
  assert.ok(supplemented[0].body.includes(profile.work_sample_url));
  assert.equal(
    alreadyMentioned[0].body.includes(profile.work_sample_url),
    false,
  );
});
test("AI context uses reference links without sending workspace metadata or claiming to inspect content", () => {
  const profile = {
    ...demoWorkspace().profiles[0],
    demo_video_url: "https://example.com/demo",
    work_sample_url: "https://example.com/work",
    owner_id: "private-owner",
    created_at: "private-timestamp",
  };
  const context = sequenceProfile(profile);
  assert.equal(context.demo_video_url, profile.demo_video_url);
  assert.equal(context.work_sample_url, profile.work_sample_url);
  for (const key of ["id", "owner_id", "created_at", "name"])
    assert.equal(key in context, false);
  assert.match(
    SEQUENCE_INSTRUCTIONS,
    /do not claim to have watched or reviewed/,
  );
});
