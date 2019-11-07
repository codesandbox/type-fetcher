import * as typings from "../api/typings";

describe("fetchTypings", () => {
  it("exits early for dependencies with no types", async () => {
    const result = await typings.downloadDependencyTypings("react@latest");

    expect(result.files).toEqual({});
  });

  it("includes src directory files for @angular/core", async () => {
    const result = await typings.downloadDependencyTypings(
      "@angular/core@7.0.0"
    );

    expect(
      result.files["/@angular/core/src/application_tokens.d.ts"]
    ).not.toBeFalsy();
  });

  it("includes .d.ts files for @dojo/framework", async () => {
    const result = await typings.downloadDependencyTypings(
      "@dojo/framework@5.0.0"
    );

    expect(result.files["/@dojo/framework/stores/Store.d.ts"]).not.toBeFalsy();
  }, 10000);

  it("doesn't include files for packages with no types", async () => {
    const result = await typings.downloadDependencyTypings("react@16.8.0");

    expect(result.files).toEqual({});
  });

  it("doesn't return a 404 for reallystate", async () => {
    const result = await typings.downloadDependencyTypings(
      "reallystate@1.0.11"
    );

    expect(result.files).toBeTruthy();
  });

  it("can parse urls for csb.dev", async () => {
    const result = await typings.downloadDependencyTypings(
      "@material-ui/core@https:/pkg.csb.dev/mui-org/material-ui/commit/007a0977/@material-ui/core"
    );

    expect(result.files).toBeTruthy();
  }, 10000);
});
