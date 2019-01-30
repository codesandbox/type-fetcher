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

function readDirectory(location: string): { [path: string]: string } {
  const entries = fs.readdirSync(location);

  return entries.reduce((result, entry) => {
    const fullPath = path.join(location, entry);

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      return { ...result, ...readDirectory(fullPath) };
    }

    if (!isFileValid(fullPath)) {
      return result;
    }

    const code = fs.readFileSync(fullPath).toString();
    return { ...result, [fullPath]: { code } };
  }, {});
}

module.exports = async (req: Request, res: Response) => {
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

    const dependencyLocation = sum(`${dependency}@${version}`);

    res.setHeader("Cache-Control", `max-age=31536000`);
    res.setHeader("Content-Type", `application/json`);

    try {
      execSync(
        `cd /tmp && mkdir ${dependencyLocation} && cd ${dependencyLocation} && HOME=/tmp npm i ${dependency}@${version} --no-save`
      ).toString();

      const dependencyPath = `/tmp/${dependencyLocation}/node_modules`;
      const files = readDirectory(dependencyPath);

      if (!Object.keys(files).some(p => /\.tsx?/.test(p))) {
        // Don't return any file if there is no typescript file for the dependency
        // TODO: optimize this to subdirectory level
        res.end({
          status: "ok",
          files: {}
        });
      } else {
        const filesWithNoPrefix = Object.keys(files).reduce(
          (t, n) => ({
            ...t,
            [n.replace(dependencyPath, "")]: {
              module: files[n]
            }
          }),
          {}
        );

        res.setHeader("Access-Control-Allow-Origin", `*`);

        res.end(
          JSON.stringify({
            status: "ok",
            files: filesWithNoPrefix
          })
        );
      }
    } finally {
      rimraf.sync(`/tmp/${dependencyLocation}`);
    }
  } catch (e) {
    res.status(422).end(
      JSON.stringify({
        status: "error",
        files: {},
        error: e.message,
        stack: e.stack
      })
    );
  }
};
