const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const ROOT = __dirname;
const UPSTREAM = "https://api.surplusintelligence.ai";

function serveFile(res, pathname) {
  const filePath = path.join(ROOT, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const type = filePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    try {
      const upstream = await fetch(UPSTREAM + req.url.slice(4), {
        method: req.method,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
          Authorization: req.headers.authorization || ""
        }
      });
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  serveFile(res, decodeURIComponent(req.url.split("?")[0]));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Surplus dashboard running at http://localhost:${PORT}`);
});
