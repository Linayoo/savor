import { File } from "expo-file-system";
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
      // The app's FormData: React Native's, patched by Expo, whose fetch
      // turns it into the request body
      const reactNative = jest.requireActual(
        "react-native/Libraries/Network/FormData",
      );
      const formData = reactNative.default ?? reactNative;
      jest
        .requireActual("expo/build/winter/FormData")
        .installFormDataPatch(formData);
      global.FormData = formData;
    });

    it("sends a body Expo's fetch can encode: the form's fields first, then the file's bytes", async () => {
      await photoTransfer.upload(form, "file:///cache/copy.jpg");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(form.url);
      expect(init.method).toBe("POST");
      const body = init.body as FormData;
      // Jest can't read files; the bytes come from the copy on the phone
      for (const [, value] of body.entries()) {
        if (typeof value === "object") {
          // Not React Native's { uri, name, type }, which Expo's fetch refuses
          expect(value).toBeInstanceOf(File);
          expect((value as unknown as File).uri).toBe("file:///cache/copy.jpg");
          Object.assign(value, {
            bytes: async () => new TextEncoder().encode("JPEG BYTES"),
          });
        }
      }
      const { convertFormDataAsync } = jest.requireActual(
        "expo/build/winter/fetch/convertFormData",
      );
      const { body: encoded } = await convertFormDataAsync(body, "BOUNDARY");
      const text = new TextDecoder().decode(encoded);

      const names = [...text.matchAll(/form-data; name="([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(names).toEqual(["key", "Content-Type", "file"]);
      expect(text).toContain("\r\n\r\nusers/a/photos/p.jpg\r\n--BOUNDARY\r\n");
      expect(text).toMatch(
        /name="file"; filename="[^"]+"[\s\S]*JPEG BYTES\r\n--BOUNDARY--/,
      );
    });

    it("fails worth retrying when S3 refuses the form, as an expired one", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          "<Error><Code>AccessDenied</Code><Message>Invalid according to Policy</Message></Error>",
          { status: 403 },
        ),
      );

      await expect(
        photoTransfer.upload(form, "file:///cache/copy.jpg"),
      ).rejects.toEqual(
        new SyncError(
          "unavailable",
          "S3 answered 403: <Error><Code>AccessDenied</Code><Message>Invalid according to Policy</Message></Error>",
        ),
      );
    });

    it("fails worth retrying without a connection", async () => {
      fetchMock.mockRejectedValue(new TypeError("Network request failed"));

      await expect(
        photoTransfer.upload(form, "file:///cache/copy.jpg"),
      ).rejects.toEqual(
        new SyncError(
          "unavailable",
          "Couldn't reach S3: TypeError: Network request failed",
        ),
      );
    });
  });

  describe("download", () => {
    const url =
      "https://savor-photos.s3.eu-central-1.amazonaws.com/users/a/photos/p.jpg?X-Amz-Signature=s";

    it("saves the photo into the photos folder, named after it, replacing an earlier try", async () => {
      const downloadFileAsync = jest
        .spyOn(File, "downloadFileAsync")
        .mockImplementation(async (_, destination) => destination as File);

      const name = await photoTransfer.download(url, "photo-1");

      expect(name).toBe("photo-1.jpg");
      const [calledUrl, destination, options] = downloadFileAsync.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect((destination as File).uri).toMatch(/photos\/photo-1\.jpg$/);
      expect(options).toEqual({ idempotent: true });
    });

    it("fails worth retrying when S3 refuses, as with an expired URL", async () => {
      jest
        .spyOn(File, "downloadFileAsync")
        .mockRejectedValue(new Error("response has status 403"));

      await expect(
        photoTransfer.download(url, "photo-1"),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });
});
