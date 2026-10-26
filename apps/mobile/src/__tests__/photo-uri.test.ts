import { photoUri } from "../moments";

describe("photoUri", () => {
  it("keeps old temporary file uris as they are", () => {
    expect(photoUri("file:///tmp/old.jpg")).toBe("file:///tmp/old.jpg");
  });

  it("resolves a saved photo name inside the photos folder", () => {
    expect(photoUri("123-a.jpg")).toMatch(/photos\/123-a\.jpg$/);
  });
});
