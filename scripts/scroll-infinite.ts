import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto("https://the-internet.herokuapp.com/infinite_scroll", {
    waitUntil: "networkidle",
  });

  const itemCount = async () =>
    await page.locator(".jscroll-added").count();

  let before = await itemCount();
  console.log("Items before scroll:", before);

  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const after = await itemCount();
    console.log(`Scroll ${i}: ${before} -> ${after} items`);
    before = after;
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
