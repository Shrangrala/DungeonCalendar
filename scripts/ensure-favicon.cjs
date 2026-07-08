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
  ['manifest.json', path.join(publicDir, 'manifest.json')],
  ['robots.txt', path.join(publicDir, 'robots.txt')],
  ['sitemap.xml', path.join(publicDir, 'sitemap.xml')]
];

if (fs.existsSync(dist)) {
  for (const [fileName, ...sources] of iconCopies) {
    const source = sources.find((candidate) => candidate && fs.existsSync(candidate));
    if (source) copyIfExists(source, path.join(dist, fileName));
  }

  const htmlPath = path.join(dist, 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/<title>.*?<\/title>\s*/is, '')
      .replace(/<meta[^>]+name=["']description["'][^>]*>\s*/gi, '')
      .replace(/<meta[^>]+property=["']og:[^"']+["'][^>]*>\s*/gi, '')
      .replace(/<meta[^>]+name=["']twitter:[^"']+["'][^>]*>\s*/gi, '')
      .replace(/<link[^>]+rel=["'](?:canonical|shortcut icon|icon|apple-touch-icon|manifest)["'][^>]*>\s*/gi, '')
      .replace(/<link[^>]+href=["'][^"']*favicon[^"']*["'][^>]*>\s*/gi, '')
      .replace(/<meta[^>]+name=["']theme-color["'][^>]*>\s*/gi, '');

    const faviconTags = [
      '<title>Dungeon Calendar - D&D Campaign Scheduling</title>',
      '<meta name="description" content="Schedule tabletop RPG sessions, manage campaigns, track player availability, and organize D&D adventures with Dungeon Calendar." />',
      '<link rel="canonical" href="https://www.dungeoncalendar.com/" />',
      '<meta property="og:title" content="Dungeon Calendar - D&D Campaign Scheduling" />',
      '<meta property="og:description" content="Schedule tabletop RPG sessions, manage campaigns, track player availability, and organize D&D adventures with Dungeon Calendar." />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:url" content="https://www.dungeoncalendar.com/" />',
      '<meta property="og:image" content="https://www.dungeoncalendar.com/icon-512.png" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      '<meta name="twitter:title" content="Dungeon Calendar - D&D Campaign Scheduling" />',
      '<meta name="twitter:description" content="Schedule tabletop RPG sessions, manage campaigns, track player availability, and organize D&D adventures with Dungeon Calendar." />',
      '<link rel="icon" href="/favicon.ico" sizes="any" />',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=5" />',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=5" />',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=5" />',
      '<link rel="manifest" href="/manifest.json?v=5" />',
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
