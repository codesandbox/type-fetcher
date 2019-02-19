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
});
