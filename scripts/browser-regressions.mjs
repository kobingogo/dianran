import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';

const require = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
try {
    const tests = process.argv.slice(3);
    for (const name of tests.length ? tests : ['copy', 'reliability', 'workflow', 'video-recovery', 'delivery', 'agent-plan', 'retry', 'workflow-failure', 'workflow-unknown', 'agent-skill-editor', 'webdav']) {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        let service, webdavURL;
        const logs = [];
        page.on('console', message => logs.push(`${message.type()}: ${message.text()}`));
        page.on('pageerror', error => logs.push(error.stack));
        const resultFile = `.playwright-cli/${name}.result.json`;
        try {
            if (name === 'webdav') {
                service = fork('output/playwright/webdav-server.mjs', [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
                webdavURL = await new Promise((resolve, reject) => {
                    service.once('message', value => resolve(value.url));
                    service.once('error', reject);
                    service.once('exit', code => reject(new Error(`WebDAV fixture exited before readiness: ${code}`)));
                });
            }
            await page.goto('http://127.0.0.1:4317/');
            const filename = `output/playwright/${name}-regression.js`;
            const fixture = vm.runInNewContext(`(${await fs.readFile(filename, 'utf8')})`, { URL, Buffer, crypto: webcrypto, webdavURL }, { filename });
            const result = await fixture(page);
            if (!result) throw new Error(`${name} returned no result`);
            if (result.failure) throw new Error(result.failure);
            await fs.writeFile(resultFile, JSON.stringify(result));
            console.log(resultFile, JSON.stringify(result));
        } catch (error) {
            await fs.writeFile(resultFile, JSON.stringify({ error: error.stack }));
            await page.screenshot({ path: `output/playwright/evidence/${name}-failure.png` }).catch(() => {});
            failed = true;
            console.error(`${name}:`, error);
        } finally {
            if (service && service.exitCode === null && service.signalCode === null) {
                const exited = once(service, 'exit'); service.kill('SIGTERM'); await exited;
            }
            await fs.writeFile(`output/playwright/evidence/${name}.log`, logs.join('\n'));
            await context.close();
        }
    }
} finally {
    await browser.close();
}
if (failed) process.exitCode = 1;
