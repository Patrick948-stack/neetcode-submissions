import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `file://${resolve(__dirname, '../live-captions.html')}`;

// ---------------------------------------------------------------------------
// Mock Web Speech API
//
// Injected via addInitScript so it runs before the page's own script, which
// captures `window.SpeechRecognition` at module-evaluation time.
//
// The active recognition instance is stored at window.__mockRecognition.
// Tests trigger recognition events from page.evaluate() by calling the
// instance's _fireXxx helpers directly.
//
// Design note: mock.stop() does NOT auto-fire onend. That mirrors real
// browser behaviour (onend is async) and lets tests control when it fires.
// ---------------------------------------------------------------------------
function mockSpeechApi() {
  class MockSpeechRecognition {
    constructor() {
      window.__mockRecognition = this;
    }

    start() {
      window.__startCount = (window.__startCount || 0) + 1;
      if (this.onstart) this.onstart();
    }

    stop() {
      window.__stopCount = (window.__stopCount || 0) + 1;
      // intentionally does not fire onend; tests control timing
    }

    // ---- test helpers called from page.evaluate() --------------------------

    // transcripts: Array<{ text: string, isFinal: boolean }>
    // resultIndex: where in the results array the new entries start
    _fireResult({ resultIndex, transcripts }) {
      // Build a results array that mirrors SpeechRecognitionResultList layout:
      //   results[i]       → array-like with isFinal flag
      //   results[i][0]    → { transcript }
      const results = transcripts.map(({ text, isFinal }) => {
        const item = [{ transcript: text }];
        item.isFinal = isFinal;
        return item;
      });
      if (this.onresult) this.onresult({ resultIndex, results });
    }

    _fireError(errorCode) {
      if (this.onerror) this.onerror({ error: errorCode });
    }

    _fireEnd() {
      if (this.onend) this.onend();
    }
  }

  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
  window.__startCount = 0;
  window.__stopCount = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startListening(page) {
  await page.click('#toggle-btn');
}

async function stopListening(page) {
  await page.click('#toggle-btn');
}

// Fire a single final result through the active recognition instance.
async function fireFinal(page, text, resultIndex = 0) {
  await page.evaluate(
    ({ text, resultIndex }) =>
      window.__mockRecognition._fireResult({
        resultIndex,
        transcripts: [{ text, isFinal: true }],
      }),
    { text, resultIndex }
  );
}

// Fire a single interim result.
async function fireInterim(page, text) {
  await page.evaluate(
    (text) =>
      window.__mockRecognition._fireResult({
        resultIndex: 0,
        transcripts: [{ text, isFinal: false }],
      }),
    text
  );
}

// ===========================================================================

test.describe('live-captions', () => {

  // -------------------------------------------------------------------------
  test.describe('initial state', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
    });

    test('shows a Start button with no active class', async ({ page }) => {
      await expect(page.locator('#toggle-btn')).toHaveText('Start');
      await expect(page.locator('#toggle-btn')).not.toHaveClass(/active/);
    });

    test('displays the idle status message', async ({ page }) => {
      await expect(page.locator('#status-text')).toHaveText('Tap Start to begin');
    });

    test('dot has no listening animation', async ({ page }) => {
      await expect(page.locator('#dot')).not.toHaveClass(/listening/);
    });

    test('transcript areas are empty', async ({ page }) => {
      await expect(page.locator('#final-text')).toHaveText('');
      await expect(page.locator('#interim-text')).toHaveText('');
    });

    test('error banner is hidden', async ({ page }) => {
      await expect(page.locator('#error-msg')).toBeHidden();
    });
  });

  // -------------------------------------------------------------------------
  test.describe('unsupported browser', () => {
    test.beforeEach(async ({ page }) => {
      // Remove the API so the page's feature-detect path triggers.
      await page.addInitScript(() => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
      });
      await page.goto(PAGE_URL);
    });

    test('shows a browser-support error message', async ({ page }) => {
      await expect(page.locator('#error-msg')).toBeVisible();
      await expect(page.locator('#error-msg')).toContainText('not supported');
    });

    test('disables the Start button', async ({ page }) => {
      await expect(page.locator('#toggle-btn')).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  test.describe('starting recognition', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
    });

    test('button changes to Stop with active styling', async ({ page }) => {
      await expect(page.locator('#toggle-btn')).toHaveText('Stop');
      await expect(page.locator('#toggle-btn')).toHaveClass(/active/);
    });

    test('status text switches to Listening', async ({ page }) => {
      await expect(page.locator('#status-text')).toHaveText('Listening...');
    });

    test('dot gains the listening class', async ({ page }) => {
      await expect(page.locator('#dot')).toHaveClass(/listening/);
    });

    test('recognition.start() is called exactly once', async ({ page }) => {
      expect(await page.evaluate(() => window.__startCount)).toBe(1);
    });

    test('recognition is configured for continuous interim results in en-US', async ({ page }) => {
      const cfg = await page.evaluate(() => ({
        continuous: window.__mockRecognition.continuous,
        interimResults: window.__mockRecognition.interimResults,
        lang: window.__mockRecognition.lang,
        maxAlternatives: window.__mockRecognition.maxAlternatives,
      }));

      expect(cfg.continuous).toBe(true);
      expect(cfg.interimResults).toBe(true);
      expect(cfg.lang).toBe('en-US');
      expect(cfg.maxAlternatives).toBe(1);
    });

    test('any pre-existing error banner is cleared on start', async ({ page }) => {
      // Force an error state, then restart.
      await page.evaluate(() => window.__mockRecognition._fireError('not-allowed'));
      await page.evaluate(() => window.__mockRecognition._fireEnd());

      // Error visible; now click Start again.
      await startListening(page);
      await expect(page.locator('#error-msg')).toBeHidden();
    });
  });

  // -------------------------------------------------------------------------
  test.describe('stopping recognition (user-initiated)', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
      await stopListening(page);
    });

    test('button returns to Start without active class', async ({ page }) => {
      await expect(page.locator('#toggle-btn')).toHaveText('Start');
      await expect(page.locator('#toggle-btn')).not.toHaveClass(/active/);
    });

    test('status text changes to Stopped', async ({ page }) => {
      await expect(page.locator('#status-text')).toHaveText('Stopped');
    });

    test('dot loses the listening class', async ({ page }) => {
      await expect(page.locator('#dot')).not.toHaveClass(/listening/);
    });

    test('recognition.stop() is called', async ({ page }) => {
      expect(await page.evaluate(() => window.__stopCount)).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  test.describe('transcript display', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
    });

    test('interim result appears in interim-text, not final-text', async ({ page }) => {
      await fireInterim(page, 'still thinking');

      await expect(page.locator('#interim-text')).toHaveText('still thinking');
      await expect(page.locator('#final-text')).toHaveText('');
    });

    test('final result moves to final-text and clears interim', async ({ page }) => {
      await fireFinal(page, 'hello world');

      await expect(page.locator('#final-text')).toContainText('hello world');
      await expect(page.locator('#interim-text')).toHaveText('');
    });

    test('multiple final results accumulate in order', async ({ page }) => {
      await fireFinal(page, 'first sentence');
      await fireFinal(page, 'second sentence');

      const text = await page.locator('#final-text').textContent();
      expect(text.indexOf('first sentence')).toBeLessThan(text.indexOf('second sentence'));
    });

    test('a batch event can contain both a final and an interim result', async ({ page }) => {
      // Simulate one event where results[0] is final and results[1] is interim.
      await page.evaluate(() =>
        window.__mockRecognition._fireResult({
          resultIndex: 0,
          transcripts: [
            { text: 'confirmed part', isFinal: true },
            { text: 'still speaking', isFinal: false },
          ],
        })
      );

      await expect(page.locator('#final-text')).toContainText('confirmed part');
      await expect(page.locator('#interim-text')).toHaveText('still speaking');
    });

    test('interim-text is cleared when onend fires', async ({ page }) => {
      await fireInterim(page, 'mid-sentence');
      await expect(page.locator('#interim-text')).toHaveText('mid-sentence');

      await page.evaluate(() => window.__mockRecognition._fireEnd());
      await expect(page.locator('#interim-text')).toHaveText('');
    });

    test('buffer is trimmed when it exceeds 1500 characters', async ({ page }) => {
      // 8 × 201 chars (200-char chunk + space appended by handler) = 1608 chars
      // which trips the >1500 guard and slices to 1200.
      const chunk = 'a'.repeat(200);
      await page.evaluate((chunk) => {
        for (let i = 0; i < 8; i++) {
          window.__mockRecognition._fireResult({
            resultIndex: 0,
            transcripts: [{ text: chunk, isFinal: true }],
          });
        }
      }, chunk);

      const text = await page.locator('#final-text').textContent();
      expect(text.length).toBeLessThanOrEqual(1200);
    });
  });

  // -------------------------------------------------------------------------
  test.describe('error handling', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
    });

    test('no-speech error is silent — no banner, recognition keeps running', async ({ page }) => {
      await page.evaluate(() => window.__mockRecognition._fireError('no-speech'));

      await expect(page.locator('#error-msg')).toBeHidden();
      await expect(page.locator('#toggle-btn')).toHaveText('Stop');
    });

    test('not-allowed error shows a permission error banner', async ({ page }) => {
      await page.evaluate(() => {
        window.__mockRecognition._fireError('not-allowed');
        // Simulate the browser firing onend after stop() is called internally.
        window.__mockRecognition._fireEnd();
      });

      await expect(page.locator('#error-msg')).toBeVisible();
      await expect(page.locator('#error-msg')).toContainText('permission');
    });

    test('not-allowed error transitions button back to Start', async ({ page }) => {
      await page.evaluate(() => {
        window.__mockRecognition._fireError('not-allowed');
        window.__mockRecognition._fireEnd();
      });

      await expect(page.locator('#toggle-btn')).toHaveText('Start');
      await expect(page.locator('#toggle-btn')).not.toHaveClass(/active/);
    });

    test('unknown error codes are swallowed — no banner, no crash', async ({ page }) => {
      await page.evaluate(() => window.__mockRecognition._fireError('network'));

      await expect(page.locator('#error-msg')).toBeHidden();
      // Still considered listening from the UI perspective.
      await expect(page.locator('#toggle-btn')).toHaveText('Stop');
    });
  });

  // -------------------------------------------------------------------------
  test.describe('auto-restart', () => {
    test('recognition restarts after onend fires while still listening', async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);

      expect(await page.evaluate(() => window.__startCount)).toBe(1);

      // Simulate recognition timing out (browser fires onend without the user stopping).
      await page.evaluate(() => window.__mockRecognition._fireEnd());
      // The restart is debounced 300 ms; wait for it.
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => window.__startCount)).toBe(2);
    });

    test('recognition does not restart after the user stops', async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
      await stopListening(page);

      const countAfterStop = await page.evaluate(() => window.__startCount);

      // Simulate the browser sending a trailing onend after stop() was called.
      await page.evaluate(() =>
        window.__mockRecognition && window.__mockRecognition._fireEnd()
      );
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => window.__startCount)).toBe(countAfterStop);
    });

    test('pending restart is cancelled when the user stops before the timer fires', async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);

      // Fire onend to schedule the 300 ms restart, then stop before it fires.
      await page.evaluate(() => window.__mockRecognition._fireEnd());
      await stopListening(page); // cancels restartTimer
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => window.__startCount)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  test.describe('clear button', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mockSpeechApi);
      await page.goto(PAGE_URL);
      await startListening(page);
      await fireFinal(page, 'some spoken words');
    });

    test('clears final-text', async ({ page }) => {
      await page.click('#clear-btn');
      await expect(page.locator('#final-text')).toHaveText('');
    });

    test('clears interim-text', async ({ page }) => {
      await fireInterim(page, 'in progress');
      await page.click('#clear-btn');
      await expect(page.locator('#interim-text')).toHaveText('');
    });

    test('resets the internal buffer so new speech starts fresh', async ({ page }) => {
      await page.click('#clear-btn');
      await fireFinal(page, 'fresh start');

      // Only the new text should be present — nothing from before the clear.
      const text = await page.locator('#final-text').textContent();
      expect(text).toContain('fresh start');
      expect(text).not.toContain('some spoken words');
    });

    test('works while recognition is stopped', async ({ page }) => {
      await stopListening(page);
      await page.click('#clear-btn');
      await expect(page.locator('#final-text')).toHaveText('');
    });
  });

});
