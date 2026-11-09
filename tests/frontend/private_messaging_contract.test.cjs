const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../frontend/src');
const workspace = fs.readFileSync(path.join(root, 'features/messaging/MessageWorkspace.tsx'), 'utf8');
const service = fs.readFileSync(path.join(root, 'features/messaging/messageService.ts'), 'utf8');
const messagesButton = fs.readFileSync(path.join(root, 'components/layout/OfficeMessagesButton.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'features/dashboard/DashboardWorkspace.tsx'), 'utf8');
const topbar = fs.readFileSync(path.join(root, 'components/layout/Topbar.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'api/client.ts'), 'utf8');

test('private messaging uses the authenticated typed API service', () => {
  assert.match(service, /apiClient\.get<\{ personnel: MessagingPerson\[\]; summary: PersonnelSummary \| null \}>\("\/messages\/personnel"\)/);
  assert.match(service, /apiClient\.get<\{ messages: PrivateMessage\[\]; has_more: boolean \}>\(`\/messages\/\$\{peerId\}`/);
  assert.match(service, /apiClient\.post<PrivateMessage>\(`\/messages\/\$\{peerId\}`/);
  assert.match(service, /apiClient\.post<\{ updated: number; read_at: string \}>\(`\/messages\/\$\{peerId\}\/read`/);
  assert.match(service, /apiClient\.post<\{ reactions: MessageReaction\[\] \}>\(/);
  assert.match(service, /`\/messages\/\$\{peerId\}\/\$\{messageId\}\/reaction`/);
});

test('messages expose accessible reaction controls and six supported emoji', () => {
  for (const emoji of ['👍', '❤️', '😂', '😮', '😢', '😡']) assert.ok(service.includes(emoji), `missing reaction option: ${emoji}`);
  assert.match(workspace, /role="group" aria-label="Message reactions"/);
  assert.match(workspace, /role="group" aria-label="Choose a reaction"/);
  assert.match(workspace, /aria-pressed=\{reaction\.reacted_by_me\}/);
  assert.match(workspace, /Unable to update this reaction/);
});

test('messaging renders useful empty, loading, error, offline, and retry states', () => {
  for (const text of [
    'No colleagues are available for private messaging.',
    'No messages yet. Send a message to start.',
    'Loading conversation',
    'You’re offline.',
    'Retry',
    'Load earlier messages',
  ]) assert.ok(workspace.includes(text), `missing UI state: ${text}`);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /Your draft is still here/);
});

test('message polling stays at five seconds and pauses while the page is hidden', () => {
  assert.match(workspace, /window\.setTimeout\(\(\) => void poll\(\), 5000\)/);
  assert.match(workspace, /document\.visibilityState === "visible"/);
});

test('read-state refresh callback stays stable and does not restart conversation polling', () => {
  assert.match(messagesButton, /const refreshUnreadPeople = useCallback\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\);/);
  assert.match(messagesButton, /onUnreadChange=\{refreshUnreadPeople\}/);
});

test('messages launcher sits beside notifications and opens the existing workspace', () => {
  const notificationPosition = topbar.indexOf('ref={notificationRef}');
  const messagesPosition = topbar.indexOf('<OfficeMessagesButton');
  const profilePosition = topbar.indexOf('ref={profileRef}');
  assert.ok(notificationPosition >= 0 && notificationPosition < messagesPosition);
  assert.ok(messagesPosition < profilePosition);
  assert.match(messagesButton, /<MessageWorkspace/);
  assert.match(workspace, /peopleError &&/);
  assert.match(workspace, /onRetryPeople/);
  assert.doesNotMatch(dashboard, /OfficePersonnelOverview/);
});

test('message dialog has an accessible name and bounded composer', () => {
  assert.match(workspace, /role="dialog" aria-modal="true" aria-label="Private messages"/);
  assert.match(workspace, /maxLength=\{2000\}/);
  assert.match(workspace, /aria-label="Search colleagues"/);
});

test('HTTPS pages keep API requests on the same-origin TLS proxy', () => {
  assert.match(client, /window\.location\.protocol === "https:"/);
  assert.match(client, /insecureConfiguredApi\s*\?\s*"\/api"/);
});
