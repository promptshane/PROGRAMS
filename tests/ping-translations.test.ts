import assert from "node:assert/strict";
import test from "node:test";
import { getDirectorMetadata } from "../src/shared/director-metadata.ts";
import {
  buildPingLifecycleTranslationMetadata,
  buildPingStatusTranslationMetadata,
} from "../src/shared/ping-translations.ts";

test("Ping status translation metadata stays canonical", () => {
  const success = buildPingStatusTranslationMetadata("success");
  const blocked = buildPingStatusTranslationMetadata("blocked");

  assert.deepEqual(success, {
    type: "ping-translation",
    kind: "status",
    status: "success",
    zhResponse: "已完成。修改已保存。",
    enTranslation: "Done. Changes saved.",
  });
  assert.deepEqual(blocked, {
    type: "ping-translation",
    kind: "status",
    status: "blocked",
    zhResponse: "被阻塞。需要处理问题。",
    enTranslation: "Blocked. Need fix issue.",
  });
});

test("Ping lifecycle translation metadata covers intro and outro", () => {
  const metadata = getDirectorMetadata("programming-director");
  const intro = buildPingLifecycleTranslationMetadata("intro", metadata.introMessage);
  const outro = buildPingLifecycleTranslationMetadata("outro", metadata.outroMessage);

  assert.deepEqual(intro, {
    type: "ping-translation",
    kind: "lifecycle",
    phase: "intro",
    zhResponse: "我来看看实现……",
    enTranslation: metadata.introMessage,
  });
  assert.deepEqual(outro, {
    type: "ping-translation",
    kind: "lifecycle",
    phase: "outro",
    zhResponse: "我先退出代码线程了。",
    enTranslation: metadata.outroMessage,
  });
});
