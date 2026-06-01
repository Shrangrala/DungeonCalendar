const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const assetsDir = path.join(root, 'assets');

function copyIfExists(from, to) {
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

const iconCopies = [
  ['favicon.ico', path.join(publicDir, 'favicon.ico'), path.join(assetsDir, 'favicon.ico')],
  ['favicon.png', path.join(publicDir, 'favicon.png'), path.join(assetsDir, 'favicon.png')],
  ['favicon-32x32.png', path.join(publicDir, 'favicon-32x32.png'), path.join(assetsDir, 'favicon.png')],
  ['favicon-16x16.png', path.join(publicDir, 'favicon-16x16.png'), path.join(assetsDir, 'favicon.png')],
  ['apple-touch-icon.png', path.join(publicDir, 'apple-touch-icon.png'), path.join(assetsDir, 'app-icon.png')],
  ['icon-192.png', path.join(publicDir, 'icon-192.png'), path.join(assetsDir, 'app-icon.png')],
  ['icon-512.png', path.join(publicDir, 'icon-512.png'), path.join(assetsDir, 'app-icon.png')],
  ['manifest.json', path.join(publicDir, 'manifest.json')]
];

if (fs.existsSync(dist)) {
  for (const [fileName, ...sources] of iconCopies) {
    const source = sources.find(Boolean).find((candidate) => fs.existsSync(candidate));
    if (source) copyIfExists(source, path.join(dist, fileName));
  }

  const htmlPath = path.join(dist, 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon|manifest)["'][^>]*>\s*/gi, '')
      .replace(/<link[^>]+href=["'][^"']*favicon[^"']*["'][^>]*>\s*/gi, '')
      .replace(/<meta[^>]+name=["']theme-color["'][^>]*>\s*/gi, '');

    const faviconTags = [
      '<link rel="icon" href="/favicon.ico" sizes="any" />',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=4" />',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=4" />',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=4" />',
      '<link rel="manifest" href="/manifest.json?v=4" />',
      '<meta name="theme-color" content="#070504" />'
    ].join('\n    ');

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n    ${faviconTags}`);
    } else {
      html = `${faviconTags}\n${html}`;
    }

    fs.writeFileSync(htmlPath, html);
  }
}
