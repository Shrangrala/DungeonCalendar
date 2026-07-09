const fs = require('fs');
const path = require('path');

const TAG_ID = 'G-D3BQVGC6BV';
const DIST_DIR = path.join(process.cwd(), 'dist');
const snippet = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${TAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${TAG_ID}');
</script>`;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(DIST_DIR)) {
  if (!file.endsWith('.html')) continue;
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
