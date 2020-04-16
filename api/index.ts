import express from "express";
import PQueue from "p-queue";
import { downloadDependencyTypings, getDependencyAndVersion } from "./typings";
import aws from "aws-sdk";

const s3 = new aws.S3();

const BUCKET_NAME = "prod-packager-packages.codesandbox.io";

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
          console.error(err);
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
        Body: content,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000",
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

app.get("/api/v8/:dependency", async (req, res) => {
  try {
    const depQuery = decodeURIComponent(
      req.params.dependency.replace(/\.json$/, "")
    );

    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    const { dependency, version } = getDependencyAndVersion(depQuery);

    const bucketPath = `v1/typings/${dependency}/${version}.json`;

    try {
      const bucketResponse = await getFileFromS3(bucketPath);
      if (bucketResponse?.Body) {
        res.setHeader("Cache-Control", `public, max-age=31536000`);

        res.end(bucketResponse.Body.toString());
        return;
      }
    } catch (e) {
      /* ignore */
    }

    const response = await queue.add(async () => {
      const files = await downloadDependencyTypings(depQuery);
      const stringifiedFiles = JSON.stringify({ files });

      saveFileToS3(bucketPath, stringifiedFiles);

      return stringifiedFiles;
    });

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
app.listen(PORT, () => {
  console.log("Listening on " + PORT);
});
