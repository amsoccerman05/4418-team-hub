import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {invitationPreview, logoURL, previewURL} from '../supabase/templates/preview-invite.mjs';

const html = readFileSync('supabase/templates/invite.html', 'utf8');
const plain = readFileSync('supabase/templates/invite.txt', 'utf8');
const subject = readFileSync('supabase/templates/invite.subject.txt', 'utf8').trim();

test('invitation email contract preserves the existing confirmation destination', () => {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  expect(hrefs).toEqual(['{{ .ConfirmationURL }}', '{{ .ConfirmationURL }}']);
  expect(html.match(/{{[^}]+}}/g)).toEqual(Array(3).fill('{{ .ConfirmationURL }}'));
  expect(plain.match(/{{[^}]+}}/g)).toEqual(['{{ .ConfirmationURL }}']);
  expect(html).toContain('>Accept invitation</a>');
  expect(html).toContain('>{{ .ConfirmationURL }}</a>');
});

test('invitation email contract avoids executable content and tracking resources', () => {
  expect(html).not.toMatch(/<(?:script|iframe|form|input|video|object|embed|link)\b|\bon\w+=|url\(/i);
  expect([...html.matchAll(/src="([^"]+)"/g)].map(match => match[1])).toEqual([logoURL]);
  // Table layout and system fonts retain core content if head CSS is stripped.
  expect(html).not.toMatch(/display:\s*(?:grid|flex)|@import|@font-face/i);
  expect(html.match(/<table\b/g)?.length).toBe(html.match(/role="presentation"/g)?.length);
});

test('invitation email contract identifies the team without inventing access or timing', () => {
  expect(subject).toBe("You're invited to 4418 IMPULSE");
  for (const content of [html, plain]) {
    expect(content).toContain('4418 IMPULSE team workspace');
    expect(content).toContain("If you weren't expecting this invitation, you can ignore this email.");
    expect(content).not.toMatch(/\b(?:expires?|hours?|minutes?|administrator|admin|student|mentor|registered|password)\b/i);
  }
});

test('invitation email previews are self-contained and contain only synthetic links', () => {
  for (const options of [{}, {images: false}, {inlineStylesOnly: true}]) {
    const rendered = invitationPreview(options);
    expect(rendered).not.toContain('{{');
    expect(rendered).not.toMatch(/(?:src|href)="https:\/\/(?!example\.invalid\/)/);
    expect([...rendered.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual([previewURL, previewURL]);
  }
  expect(invitationPreview()).toContain('src="data:image/png;base64,');
  expect(invitationPreview({images: false})).not.toContain('<img');
});
