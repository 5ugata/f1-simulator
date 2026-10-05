import {browserOptions} from './browser-options.mjs';
import { chromium } from 'playwright';

const origin = process.env.CAR_PREVIEW_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/tests/car-preview.html`);
  await page.waitForFunction(() => window.ready);
  for (const camera of ['front', 'side', 'rear', 'cockpit']) {
    await page.evaluate(mode => window.setCamera(mode), camera);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `artifacts/apex-car-${camera}.png` });
    console.log(camera, await page.evaluate(() => {
      let meshes = 0, triangles = 0;
      car.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
      return { meshes, triangles, position: car.cockpit.position.toArray() };
    }));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('All car views rendered without browser errors.');
} finally { await browser.close(); }
