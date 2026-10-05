import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';

const origin = process.env.WORLD_PREVIEW_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  for (const [name, distance, mode] of [['grid', -50, 'driver'], ['rettifilo', 590, 'driver'], ['lesmo', 2120, 'driver'], ['ascari', 3600, 'aerial']]) {
    await page.goto(`${origin}/tests/world-preview.html?distance=${distance}&mode=${mode}`);
    await page.waitForFunction(() => window.ready, {timeout: 60000});
    await page.waitForTimeout(1000);
    await page.screenshot({path: `artifacts/monza-world-${name}.png`, timeout: 90000});
    console.log(name, await page.evaluate(() => ({render: view.renderer.info.render, trees: world.root.userData.track.trees})));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Four environment views rendered without browser errors.');
} finally {await browser.close();}
