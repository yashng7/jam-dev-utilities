// Note: @squoosh/lib requires Node.js environment.
// For browser compatibility, we'll use a Canvas-based fallback for demonstration.
// In production, this would need server-side integration with @squoosh/lib.

export interface WebPConversionOptions {
  quality: number; // 0-100
  targetSizeBytes?: number; // When set, quality is chosen automatically to stay under this size
}

export interface ConversionResult {
  fileName: string;
  originalSize: number;
  webpSize: number;
  webpData: ArrayBuffer;
  success: boolean;
  error?: string;
  quality?: number;
  width?: number;
  height?: number;
  targetSize?: number;
  targetMet?: boolean;
}

export interface BatchConversionResult {
  results: ConversionResult[];
  totalOriginalSize: number;
  totalWebpSize: number;
  compressionRatio: number;
}

const MIN_OUTPUT_DIMENSION = 16;
const MAX_DOWNSCALE_STEPS = 16;

interface LoadedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
  objectUrl: string;
}

interface EncodedImage {
  webpData: ArrayBuffer;
  webpSize: number;
  width: number;
  height: number;
  quality: number;
}

interface TargetSizeEncodeResult extends EncodedImage {
  targetMet: boolean;
}

/**
 * Convert a user-entered target size in KB to bytes.
 */
export function targetSizeToBytes(value: number): number {
  return Math.round(value * 1024);
}

/**
 * Estimate how much the image needs to be scaled down to reach the target.
 * Uses the square root because file size grows roughly with the pixel count.
 */
export function calculateScaleFactor(
  currentSizeBytes: number,
  targetSizeBytes: number
): number {
  if (
    currentSizeBytes <= 0 ||
    targetSizeBytes <= 0 ||
    currentSizeBytes <= targetSizeBytes
  ) {
    return 1;
  }

  const ratio = Math.sqrt(targetSizeBytes / currentSizeBytes);
  return Math.min(0.9, Math.max(0.25, ratio * 0.95));
}

/**
 * Scale image dimensions while keeping them at least MIN_OUTPUT_DIMENSION
 * pixels wide/tall.
 */
export function scaleDimensions(
  width: number,
  height: number,
  scaleFactor: number
): { width: number; height: number } {
  const safeScale = Math.min(1, Math.max(0, scaleFactor));

  return {
    width: Math.max(MIN_OUTPUT_DIMENSION, Math.round(width * safeScale)),
    height: Math.max(MIN_OUTPUT_DIMENSION, Math.round(height * safeScale)),
  };
}

/**
 * Load an image file once so it can be encoded multiple times during the
 * target size search.
 */
function loadImage(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        objectUrl,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    image.src = objectUrl;
  });
}

/**
 * Draw the image to a canvas and encode it as WebP at a given size/quality.
 */
function encodeImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  quality: number
): Promise<EncodedImage> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create WebP blob"));
            return;
          }

          blob
            .arrayBuffer()
            .then((arrayBuffer) => {
              resolve({
                webpData: arrayBuffer,
                webpSize: arrayBuffer.byteLength,
                width,
                height,
                quality,
              });
            })
            .catch(reject);
        },
        "image/webp",
        quality / 100
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Find the highest quality that still fits within the target size. Quality 1
 * is known to fit and quality 100 is known not to fit.
 */
async function findBestQuality(
  image: HTMLImageElement,
  width: number,
  height: number,
  targetSizeBytes: number,
  smallestResult: EncodedImage
): Promise<EncodedImage> {
  let low = 2;
  let high = 99;
  let best = smallestResult;

  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const result = await encodeImage(image, width, height, quality);

    if (result.webpSize <= targetSizeBytes) {
      best = result;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }

  return best;
}

/**
 * Encode an image so its WebP output is at or below the target size.
 *
 * First tries lowering the quality. If even the lowest quality is too large,
 * the image is progressively downscaled and the quality search is repeated.
 */
async function encodeToTargetSize(
  image: HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  targetSizeBytes: number
): Promise<TargetSizeEncodeResult> {
  let width = Math.max(1, Math.round(sourceWidth));
  let height = Math.max(1, Math.round(sourceHeight));
  let smallestResult: EncodedImage | null = null;

  for (let step = 0; step < MAX_DOWNSCALE_STEPS; step++) {
    const maxQualityResult = await encodeImage(image, width, height, 100);

    if (maxQualityResult.webpSize <= targetSizeBytes) {
      return { ...maxQualityResult, targetMet: true };
    }

    const minQualityResult = await encodeImage(image, width, height, 1);

    if (minQualityResult.webpSize <= targetSizeBytes) {
      const best = await findBestQuality(
        image,
        width,
        height,
        targetSizeBytes,
        minQualityResult
      );
      return { ...best, targetMet: true };
    }

    smallestResult = minQualityResult;

    const scaleFactor = calculateScaleFactor(
      minQualityResult.webpSize,
      targetSizeBytes
    );
    const nextDimensions = scaleDimensions(width, height, scaleFactor);

    if (nextDimensions.width === width && nextDimensions.height === height) {
      break;
    }

    width = nextDimensions.width;
    height = nextDimensions.height;
  }

  const fallback =
    smallestResult ?? (await encodeImage(image, width, height, 1));

  return {
    ...fallback,
    targetMet: fallback.webpSize <= targetSizeBytes,
  };
}

