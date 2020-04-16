import express from "express";
import PQueue from "p-queue";
import { downloadDependencyTypings } from "./typings";

const app = express();

const queue = new PQueue({
  concurrency: 4,
  timeout: 60000,
});

let count = 0;
queue.on("active", () => {
  console.log(
    `Working on item #${++count}.  Size: ${queue.size}  Pending: ${
      queue.pending
    }`
  );
});

app.get("/api/v8/:dependency", async (req, res) => {
  try {
    const depQuery = decodeURIComponent(
      req.params.dependency.replace(/\.json$/, "")
    );

    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    let connectionClosed = false;
    req.on("close", () => {
      connectionClosed = true;
    });
    const files = await queue.add(() => {
      if (connectionClosed) {
        return Promise.resolve({});
      }

      return downloadDependencyTypings(depQuery);
    });

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
