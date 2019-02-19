import * as fs from "fs";
import * as path from "path";
import { parse } from "url";
import { Response, Request } from "express";
import { execSync } from "child_process";
import sum from "hash-sum";
import * as rimraf from "rimraf";

function getDependencyAndVersion(depString: string) {
  if (
    (depString.startsWith("@") && depString.split("@").length === 2) ||
    depString.split("@").length === 1
  ) {
    return { dependency: depString, version: "latest" };
  }

  const parts = depString.split("@");
  const version = parts.pop();

  return {
    dependency: parts.join("@"),
    version
  };
}

function isFileValid(path: string) {
  if (path.endsWith(".ts")) {
    return true;
  }

  if (path.endsWith("package.json")) {
    return true;
  }

  return false;
}

const BLACKLISTED_DIRECTORIES = ["src", "__tests__", "aws-sdk"];

function readDirectory(location: string): { [path: string]: string } {
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
function cleanFiles(files: { [path: string]: string }) {
  const newFiles: { [path: string]: string } = {};
  const paths = Object.keys(files);
  const validDependencies = paths.filter(checkedPath => {
    if (checkedPath.endsWith("/package.json")) {
      try {
        const parsed = JSON.parse(files[checkedPath]);
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

export function extractFiles(
  dependency: string,
  version: string,
  dependencyLocation: string
) {
  execSync(
    `cd /tmp && mkdir ${dependencyLocation} && cd ${dependencyLocation} && HOME=/tmp npm i --production ${dependency}@${version} --no-save`
  ).toString();

  const dependencyPath = `/tmp/${dependencyLocation}/node_modules`;
  const packageJSON = `${dependencyPath}/${dependency}/package.json`;
  const pkg = JSON.parse(fs.readFileSync(packageJSON).toString());
  if (!(pkg.types || pkg.typings) && !dependency.startsWith("@types/")) {
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

    const { dependency, version = "latest" } = getDependencyAndVersion(
      depQuery
    );

    res.setHeader("Cache-Control", `max-age=31536000`);
    res.setHeader("Content-Type", `application/json`);
    res.setHeader("Access-Control-Allow-Origin", `*`);

    const dependencyLocation = sum(`${dependency}@${version}`);

    try {
      const dependencyPath = `/tmp/${dependencyLocation}/node_modules`;
      let files = extractFiles(dependency, version, dependencyLocation);

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

          res.end(
            JSON.stringify({
              status: "ok",
              files: cleanedFiles,
              droppedFileCount
            })
          );
        } else {
          res.end(
            JSON.stringify({
              status: "ok",
              files: filesWithNoPrefix
            })
          );
        }
      } else {
        res.end(
          JSON.stringify({
            status: "ok",
            files: {}
          })
        );
      }
    } finally {
      rimraf.sync(`/tmp/${dependencyLocation}`);
    }
  } catch (e) {
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
