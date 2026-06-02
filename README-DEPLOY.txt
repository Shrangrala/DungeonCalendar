Dungeon Calendar deployment notes

SEO/static files fixed:
- public/sitemap.xml
- public/robots.txt
- scripts/ensure-favicon.cjs copies sitemap/robots into dist after Expo export
- vercel.json serves sitemap.xml and robots.txt before the React catch-all route

After uploading to GitHub, redeploy on Vercel with Clear Build Cache. Then verify:
https://dungeoncalendar.com/sitemap.xml
https://dungeoncalendar.com/robots.txt

If sitemap.xml shows XML, resubmit it in Google Search Console.
