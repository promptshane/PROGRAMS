import assert from "node:assert/strict";
import test from "node:test";
import { parseGithubAuthStatusResult } from "../src/main/services/git-service.ts";

test("parseGithubAuthStatusResult preserves active GitHub account errors", () => {
  const status = parseGithubAuthStatusResult(
    {
      code: 0,
      stdout: JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "error",
              error: "Get \"https://api.github.com/\": dial tcp: lookup api.github.com: no such host",
              active: true,
              login: "promptshane",
              tokenSource: "default",
            },
          ],
        },
      }),
      stderr: "",
    },
    "gh version 2.83.1",
  );

  assert.equal(status.available, true);
  assert.equal(status.loggedIn, false);
  assert.equal(status.username, "promptshane");
  assert.equal(status.tokenSource, "default");
  assert.equal(status.errorMessage, "Get \"https://api.github.com/\": dial tcp: lookup api.github.com: no such host");
});

test("parseGithubAuthStatusResult preserves failed gh auth status output", () => {
  const status = parseGithubAuthStatusResult(
    {
      code: 1,
      stdout: "",
      stderr: "You are not logged into any GitHub hosts. Run gh auth login.",
    },
    "gh version 2.83.1",
  );

  assert.equal(status.available, true);
  assert.equal(status.loggedIn, false);
  assert.equal(status.username, null);
  assert.equal(status.errorMessage, "You are not logged into any GitHub hosts. Run gh auth login.");
});
