import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

import aws from "aws-sdk";
import express from "express";
import PQueue from "p-queue";

import {
  downloadDependencyTypings,
  getDependencyAndVersion,
  prepareTypingsFolder,
} from "./typings";

const s3 = new aws.S3();

const BUCKET_NAME = "prod-packager-packages.codesandbox.io";

let lastClean = Date.now();
const MAX_CLEAN_INTERVAL = 1000 * 60 * 60 * 1; // Every hour
function getFileFromS3(
  keyPath: string
): Promise<aws.S3.GetObjectOutput | null> {
  return new Promise((resolve, reject) => {
    if (!BUCKET_NAME) {
      reject("No BUCKET_NAME provided");
      return;
    }

    s3.getObject(
      {
        Bucket: BUCKET_NAME,
        Key: keyPath,
      },
      (err, packageData) => {
        if (err && err.name !== "AccessDenied") {
          reject(err);
          return;
        }

        resolve(packageData);
      }
    );
  });
}

function saveFileToS3(
  keyPath: string,
  content: string,
  contentType: string = "application/json"
): Promise<aws.S3.PutObjectOutput> {
  return new Promise((resolve, reject) => {
    if (!BUCKET_NAME) {
      reject("No BUCKET_NAME provided");
      return;
    }

    s3.putObject(
      {
        Bucket: BUCKET_NAME,
        Key: keyPath, // don't allow slashes
        Body: zlib.gzipSync(content),
        ContentType: contentType,
        CacheControl: "public, max-age=31536000",
        ContentEncoding: "gzip",
      },
      (err, response) => {
        if (err) {
          console.error(err);
          reject(err);
          return;
        }

        resolve(response);
      }
    );
  });
}

function getBucketPath(dependency: string, version: string) {
  return `v1/typings/${dependency}/${version}.json`;
}

async function getCache(
  dependency: string,
  version: string
): Promise<{ body: string; ETag: string | undefined } | undefined> {
  const bucketPath = getBucketPath(dependency, version);

  try {
    const bucketResponse = await getFileFromS3(bucketPath);
    if (bucketResponse?.Body) {
      console.log(`Returning S3 file for ${dependency}@${version}`);
      return {
        // @ts-ignore It works
        body: zlib.gunzipSync(bucketResponse.Body).toString(),
        ETag: bucketResponse.ETag,
      };
    }
  } catch (e) {
    /* ignore */
  }
}

const app = express();

const queue = new PQueue({
  concurrency: 4,
});

let count = 0;
queue.on("active", () => {
  console.log(
    `Working on item #${++count}.  Size: ${queue.size}  Pending: ${
      queue.pending
    }`
  );
});

app.get("/healthz", async (req, res) => {
  res.setHeader("Cache-Control", `no-cache`);
  res.end("ok");
});

app.get("/_stats", async (req, res) => {
  res.setHeader("Cache-Control", `no-cache`);
  res.setHeader("Content-Type", `application/json`);
  res.setHeader("Access-Control-Allow-Origin", `*`);

  try {
    const dirs = await fs.promises.readdir(path.resolve("/tmp", "typings"));
    const results = await Promise.all(
      dirs.map((dir) => fs.promises.stat(path.resolve("/tmp", "typings", dir)))
    );

    res.end(
      JSON.stringify({
        count,
        queueSize: queue.size,
        result: results
          .map((result, index) => ({
            name: dirs[index],
            created: result.birthtime,
          }))
          .sort((a, b) => {
            if (a.created > b.created) {
              return 1;
            } else if (a.created < b.created) {
              return -1;
            }

            return 0;
          }),
      })
    );
  } catch (e) {
    res.end(JSON.stringify({ error: e.message }));
  }
});

app.get("/api/v8/:dependency", async (req, res) => {
  try {
    const depQuery = decodeURIComponent(
      req.params.dependency.replace(/\.json$/, "")
    );

    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    const { dependency, version } = getDependencyAndVersion(depQuery);

    const bucketRes = await getCache(dependency, version);

    if (bucketRes) {
      if (bucketRes.ETag) {
        res.setHeader("ETag", bucketRes.ETag);
      }

      res.setHeader("Cache-Control", `public, max-age=31536000`);
      res.end(bucketRes.body);
      return;
    }

    const response = await queue.add(async () => {
      try {
        const bucketRes = await getCache(dependency, version);
        if (bucketRes) {
          return bucketRes.body;
        }
      } catch (e) {
        console.error(e);
        /* ignore */
      }

      const files = await downloadDependencyTypings(depQuery);
      const stringifiedFiles = JSON.stringify({ files });

      const bucketPath = getBucketPath(dependency, version);
      saveFileToS3(bucketPath, stringifiedFiles);

      return stringifiedFiles;
    });

    if (
      queue.size === 0 &&
      queue.pending === 0 &&
      Date.now() - lastClean >= MAX_CLEAN_INTERVAL
    ) {
      lastClean = Date.now();
      queue.concurrency = 1;
      queue.add(async () => {
        try {
          console.log("Cleaning up all typings...");
          await prepareTypingsFolder("/tmp/typings");
          console.log(
            "Directories after cleanup",
            await fs.promises.readdir(path.resolve("/tmp", "typings"))
          );
        } finally {
          queue.concurrency = 4;
        }
      });
    }

    res.setHeader("Cache-Control", `public, max-age=31536000`);

    res.end(response);
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

prepareTypingsFolder("/tmp/typings").then(() => {
  app.listen(PORT, () => {
    console.log("Listening on " + PORT);
  });
});
