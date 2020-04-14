import * as typings from "../api/typings";

describe("fetchTypings", () => {
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
});
