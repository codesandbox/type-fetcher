import * as fs from "fs";
import * as path from "path";
import { parse } from "url";
import { Response, Request } from "express";
import { exec } from "child_process";
import recursive from "recursive-readdir";
import sum from "hash-sum";
import * as rimraf from "rimraf";

try {
  // Install git binaries
  /* tslint:disable no-var-requires */
  require("lambda-git")();
  /* tslint:enable */
} catch (e) {
  console.error(e);
}

interface IFiles {
  [path: string]: {
    code: string;
  };
}

const removeVersion = (depQuery: string) => depQuery.replace(/(?<!^)@.*/, "");

function getDependencyName(path: string) {
  const dependencyParts = removeVersion(path).split("/");
  let dependencyName = dependencyParts.shift();

  if (path.startsWith("@")) {
    dependencyName += `/${dependencyParts.shift()}`;
  }
  if (dependencyParts[0] && /^\d/.test(dependencyParts[0])) {
    // Make sure to include the aliased version if it's part of it
    dependencyName += `/${dependencyParts.shift()}`;
  }

  return dependencyName || "";
}

function getDependencyAndVersion(depString: string) {
  if (
    (depString.startsWith("@") && depString.split("@").length === 2) ||
    depString.split("@").length === 1
  ) {
    return { dependency: depString, version: "latest" };
  }

  const dependency = getDependencyName(depString);
  const version = depString
    .replace(dependency + "@", "")
    .replace(/^https:/, "https://");

  return {
    dependency,
    version
  };
}

// Directories where we only want .d.ts from
const TYPE_ONLY_DIRECTORIES = ["src"];

function isFileValid(path: string) {
  const isTypeOnly = TYPE_ONLY_DIRECTORIES.some(
    dir => path.indexOf("/" + dir + "/") > -1
  );
  const requiredEnding = isTypeOnly ? ".d.ts" : ".ts";

  if (path.endsWith(requiredEnding)) {
    return true;
  }

  if (path.endsWith("package.json")) {
    return true;
  }

  return false;
}

const BLACKLISTED_DIRECTORIES = ["__tests__", "aws-sdk"];

function readDirectory(location: string): IFiles {
  const entries = fs.readdirSync(location);

  return entries.reduce((result, entry) => {
    const fullPath = path.join(location, entry);

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && BLACKLISTED_DIRECTORIES.indexOf(entry) === -1) {
      return { ...result, ...readDirectory(fullPath) };
    }

    if (!isFileValid(fullPath)) {
      return result;
    }

    const code = fs.readFileSync(fullPath).toString();
    return { ...result, [fullPath]: { code } };
  }, {});
}

/**
 * This function ensures that we only add package.json files that have typing files included
 */
function cleanFiles(files: IFiles) {
  const newFiles: IFiles = {};
  const paths = Object.keys(files);
  const validDependencies = paths.filter(checkedPath => {
    if (checkedPath.endsWith("/package.json")) {
      try {
        const parsed = JSON.parse(files[checkedPath].code);
        if (parsed.typings || parsed.types) {
          return true;
        }
      } catch (e) {
        /* ignore */
      }

      return paths.some(
        p => p.startsWith(path.dirname(checkedPath)) && p.endsWith(".ts")
      );
    }

    return false;
  });

  paths.forEach(p => {
    if (p.endsWith(".ts") || validDependencies.indexOf(p) > -1) {
      newFiles[p] = files[p];
    }
  });

  return newFiles;
}

export function hasTypes(location: string) {
  return recursive(location).then(paths =>
    paths.some(p => p.endsWith(".d.ts"))
  );
}

function execPromise(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1000 }, (err, res) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(res);
    });
  });
}

export async function extractFiles(
  dependency: string,
  version: string,
  dependencyLocation: string
): Promise<IFiles> {
  console.log(`Installing ${dependency}@${version}, id: ${dependencyLocation}`);

  try {
    rimraf.sync("/tmp/.npm");
  } catch (e) {
    console.log("[ERR] Trouble deleting " + "/tmp/.npm" + " " + e.message);
  }

  const installQuery = version.startsWith("http")
    ? version
    : `${dependency}@${version}`;
  await execPromise(
    `cd /tmp && mkdir ${dependencyLocation} && cd ${dependencyLocation} && npm init -y && HOME=/tmp npm i --production ${installQuery}`
  );

  const dependencyPath = `/tmp/${dependencyLocation}/node_modules`;
  const packagePath = `${dependencyPath}/${dependency}`;

  const types = await hasTypes(packagePath);
  if (!types && !dependency.startsWith("@types/")) {
    return {};
  }

  const files = cleanFiles(readDirectory(dependencyPath));

  return files;
}

const MAX_RES_SIZE = 5.8 * 1024 * 1024;

function dropFiles(files: { [path: string]: string }) {
  let result: { [path: string]: string } = {};
  let index = 0;
  const paths = Object.keys(files);
  while (JSON.stringify(result).length < MAX_RES_SIZE && index < paths.length) {
    result[paths[index]] = files[paths[index]];
  }

  return { files: result, droppedFileCount: index + 1 };
}

interface IResult {
  files: {
    [path: string]: string;
  };
  droppedFileCount?: number;
}

const BLACKLISTED_DEPENDENCIES = ["react-scripts"];

export async function downloadDependencyTypings(
  depQuery: string
): Promise<IResult> {
  const { dependency, version = "latest" } = getDependencyAndVersion(depQuery);

  if (BLACKLISTED_DEPENDENCIES.indexOf(dependency) > -1) {
    return { files: {} };
  }

  const dependencyLocation = sum(`${dependency}@${version}`);

  try {
    const dependencyPath = `/tmp/${dependencyLocation}/node_modules`;
    let files = await extractFiles(dependency, version, dependencyLocation);

    if (Object.keys(files).some(p => /\.tsx?/.test(p))) {
      const filesWithNoPrefix = Object.keys(files).reduce(
        (t, n) => ({
          ...t,
          [n.replace(dependencyPath, "")]: {
            module: files[n]
          }
        }),
        {}
      );

      const resultSize = JSON.stringify({
        status: "ok",
        files: filesWithNoPrefix
      }).length;

      if (resultSize > MAX_RES_SIZE) {
        const { files: cleanedFiles, droppedFileCount } = dropFiles(
          filesWithNoPrefix
        );

        return {
          files: cleanedFiles,
          droppedFileCount
        };
      } else {
        return {
          files: filesWithNoPrefix
        };
      }
    } else {
      return { files: {} };
    }
  } catch (e) {
    e.message = dependencyLocation + ": " + e.message;
    throw e;
  } finally {
    console.log("Cleaning", `/tmp/${dependencyLocation}`);
    rimraf.sync(`/tmp/${dependencyLocation}`);
  }
}

export default async (req: Request, res: Response) => {
  try {
    const { query } = parse(req.url, true);
    let { depQuery } = query;

    if (!depQuery) {
      throw new Error("Please provide a dependency");
    }

    if (Array.isArray(depQuery)) {
      throw new Error("Dependency should not be an array");
    }

    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    const result = await downloadDependencyTypings(depQuery);

    res.setHeader("Cache-Control", `public, max-age=31536000`);
    res.end(
      JSON.stringify({
        status: "ok",
        files: result.files,
        droppedFileCount: result.droppedFileCount
      })
    );
  } catch (e) {
    console.log("Error", e.message);
    res.statusCode = 422;
    res.end(
      JSON.stringify({
        status: "error",
        files: {},
        error: e.message,
        stack: e.stack
      })
    );
  }
};