/**
 * Convert a single image file to WebP format.
 */
export async function convertToWebP(
  file: File,
  options: WebPConversionOptions
): Promise<ConversionResult> {
  let loadedImage: LoadedImage | null = null;

  try {
    loadedImage = await loadImage(file);

    const requestedTargetSize = options.targetSizeBytes;
    // Never make an image larger than the original file.
    const targetSize =
      requestedTargetSize && requestedTargetSize > 0
        ? Math.min(requestedTargetSize, file.size)
        : undefined;

    const encoded =
      targetSize && targetSize > 0
        ? await encodeToTargetSize(
            loadedImage.image,
            loadedImage.width,
            loadedImage.height,
            targetSize
          )
        : {
            ...(await encodeImage(
              loadedImage.image,
              loadedImage.width,
              loadedImage.height,
              options.quality
            )),
            targetMet: undefined,
          };

    return {
      fileName: file.name.replace(/\.[^/.]+$/, ".webp"),
      originalSize: file.size,
      webpSize: encoded.webpSize,
      webpData: encoded.webpData,
      success: true,
      quality: encoded.quality,
      width: encoded.width,
      height: encoded.height,
      ...(requestedTargetSize && requestedTargetSize > 0
        ? {
            targetSize: requestedTargetSize,
            targetMet: encoded.targetMet ?? false,
          }
        : {}),
    };
  } catch (error) {
    return {
      fileName: file.name,
      originalSize: file.size,
      webpSize: 0,
      webpData: new ArrayBuffer(0),
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      ...(options.targetSizeBytes && options.targetSizeBytes > 0
        ? { targetSize: options.targetSizeBytes, targetMet: false }
        : {}),
    };
  } finally {
    if (loadedImage) {
      URL.revokeObjectURL(loadedImage.objectUrl);
    }
  }
}

/**
 * Convert multiple image files to WebP format
 */
export async function batchConvertToWebP(
  files: File[],
  options: WebPConversionOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<BatchConversionResult> {
  const results: ConversionResult[] = [];
  let totalOriginalSize = 0;
  let totalWebpSize = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const result = await convertToWebP(file, options);
    results.push(result);

    totalOriginalSize += result.originalSize;
    totalWebpSize += result.webpSize;

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  const compressionRatio =
    totalOriginalSize > 0
      ? ((totalOriginalSize - totalWebpSize) / totalOriginalSize) * 100
      : 0;

  return {
    results,
    totalOriginalSize,
    totalWebpSize,
    compressionRatio,
  };
}

/**
 * Create download URL for WebP data
 */
export function createWebPDownloadUrl(webpData: ArrayBuffer): string {
  const blob = new Blob([webpData], { type: "image/webp" });
  return URL.createObjectURL(blob);
}

/**
 * Download a single WebP file
 */
export function downloadWebP(webpData: ArrayBuffer, fileName: string): void {
  const url = createWebPDownloadUrl(webpData);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Create and download a ZIP file containing all converted WebP files
 */
export async function downloadWebPZip(
  results: ConversionResult[]
): Promise<void> {
  // For now, we'll download files individually since adding zip functionality
  // would require additional dependencies. This can be enhanced later.
  const successfulResults = results.filter((r) => r.success);

  successfulResults.forEach((result, index) => {
    // Add a small delay between downloads to avoid browser blocking
    setTimeout(() => {
      downloadWebP(result.webpData, result.fileName);
    }, index * 100);
  });
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const result = bytes / Math.pow(k, i);
  return `${result % 1 === 0 ? result : parseFloat(result.toFixed(1))} ${sizes[i]}`;
}

/**
 * Validate if file is a supported image format
 */
export function isSupportedImageFormat(file: File): boolean {
  const supportedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/bmp",
    "image/gif",
    "image/tiff",
    "image/webp",
  ];

  return supportedTypes.includes(file.type.toLowerCase());
}

/**
 * Filter files to only include supported image formats
 */
export function filterSupportedImages(files: File[]): File[] {
  return files.filter(isSupportedImageFormat);
}

/**
 * Clean up resources (no-op for Canvas-based implementation)
 */
export function cleanup(): void {
  // No cleanup needed for Canvas-based implementation
}
