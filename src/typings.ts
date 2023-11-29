import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parse } from "url";

import { Request, Response } from "express";
import sum from "hash-sum";
import recursive from "recursive-readdir";
import { rimraf } from "rimraf";

interface IFiles {
  [path: string]: {
    code: string;
  };
}

let typingsFolder: string;
// Export for testing purposes
export const packageInstalls: { [name: string]: number } = {};
export const cleanUpTime = 10 * 60 * 1000; // When 10 minutes old

export async function prepareTypingsFolder(folder: string) {
  typingsFolder = folder;
  // Delete any old packages due to restart of the process
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }

  try {
    await rimraf(folder + "/*");
    console.log("Clean TMP folder");
  } catch (error) {
    console.log("Unable to clean TMP", error);
  }
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

export function getDependencyAndVersion(depString: string) {
  if (
    (depString.startsWith("@") && depString.split("@").length === 2) ||
    depString.split("@").length === 1
  ) {
    return { dependency: depString, version: "latest" };
  }

  const dependency = getDependencyName(depString);
  const version = decodeURIComponent(depString.replace(dependency + "@", ""));

  return {
    dependency,
    version,
  };
}

// Directories where we only want .d.ts from
const TYPE_ONLY_DIRECTORIES = ["src"];

function isFileValid(path: string) {
  const isTypeOnly = TYPE_ONLY_DIRECTORIES.some(
    (dir) => path.indexOf("/" + dir + "/") > -1
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
function cleanFiles(files: IFiles, rootPath: string) {
  const newFiles: IFiles = {};
  const paths = Object.keys(files);
  const rootPkgJSON = path.join(rootPath, "package.json");
  const validDependencies = paths.filter((checkedPath) => {
    if (checkedPath === rootPkgJSON) {
      return true;
    }

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
        (p) => p.startsWith(path.dirname(checkedPath)) && p.endsWith(".ts")
      );
    }

    return false;
  });

  paths.forEach((p) => {
    if (p.endsWith(".ts") || validDependencies.indexOf(p) > -1) {
      newFiles[p] = files[p];
    }
  });

  return newFiles;
}

export function hasTypes(location: string) {
  return recursive(location).then((paths) =>
    paths.some((p) => p.endsWith(".d.ts"))
  );
}

function execPromise(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    const process = exec(command, { maxBuffer: 1024 * 1000 }, (err, res) => {
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
        return;
      }

      resolve(res);
    });

    // Max 80s
    timeoutId = setTimeout(() => {
      process.kill("SIGINT");
    }, 80000);
  });
}

export function cleanYarnCache() {
  return execPromise("yarn cache clean");
}

export async function extractFiles(
  dependency: string,
  version: string,
  dependencyLocation: string
): Promise<IFiles> {
  console.log(`Installing ${dependency}@${version}, id: ${dependencyLocation}`);

  const installQuery = version.startsWith("http")
    ? version
    : `${dependency}@${version}`;
  await execPromise(
    `cd ${typingsFolder} && mkdir ${dependencyLocation} && cd ${dependencyLocation} && npm init -y && HOME=${typingsFolder}/${dependencyLocation} yarn add  --ignore-engines --no-lockfile --non-interactive --no-progress --prod --cache-folder ./ ${installQuery}`
  );

  const dependencyPath = `${typingsFolder}/${dependencyLocation}/node_modules`;
  const packagePath = `${dependencyPath}/${dependency}`;

  const files = cleanFiles(readDirectory(dependencyPath), packagePath);

  return files;
}

const MAX_RES_SIZE = 5.8 * 1024 * 1024;

function dropFiles(files: IModuleResult) {
  let result: IModuleResult = {};
  let index = 0;
  const paths = Object.keys(files);
  while (JSON.stringify(result).length < MAX_RES_SIZE && index < paths.length) {
    result[paths[index]] = files[paths[index]];
    index++;
  }

  return { files: result, droppedFileCount: index + 1 };
}

const BLACKLISTED_DEPENDENCIES = ["react-scripts", "@types/material-uiIcons"];

interface IModuleResult {
  [path: string]: { module: { code: string } };
}

export async function downloadDependencyTypings(
  depQuery: string
): Promise<IModuleResult> {
  const { dependency, version = "latest" } = getDependencyAndVersion(depQuery);

  if (BLACKLISTED_DEPENDENCIES.indexOf(dependency) > -1) {
    return {};
  }
  const startTime = Date.now();

  const dependencyLocation =
    sum(`${dependency}@${version}`) + Math.floor(Math.random() * 100000);

  try {
    const dependencyPath = `${typingsFolder}/${dependencyLocation}/node_modules`;
    packageInstalls[dependencyLocation] = Date.now();
    let files = await extractFiles(dependency, version, dependencyLocation);

    const filesWithNoPrefix = Object.keys(files).reduce(
      (t, n) => ({
        ...t,
        [n.replace(dependencyPath, "")]: {
          module: files[n],
        },
      }),
      {}
    );

    return filesWithNoPrefix;
  } catch (e) {
    e.message = dependencyLocation + ": " + e.message;
    throw e;
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    console.log(`${dependency}@${version}: done in ${duration}s. Cleaning...`);

    try {
      await rimraf(`${typingsFolder}/${dependencyLocation}`);
      delete packageInstalls[dependencyLocation];
    } catch (error) {
      console.log("ERROR - Could not clean up " + dependencyLocation);
    }

    const now = Date.now();
    for (const possiblyOldDependencyLocation of Object.keys(packageInstalls)) {
      if (now - packageInstalls[possiblyOldDependencyLocation] > cleanUpTime) {
        try {
          await rimraf(`${typingsFolder}/${possiblyOldDependencyLocation}`);
          delete packageInstalls[possiblyOldDependencyLocation];
        } catch (error) {
          console.log(
            "ERROR - Could not clean up " +
              possiblyOldDependencyLocation +
              ", which has been there since " +
              packageInstalls[possiblyOldDependencyLocation]
          );
        }
      }
    }
  }
}

function dropFilesIfNeeded(filesWithNoPrefix: IModuleResult) {
  const resultSize = JSON.stringify({
    status: "ok",
    files: filesWithNoPrefix,
  }).length;

  if (resultSize > MAX_RES_SIZE) {
    const { files: cleanedFiles, droppedFileCount } =
      dropFiles(filesWithNoPrefix);

    return {
      files: cleanedFiles,
      droppedFileCount,
    };
  } else {
    return {
      files: filesWithNoPrefix,
    };
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

    const files = await downloadDependencyTypings(depQuery);
    const result = dropFilesIfNeeded(files);

    res.setHeader("Cache-Control", `public, max-age=31536000`);
    res.end(
      JSON.stringify({
        status: "ok",
        files: result.files,
        droppedFileCount: result.droppedFileCount,
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
        stack: e.stack,
      })
    );
  }
};
