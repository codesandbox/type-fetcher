import express from "express";
import PQueue from "p-queue";
import { downloadDependencyTypings } from "./typings";

const app = express();
const queue = new PQueue({ concurrency: 1, timeout: 1000 * 60 });

app.get("/api/v8/:dependency", async (req, res) => {
  try {
    const depQuery = decodeURIComponent(
      req.params.dependency.replace(/\.json$/, "")
    );

    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    const files = await queue.add(() => downloadDependencyTypings(depQuery));

    res.setHeader("Cache-Control", `public, max-age=31536000`);

    res.end(JSON.stringify({ files }));
  } catch (e) {
    console.log("Error", e.message);
    res.statusCode = 422;
    res.end(
      JSON.stringify({
        status: "error",
        files: {},
        error: e.message,
        stack: e.stack,
      })
    );
  }
});
const PORT = Number(process.env.PORT) || 4646;
app.listen(PORT, () => {
  console.log("Listening on " + PORT);
});
