// Link detection for group anti-link (Phase 5).
//
// Pure functions, no config and no network.
import { test } from 'node:test';
import assert from 'node:assert';
import { detectLinks, isWhitelisted, isInviteLink } from '../src/utils/linkDetector.js';

// The eight cases the spec calls for, in order.
test('1. detects https://example.com', () => {
  const r = detectLinks('https://example.com');
  assert.strictEqual(r.hasLink, true);
  assert.deepStrictEqual(r.hostnames, ['example.com']);
});

test('2. detects www.example.com', () => {
  const r = detectLinks('www.example.com');
  assert.strictEqual(r.hasLink, true);
  assert.deepStrictEqual(r.hostnames, ['example.com']);
});

test('3. detects bare example.com', () => {
  const r = detectLinks('example.com');
  assert.strictEqual(r.hasLink, true);
  assert.deepStrictEqual(r.hostnames, ['example.com']);
});

test('4. does NOT detect "hello world"', () => {
  assert.strictEqual(detectLinks('hello world').hasLink, false);
});

test('5. does NOT detect package.json as a link', () => {
  const r = detectLinks('package.json');
  assert.strictEqual(r.hasLink, false, JSON.stringify(r.urls));
});

test('6. whitelist matches an exact hostname', () => {
  assert.strictEqual(isWhitelisted(['example.com'], ['example.com']), true);
});

test('7. whitelist covers subdomains', () => {
  assert.strictEqual(isWhitelisted(['sub.example.com'], ['example.com']), true);
});

test('8. detects an invite link', () => {
  assert.strictEqual(isInviteLink(['https://chat.whatsapp.com/abc123']), true);
});

// --- the file-extension behaviour the blocklist exists for ------------------
test('common filenames are not links', () => {
  for (const s of [
    'file.txt', 'node.js', 'image.png', 'Readme.md', 'test.py',
    'styles.css', 'data.json', 'app.tsx', 'config.yml', 'photo.jpg'
  ]) {
    assert.strictEqual(detectLinks(s).hasLink, false, `${s} should not be a link`);
  }
});

test('filenames inside a sentence are not links', () => {
  const r = detectLinks('check package.json and readme.md first');
  assert.strictEqual(r.hasLink, false, JSON.stringify(r.urls));
});

test('a real link in a sentence with a filename is still a link', () => {
  const r = detectLinks('update package.json then visit https://example.com');
  assert.strictEqual(r.hasLink, true);
  assert.deepStrictEqual(r.hostnames, ['example.com']);
});

// --- dedup and URL hygiene --------------------------------------------------
test('an explicit URL is not double-counted by the bare pass', () => {
  const r = detectLinks('https://example.com');
  assert.strictEqual(r.urls.length, 1, JSON.stringify(r.urls));
  assert.strictEqual(r.urls[0], 'https://example.com', 'the explicit form is kept');
});

test('multiple distinct links are all returned', () => {
  const r = detectLinks('see https://a.com and www.b.org plus c.net');
  assert.deepStrictEqual(r.hostnames.sort(), ['a.com', 'b.org', 'c.net']);
});

test('trailing sentence punctuation is stripped', () => {
  const r = detectLinks('go to https://example.com.');
  assert.deepStrictEqual(r.urls, ['https://example.com']);
});

test('a subdomain with a path and query is handled', () => {
  const r = detectLinks('https://sub.example.co.uk/path?q=1');
  assert.deepStrictEqual(r.hostnames, ['sub.example.co.uk']);
});

test('empty and non-string input is safe', () => {
  for (const v of ['', null, undefined, 0, {}, []]) {
    const r = detectLinks(v);
    assert.strictEqual(r.hasLink, false);
    assert.deepStrictEqual(r.urls, []);
  }
});

test('bare domain with a multi-part TLD is detected', () => {
  assert.deepStrictEqual(detectLinks('sub.example.co.uk').hostnames, ['sub.example.co.uk']);
});

test('an invite link among other links is still identified', () => {
  const r = detectLinks('https://chat.whatsapp.com/xyz join');
  assert.strictEqual(r.hasLink, true);
  assert.strictEqual(isInviteLink(r.urls), true);
});

// --- whitelist edges --------------------------------------------------------
test('whitelist does not match a different domain', () => {
  assert.strictEqual(isWhitelisted(['other.com'], ['example.com']), false);
});

test('whitelist does not match a suffix-only collision', () => {
  // notexample.com ends with "example.com" as a string but is a different host.
  assert.strictEqual(isWhitelisted(['notexample.com'], ['example.com']), false);
});

test('an empty whitelist allows nothing', () => {
  assert.strictEqual(isWhitelisted(['example.com'], []), false);
  assert.strictEqual(isWhitelisted(['example.com'], null), false);
});

test('whitelist entries are normalized', () => {
  assert.strictEqual(isWhitelisted(['example.com'], ['WWW.Example.com']), true);
  assert.strictEqual(isWhitelisted(['example.com'], ['  example.com  ']), true);
});

test('whitelist covers several entries', () => {
  assert.strictEqual(isWhitelisted(['github.com'], ['youtube.com', 'github.com']), true);
});

test('a non-invite link is not an invite', () => {
  assert.strictEqual(isInviteLink(['https://example.com/chat']), false);
  assert.strictEqual(isInviteLink([]), false);
  assert.strictEqual(isInviteLink(null), false);
});