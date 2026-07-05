import { chromium } from "playwright";

const SITES = [
  "https://www.bbc.com",
  "https://www.nytimes.com",
];

async function main() {
  const browser = await chromium.launch({ headless: false });

  for (const site of SITES) {
    console.log(`\n--- ${site} ---`);
    const page = await browser.newPage();
    await page.goto(site, { waitUntil: "networkidle", timeout: 30000 });

    const buttons = page.locator("button");
    const count = await buttons.count();

    const cookieTexts = ["accept", "allow", "agree", "consent", "got it", "ok"];
    let dismissed = false;

    for (let i = 0; i < count; i++) {
      const text = (await buttons.nth(i).textContent())?.toLowerCase() ?? "";
      if (cookieTexts.some((t) => text.includes(t))) {
        console.log(`Clicking: "${text.trim()}"`);
        await buttons.nth(i).click();
        await page.waitForTimeout(1000);
        dismissed = true;
        break;
      }
    }

    if (!dismissed) {
      console.log("No cookie banner detected");
    }

    await page.close();
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
