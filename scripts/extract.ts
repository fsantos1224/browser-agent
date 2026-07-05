import { chromium } from "playwright";

const SITE = "https://the-internet.herokuapp.com/tables";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("Navigating to", SITE);
  await page.goto(SITE, { waitUntil: "networkidle" });

  const rows = page.locator("#table1 tbody tr");
  const count = await rows.count();
  console.log(`Found ${count} rows in table`);

  const data: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator("td");
    const row = {
      last: await cells.nth(0).textContent(),
      first: await cells.nth(1).textContent(),
      email: await cells.nth(2).textContent(),
      due: await cells.nth(3).textContent(),
      web: await cells.nth(4).textContent(),
    };
    data.push(row);
    console.log(`  [${i + 1}] ${row.last}, ${row.first} — $${row.due}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
