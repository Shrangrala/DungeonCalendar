const fs = require('fs');
const path = require('path');

const TAG_ID = 'GT-TWZ2NDFP';
const DIST_DIR = path.join(process.cwd(), 'dist');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const STATIC_HTML_DIRS = ['about', 'delete-account', 'policy', 'privacy', 'terms'];

const snippet = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${TAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${TAG_ID}');
</script>`;

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function inject(file) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*/g, '');
  html = html.replace(/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]+"><\/script>\s*<script>[\s\S]*?gtag\('config',\s*'[^']+'[\s\S]*?<\/script>\s*/g, '');
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${snippet}\n</head>`);
  } else {
    html = `${snippet}\n${html}`;
  }
  fs.writeFileSync(file, html);
  console.log(`Injected ${TAG_ID} into ${path.relative(process.cwd(), file)}`);
}

// Expo export can omit nested static HTML pages from public/ depending on version/platform.
// Copy the static legal/info pages into dist first so Vercel serves tagged HTML at /about, /terms, etc.
for (const dir of STATIC_HTML_DIRS) {
  copyDir(path.join(PUBLIC_DIR, dir), path.join(DIST_DIR, dir));
}

for (const file of walk(DIST_DIR)) {
  if (file.endsWith('.html')) inject(file);
}
