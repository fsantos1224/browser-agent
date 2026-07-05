import { chromium } from "playwright";

const SITE = "https://the-internet.herokuapp.com/login";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("Navigating to", SITE);
  await page.goto(SITE, { waitUntil: "networkidle" });

  console.log("Typing username...");
  await page.fill("#username", "tomsmith");

  console.log("Typing password...");
  await page.fill("#password", "SuperSecretPassword!");

  console.log("Clicking login...");
  await page.click("button[type=submit]");
  await page.waitForSelector(".flash.success");

  const message = await page.textContent("#flash");
  console.log("Login result:", message?.trim());

  console.log("Current URL:", page.url());

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
