import * as typings from "../api/typings";

describe("fetchTypings", () => {
  it("exits early for dependencies with no types", async () => {
    const result = await typings.downloadDependencyTypings("react@latest");

    expect(result.files).toEqual({});
  });

  it("includes src directory files for @angular/core", async () => {
    const result = await typings.downloadDependencyTypings(
      "@angular/core@latest"
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
  });

  it("doesn't include files for packages with no types", async () => {
    const result = await typings.downloadDependencyTypings("react@16.8.0");

    expect(result.files).toEqual({});
  });
});
