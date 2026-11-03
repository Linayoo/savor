import { ImageManipulator } from "expo-image-manipulator";
import { photoTransfer } from "@/photos";
import { SyncError } from "@/sync/api";

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: { manipulate: jest.fn() },
}));

const manipulate = ImageManipulator.manipulate as jest.Mock;

describe("photoTransfer", () => {
  it("makes the upload copy as a new JPEG at 0.8, bounded to 2048 px", async () => {
    const saveAsync = jest.fn(async () => ({
      uri: "file:///cache/ImageManipulator/copy.jpg",
      width: 2048,
      height: 1536,
    }));
    manipulate.mockReturnValue({
      renderAsync: async () => ({ width: 2048, height: 1536, saveAsync }),
    });

    const uri = await photoTransfer.uploadCopy("1793-walk.jpg");

    expect(uri).toBe("file:///cache/ImageManipulator/copy.jpg");
    expect(manipulate).toHaveBeenCalledWith(
      expect.stringMatching(/photos\/1793-walk\.jpg$/),
      { maxWidth: 2048, maxHeight: 2048 },
    );
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.8, format: "jpeg" });
  });

  describe("upload", () => {
    const form = {
      url: "https://savor-photos.s3.eu-central-1.amazonaws.com/",
      fields: { key: "users/a/photos/p.jpg", "Content-Type": "image/jpeg" },
    };
    let fetchMock: jest.Mock;
    beforeEach(() => {
      fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
      global.fetch = fetchMock;
      // Jest has Node's FormData; the app sends React Native's, which takes
      // a file as a uri
      global.FormData = jest.requireActual(
        "react-native/Libraries/Network/FormData",
      ).default;
    });

    it("POSTs the form's fields first and the file last", async () => {
      await photoTransfer.upload(form, "file:///cache/copy.jpg");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(form.url);
      expect(init.method).toBe("POST");
      const parts = (
        init.body as FormData & {
          getParts(): { fieldName: string; string?: string; uri?: string }[];
        }
      ).getParts();
      expect(parts.map((p) => p.fieldName)).toEqual([
        "key",
        "Content-Type",
        "file",
      ]);
      expect(parts[2]).toMatchObject({
        uri: "file:///cache/copy.jpg",
        type: "image/jpeg",
      });
    });

    it("fails worth retrying when S3 refuses the form, as an expired one", async () => {
      fetchMock.mockResolvedValue(
        new Response("AccessDenied", { status: 403 }),
      );

      await expect(
        photoTransfer.upload(form, "file:///cache/copy.jpg"),
      ).rejects.toEqual(new SyncError("unavailable", "S3 answered 403"));
    });

    it("fails worth retrying without a connection", async () => {
      fetchMock.mockRejectedValue(new TypeError("Network request failed"));

      await expect(
        photoTransfer.upload(form, "file:///cache/copy.jpg"),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });
});
