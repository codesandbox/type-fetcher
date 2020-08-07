import { existsSync, mkdirSync, readdirSync } from "fs";
import * as path from "path";

import * as typings from "../api/typings";

const testTypingsFolder = path.resolve("test_typings");

console.log("TEST writing files to " + testTypingsFolder);

describe("fetchTypings", () => {
  beforeAll(async () => {
    // Add a folder to see if it cleans up
    mkdirSync(path.join(testTypingsFolder, "old-folder"));
    await typings.prepareTypingsFolder(testTypingsFolder);
  });
  afterAll(() => {
    expect(readdirSync(testTypingsFolder)).toEqual([]);
  });
  it("should clean the tmp folder ", async () => {
    expect(readdirSync(testTypingsFolder)).toEqual([]);
  });
  it("includes src directory files for @angular/core", async () => {
    const result = await typings.downloadDependencyTypings(
      "@angular/core@7.0.0"
    );

    expect(
      result["/@angular/core/src/application_tokens.d.ts"]
    ).not.toBeFalsy();
  });

  it("includes .d.ts files for @dojo/framework", async () => {
    const result = await typings.downloadDependencyTypings(
      "@dojo/framework@5.0.0"
    );

    expect(result["/@dojo/framework/stores/Store.d.ts"]).not.toBeFalsy();
  }, 10000);

  it("doesn't return a 404 for reallystate", async () => {
    const result = await typings.downloadDependencyTypings(
      "reallystate@1.0.11"
    );

    expect(result).toBeTruthy();
  });

  it("can parse urls for csb.dev", async () => {
    const result = await typings.downloadDependencyTypings(
      `@material-ui/core@${encodeURI(
        "https://pkg.csb.dev/mui-org/material-ui/commit/007a0977/@material-ui/core"
      )}`
    );

    expect(result).toBeTruthy();
  }, 10000);

  it("can download single package.json", async () => {
    const result = await typings.downloadDependencyTypings("classy-ui@2.0.0");

    expect(result["/classy-ui/macro/package.json"]).toBeTruthy();
  });

  it("can download single package.json for no types", async () => {
    const result = await typings.downloadDependencyTypings(
      "@styled-system/css@5.1.5"
    );

    expect(result["/@styled-system/css/package.json"]).toBeTruthy();
  });

  it("should clean old dependencies", async () => {
    const dir = path.join(testTypingsFolder, "old-dependency");
    mkdirSync(dir);
    // The check for this is done after all tests are run
    typings.packageInstalls["old-dependency"] =
      Date.now() - typings.cleanUpTime - 1;
    await typings.downloadDependencyTypings("@styled-system/css@5.1.5");
    // Since we do not wait for the cleanup, we have to wait a little bit to ensure it is done
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(dir)).toBe(false);
  });
});
