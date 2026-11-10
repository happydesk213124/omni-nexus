/**
 * One browser per test file, loaded ahead of the file by tools/run-tests.mjs (`--import`).
 *
 * Most browser tests launch their own browser and close it. A launch is most of a second on an idle PC and several
 * with six files running: a file of eighteen such tests spent half its time launching (35 s alone, 17 s with this).
 * Here `chromium.launch` hands every test of the file the same browser (one per set of launch options), and the
 * `close()` a test calls closes what that test opened (its contexts and their pages), not the browser. A test still
 * gets what it asked for: a new context has its own storage, permissions and routes, as a new browser's did.
 *
 * The browser itself closes once nobody has held it for a moment (LINGER_MS): the next test of a file asks within
 * milliseconds of the last one's close, and after the file's last test nobody asks, so the process can end. The
 * end of the file's tests is not a signal to go by: node:test runs a root `after` when the tests declared so far
 * are done, and a file that awaits something between its tests (a bundle built at the top level) declares more
 * after that. A browser closed on that hook's word left the later tests' browser open, and the file never ended.
 *
 * A file that never mentions playwright is left alone: playwright is not even loaded for it.
 * Run without this (node --test tests/x.test.mjs), each test launches its own browser as before.
 */
import { readFileSync } from 'node:fs';

const LINGER_MS = 400;
// Only in a test file's own process (the runner that starts them is given the same flag and passes it on).
const file = process.env.NODE_TEST_CONTEXT ? process.argv.find(arg => arg.endsWith('.test.mjs')) : '';
let uses = false;
try { uses = !!file && readFileSync(file, 'utf8').includes('playwright'); } catch { /* not a file we can read: left alone */ }

if (uses) {
  const { chromium } = await import('playwright');
  const launch = chromium.launch.bind(chromium);
  /** Per set of launch options: the browser (starting or up), how many callers hold it, and its closing timer. */
  const shared = new Map();
  const letGo = slot => {
    if (--slot.held > 0) return;
    // Not kept alive for: a file with nothing left to run ends when this has fired and the browser is gone.
    slot.timer = setTimeout(() => {
      if (slot.held > 0) return;
      shared.delete(slot.key);
      void slot.browser.then(browser => browser.close()).catch(() => {});
    }, LINGER_MS);
  };
  chromium.launch = async (options = {}) => {
    const key = JSON.stringify(options);
    let slot = shared.get(key);
    if (slot && !(await slot.browser.catch(() => null))?.isConnected()) { shared.delete(key); slot = undefined; }
    if (!slot) { slot = { key, browser: launch(options), held: 0, timer: undefined }; shared.set(key, slot); }
    clearTimeout(slot.timer);
    slot.held++;
    let browser;
    try { browser = await slot.browser; } catch (error) { slot.held--; shared.delete(key); throw error; }
    // What this caller opens, so its close() takes that and nothing of another test's.
    const mine = new Set();
    let closed = false;
    return new Proxy(browser, {
      get(target, name) {
        if (name === 'close') return async () => {
          const open = [...mine]; mine.clear();
          await Promise.all(open.map(context => context.close().catch(() => {})));
          if (!closed) { closed = true; letGo(slot); }
        };
        if (name === 'newContext') return async (...args) => { const context = await target.newContext(...args); mine.add(context); return context; };
        // A page opened on the browser has a context of its own, closed with it.
        if (name === 'newPage') return async (...args) => { const page = await target.newPage(...args); mine.add(page.context()); return page; };
        if (name === 'contexts') return () => [...mine];
        if (name === 'isConnected') return () => !closed && target.isConnected();
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}
