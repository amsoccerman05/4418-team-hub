import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const templateDirectory = fileURLToPath(new URL('.', import.meta.url));
export const logoURL = 'https://www.frc4418.org/uploads/6/2/1/3/62133151/editor/logo-concept-first-it1.png';
// Reserved .invalid destination; never a usable invitation or real credential.
export const previewURL = 'https://example.invalid/invitation-preview/' + 'preview-only-'.repeat(20);

export function invitationPreview({images = true, inlineStylesOnly = false} = {}) {
  let html = readFileSync(join(templateDirectory, 'invite.html'), 'utf8')
    .replaceAll('{{ .ConfirmationURL }}', previewURL);
  const logo = readFileSync(new URL('../../public/branding/4418-impulse-emblem.png', import.meta.url));
  html = images
    ? html.replace(logoURL, `data:image/png;base64,${logo.toString('base64')}`)
    : html.replace(/<img\b[^>]*>/g, '');
  if (inlineStylesOnly) html = html.replace(/<style>[\s\S]*?<\/style>/g, '');
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] || 'test-results/invitation-email-preview');
  mkdirSync(directory, {recursive: true});
  for (const [name, options] of [
    ['invite-preview.html', {}],
    ['invite-preview-no-images.html', {images: false}],
    ['invite-preview-inline-only.html', {inlineStylesOnly: true}],
  ]) writeFileSync(join(directory, name), invitationPreview(options));
  writeFileSync(join(directory, 'invite-preview.txt'), readFileSync(join(templateDirectory, 'invite.txt'), 'utf8').replaceAll('{{ .ConfirmationURL }}', previewURL));
  console.log(`Synthetic invitation previews written to ${directory}. Links use example.invalid; no email was sent.`);
}
