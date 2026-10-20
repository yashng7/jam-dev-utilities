import { convertToWebP } from "./webp-converter.utils";

const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 600;
const WEBP_OVERHEAD_BYTES = 100;

class MockImage {
  naturalWidth = IMAGE_WIDTH;
  naturalHeight = IMAGE_HEIGHT;
  width = IMAGE_WIDTH;
  height = IMAGE_HEIGHT;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    setTimeout(() => this.onload?.(), 0);
  }
}

const createMockCanvas = () => {
  let canvasWidth = 0;
  let canvasHeight = 0;

  return {
    get width() {
      return canvasWidth;
    },
    set width(value: number) {
      canvasWidth = value;
    },
    get height() {
      return canvasHeight;
    },
    set height(value: number) {
      canvasHeight = value;
    },
    getContext: () =>
      ({
        drawImage: jest.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      }) as unknown as CanvasRenderingContext2D,
    toBlob: (callback: BlobCallback, _type?: string, quality = 1) => {
      // Roughly model WebP output size: it grows with pixel count and quality.
      const size =
        WEBP_OVERHEAD_BYTES +
        Math.round(canvasWidth * canvasHeight * 0.5 * quality);
      callback(new Blob([new Uint8Array(size)], { type: "image/webp" }));
    },
  } as unknown as HTMLCanvasElement;
};

describe("convertToWebP target size mode", () => {
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    originalCreateElement = document.createElement.bind(document);

    jest
      .spyOn(document, "createElement")
      .mockImplementation(
        (tagName: string, options?: ElementCreationOptions) => {
          if (tagName === "canvas") {
            return createMockCanvas();
          }

          return originalCreateElement(tagName, options);
        }
      );

    Object.defineProperty(window, "Image", {
      configurable: true,
      writable: true,
      value: MockImage,
    });

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: jest.fn(() => "blob:mock-image"),
    });

    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createFile = (sizeInBytes = 500_000) =>
    new File([new Uint8Array(sizeInBytes)], "photo.jpg", {
      type: "image/jpeg",
    });

  it("uses the provided quality when no target size is set", async () => {
    const result = await convertToWebP(createFile(), { quality: 80 });

    expect(result.success).toBe(true);
    expect(result.quality).toBe(80);
    expect(result.width).toBe(IMAGE_WIDTH);
    expect(result.height).toBe(IMAGE_HEIGHT);
    expect(result.targetSize).toBeUndefined();
    expect(result.targetMet).toBeUndefined();
    expect(result.webpSize).toBe(
      WEBP_OVERHEAD_BYTES + Math.round(IMAGE_WIDTH * IMAGE_HEIGHT * 0.5 * 0.8)
    );
  });

  it("finds the highest quality that fits the target without downscaling", async () => {
    const targetSize = 100 * 1024;

    const result = await convertToWebP(createFile(), {
      quality: 80,
      targetSizeBytes: targetSize,
    });

    expect(result.success).toBe(true);
    expect(result.targetMet).toBe(true);
    expect(result.webpSize).toBeLessThanOrEqual(targetSize);
    expect(result.width).toBe(IMAGE_WIDTH);
    expect(result.height).toBe(IMAGE_HEIGHT);
    expect(result.quality).toBeGreaterThan(1);
    expect(result.quality).toBeLessThan(100);
  });

  it("downscales the image when the lowest quality is still too large", async () => {
    const targetSize = 1000;

    const result = await convertToWebP(createFile(), {
      quality: 80,
      targetSizeBytes: targetSize,
    });

    expect(result.success).toBe(true);
    expect(result.targetMet).toBe(true);
    expect(result.webpSize).toBeLessThanOrEqual(targetSize);
    expect(result.width).toBeLessThan(IMAGE_WIDTH);
    expect(result.height).toBeLessThan(IMAGE_HEIGHT);
  });

  it("caps the target to the original size so images are not enlarged", async () => {
    const originalSize = 200_000;

    const result = await convertToWebP(createFile(originalSize), {
      quality: 80,
      targetSizeBytes: 1024 * 1024,
    });

    expect(result.success).toBe(true);
    expect(result.targetMet).toBe(true);
    expect(result.targetSize).toBe(1024 * 1024);
    expect(result.webpSize).toBeLessThanOrEqual(originalSize);
    expect(result.quality).toBeLessThan(100);
  });

  it("returns the smallest possible image when the target cannot be met", async () => {
    const result = await convertToWebP(createFile(), {
      quality: 80,
      targetSizeBytes: 1,
    });

    expect(result.success).toBe(true);
    expect(result.targetMet).toBe(false);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.quality).toBe(1);
  });
});
