const fs = require('fs');
const path = require('path');

const GOOGLE_TAG_ID = 'GT-TWZ2NDFP';
const MEASUREMENT_ID = 'G-D3BQVGC6BV';
const DIST_DIR = path.join(process.cwd(), 'dist');
const START_MARKER = '<!-- Dungeon Calendar Google tag: start -->';
const END_MARKER = '<!-- Dungeon Calendar Google tag: end -->';
const snippet = `${START_MARKER}
<script async id="google-analytics-gtag" src="https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){window.dataLayer.push(arguments);};
  window.gtag('js', new Date());

  const debugMode = new URLSearchParams(window.location.search).get('debug_mode');
  window.gtag('config', '${MEASUREMENT_ID}', {
    send_page_view: false,
    debug_mode: debugMode === 'true' || debugMode === '1'
  });
  window.__dungeonCalendarGoogleAnalyticsInitialized = true;
</script>
${END_MARKER}`;

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

  // Remove a prior marker-delimited injection.
  html = html.replace(new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\s*`, 'g'), '');

  // Remove the older two-script snippet used by previous builds. The previous
  // cleanup removed only the external script and could leave a duplicate inline
  // gtag config block behind.
  html = html.replace(
    /<!-- Google tag \(gtag\.js\) -->[\s\S]*?<script[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"']+["'][^>]*><\/script>[\s\S]*?<script>[\s\S]*?gtag\(["']config["'][\s\S]*?<\/script>\s*/g,
    ''
  );

  if (html.includes('</head>')) {
    html = html.replace('</head>', `${snippet}\n</head>`);
  } else {
    html = `${snippet}\n${html}`;
  }
  fs.writeFileSync(file, html);
  console.log(`Injected ${GOOGLE_TAG_ID} -> ${MEASUREMENT_ID} into ${path.relative(process.cwd(), file)}`);
}
