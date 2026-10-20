const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hidden panels stay hidden when grid styles are applied', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('loads Supabase and signaling dependencies before the app', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const supabaseIndex = html.indexOf('supabase-js');
  const signalingIndex = html.indexOf('signaling.js');
  const appIndex = html.indexOf('app.js');

  assert.ok(supabaseIndex >= 0);
  assert.ok(signalingIndex >= 0);
  assert.ok(supabaseIndex < appIndex);
  assert.ok(signalingIndex < appIndex);
});

test('uses four generated seat links instead of manual room-code controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(html, /id="start-host"/);
  assert.match(html, /id="generate-invites"/);
  assert.match(html, /id="invite-list"/);
  assert.match(html, /id="seat-name-1"/);
  assert.match(html, /id="seat-name-4"/);
  assert.doesNotMatch(html, /id="room-code"/);
  assert.doesNotMatch(html, /id="join-room"/);
  assert.doesNotMatch(html, /id="answer-input"/);
  assert.doesNotMatch(html, /id="answer-link"/);
});

test('ships a public-safe Supabase configuration template', () => {
  const config = fs.readFileSync(path.join(__dirname, 'supabase-config.example.js'), 'utf8');
  assert.match(config, /SUPABASE_CONFIG/);
  assert.match(config, /publishableKey/);
  assert.doesNotMatch(config, /publishableKey\s*:\s*['"][^'"]*(service_role|sb_secret_)/i);
});

test('sends the leave signal before detaching the Supabase channel', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const stopStart = app.indexOf('async function stopSignaling');
  const stopEnd = app.indexOf('\n  function createPeerConnection', stopStart);
  const stopBody = app.slice(stopStart, stopEnd);
  assert.ok(stopBody.indexOf('await sendSignal') < stopBody.indexOf('state.signaling = null'));
});
