import sharp from "sharp";
const svg =
  '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#0B0F17"/><path d="M80 180h1040" stroke="#475569"/><text x="80" y="140" font-family="sans-serif" font-size="30" fill="#93C5FD">TECHNICAL NOTES</text><text x="80" y="340" font-family="sans-serif" font-size="64" fill="#F1F5F9">技術筆記</text><text x="80" y="430" font-family="sans-serif" font-size="30" fill="#CBD5E1">實作紀錄與工程思考</text></svg>';
await sharp(Buffer.from(svg)).png().toFile("apps/blog/public/og.png");
console.log("Generated project-owned Open Graph image.");
