import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
try {
    const tests = process.argv.slice(3);
    for (const name of tests.length ? tests : ['copy', 'reliability', 'workflow', 'video-recovery', 'delivery', 'agent-plan', 'retry', 'workflow-failure', 'workflow-unknown', 'agent-skill-editor', 'submission-receipts']) {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const logs = [];
        page.on('console', message => logs.push(`${message.type()}: ${message.text()}`));
        page.on('pageerror', error => logs.push(error.stack));
        const resultFile = `.playwright-cli/${name}.result.json`;
        try {
            await page.goto('http://127.0.0.1:4317/');
            const filename = `output/playwright/${name}-regression.js`;
            const fixture = vm.runInNewContext(`(${await fs.readFile(filename, 'utf8')})`, { URL, Buffer }, { filename });
            const result = await fixture(page);
            if (!result) throw new Error(`${name} returned no result`);
            await fs.writeFile(resultFile, JSON.stringify(result));
            console.log(resultFile, JSON.stringify(result));
        } catch (error) {
            await fs.writeFile(resultFile, JSON.stringify({ error: error.stack }));
            await page.screenshot({ path: `output/playwright/evidence/${name}-failure.png` }).catch(() => {});
            failed = true;
            console.error(`${name}:`, error);
        } finally {
            await fs.writeFile(`output/playwright/evidence/${name}.log`, logs.join('\n'));
            await context.close();
        }
    }
} finally {
    await browser.close();
}
if (failed) process.exitCode = 1;
