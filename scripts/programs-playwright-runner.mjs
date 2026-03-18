#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const parseArgs = (argv) => {
  const options = {
    url: "",
    outputDir: "",
    actionsJson: "[]",
    settleMs: 1200,
    headless: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--url") {
      options.url = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--output-dir") {
      options.outputDir = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--actions-json") {
      options.actionsJson = argv[index + 1] ?? "[]";
      index += 1;
    } else if (value === "--settle-ms") {
      options.settleMs = Number(argv[index + 1] ?? "1200") || 1200;
      index += 1;
    } else if (value === "--headed") {
      options.headless = false;
    }
  }

  return options;
};

const saveJson = async (filePath, value) => {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
};

const saveText = async (filePath, value) => {
  await writeFile(filePath, value, "utf8");
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url || !options.outputDir) {
    throw new Error("Missing required --url or --output-dir.");
  }

  await mkdir(options.outputDir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const screenshots = [];
  const consoleMessages = [];
  const pageErrors = [];
  const actions = JSON.parse(options.actionsJson);

  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(`${message.type()}: ${text}`);
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const capture = async (label) => {
    const fileName = `${String(screenshots.length + 1).padStart(2, "0")}-${label}.png`;
    const filePath = join(options.outputDir, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    screenshots.push(filePath);
  };

  await page.goto(options.url, { waitUntil: "networkidle" });
  await delay(options.settleMs);
  await capture("initial");

  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || typeof action !== "object") {
      continue;
    }

    if (action.type === "wait") {
      await delay(Number(action.ms) || options.settleMs);
    } else if (action.type === "click" && action.selector) {
      await page.locator(action.selector).click();
    } else if (action.type === "fill" && action.selector) {
      await page.locator(action.selector).fill(String(action.value ?? ""));
    } else if (action.type === "press" && action.key) {
      if (action.selector) {
        await page.locator(action.selector).press(action.key);
      } else {
        await page.keyboard.press(action.key);
      }
    } else if (action.type === "hover" && action.selector) {
      await page.locator(action.selector).hover();
    }

    await delay(options.settleMs);
    await capture(action.type || "step");
  }

  const textSnapshot = await page.evaluate(() => document.body?.innerText ?? "");
  const renderGameText = await page.evaluate(() => {
    if (typeof window.render_game_to_text === "function") {
      try {
        return String(window.render_game_to_text());
      } catch (error) {
        return `render_game_to_text failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return "";
  });

  await saveJson(join(options.outputDir, "screenshots.json"), screenshots);
  await saveJson(join(options.outputDir, "console.json"), consoleMessages);
  await saveJson(join(options.outputDir, "page-errors.json"), pageErrors);
  await saveText(join(options.outputDir, "text-snapshot.txt"), textSnapshot);
  await saveText(join(options.outputDir, "render-game-to-text.txt"), renderGameText);
  await browser.close();

  process.stdout.write(
    JSON.stringify(
      {
        screenshots,
        consoleMessages,
        pageErrors,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
