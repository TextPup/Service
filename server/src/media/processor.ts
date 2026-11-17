import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

export const MAX_IMAGE_BYTES = 750 * 1024; // 750 KB carrier limit
export const MAX_VIDEO_BYTES = 850 * 1024; // 850 KB carrier limit
export const MAX_DOCUMENT_BYTES = 1024 * 1024; // 1 MB upload ceiling

export type MediaKind = "image" | "video" | "audio" | "document";

/**
 * Classifies a MIME type into one of TextPup's four media kinds.
 */
export function classifyMediaKind(mimeType: string): MediaKind {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  if (normalized.startsWith("audio/")) {
    return "audio";
  }
  return "document";
}

/**
 * Extracts image metadata (width, height, format).
 */
export async function getImageMetadata(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  };
}

/**
 * Image Processing Pipeline (sharp):
 * 1. Strips all EXIF / GPS metadata.
 * 2. Constrains longest edge to max 1600px.
 * 3. Iteratively adjusts JPEG quality from 82 down to 65 to ensure <= 750 KB.
 */
export async function compressImage(buffer: Buffer): Promise<{
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}> {
  let instance = sharp(buffer, { failOnError: false })
    .rotate() // Auto-orient based on EXIF before stripping
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    });

  // Attempt quality steps: 82, 76, 70, 65
  const qualitySteps = [82, 76, 70, 65];
  let currentBuffer: Buffer | null = null;
  let currentMeta: sharp.OutputInfo | null = null;

  for (const quality of qualitySteps) {
    const { data, info } = await instance
      .clone()
      .jpeg({
        quality,
        mozjpeg: true,
        force: true,
      })
      .toBuffer({ resolveWithObject: true });

    currentBuffer = data;
    currentMeta = info;

    if (data.length <= MAX_IMAGE_BYTES) {
      break;
    }
  }

  // If still larger than 750 KB at quality 65, downscale dimensions
  let currentDim = 1280;
  while (currentBuffer && currentBuffer.length > MAX_IMAGE_BYTES && currentDim >= 640) {
    const { data, info } = await sharp(buffer, { failOnError: false })
      .rotate()
      .resize({
        width: currentDim,
        height: currentDim,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 65,
        mozjpeg: true,
        force: true,
      })
      .toBuffer({ resolveWithObject: true });

    currentBuffer = data;
    currentMeta = info;
    currentDim -= 200;
  }

  if (!currentBuffer || !currentMeta) {
    throw new Error("Failed to process image buffer");
  }

  return {
    data: currentBuffer,
    mimeType: "image/jpeg",
    width: currentMeta.width,
    height: currentMeta.height,
    sizeBytes: currentBuffer.length,
  };
}

/**
 * Generates a high-efficiency 240px wide WebP thumbnail (quality: 60) for fast UI previews.
 */
export async function generateImageThumbnail(buffer: Buffer): Promise<{
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}> {
  const { data, info } = await sharp(buffer, { failOnError: false })
    .rotate()
    .resize({
      width: 240,
      fit: "inside",
      withoutEnlargement: false,
    })
    .webp({ quality: 60, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    mimeType: "image/webp",
    width: info.width,
    height: info.height,
    sizeBytes: data.length,
  };
}

/**
 * Video Processing Pipeline (ffmpeg):
 * 1. Inspects video duration and size.
 * 2. If > 850 KB, transcodes to 360p or 480p H.264 Baseline MP4 + mono AAC audio constrained to fit under 850 KB.
 */
export async function compressVideo(buffer: Buffer): Promise<{
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(tmpDir, `textpup_in_${id}.tmp`);
  const outputPath = path.join(tmpDir, `textpup_out_${id}.mp4`);

  try {
    await fs.writeFile(inputPath, buffer);

    // Probe duration using ffprobe
    let durationSec = 10;
    let inWidth = 640;
    let inHeight = 360;

    try {
      const probeRes = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=width,height",
        "-of",
        "json",
        inputPath,
      ]);
      const probeData = JSON.parse(probeRes.stdout);
      if (probeData.format && probeData.format.duration) {
        durationSec = Math.max(1, parseFloat(probeData.format.duration));
      }
      if (probeData.streams && probeData.streams[0]) {
        inWidth = probeData.streams[0].width || inWidth;
        inHeight = probeData.streams[0].height || inHeight;
      }
    } catch {
      // Fallback default duration
    }

    // Target 800 KB to guarantee staying well under the 850 KB carrier ceiling
    const targetBits = 800 * 1024 * 8;
    const audioBitrateBps = 48000; // 48 kbps mono AAC
    let videoBitrateBps = Math.floor(targetBits / durationSec) - audioBitrateBps;
    if (videoBitrateBps < 50000) {
      videoBitrateBps = 50000; // 50 kbps floor
    }

    // Choose scale: 360p or 480p depending on duration and orientation
    const scaleFilter = durationSec > 20 ? "scale=-2:360" : "scale=-2:480";

    const ffmpegArgs = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.0",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      scaleFilter,
      "-b:v",
      `${videoBitrateBps}`,
      "-maxrate",
      `${Math.floor(videoBitrateBps * 1.2)}`,
      "-bufsize",
      `${videoBitrateBps * 2}`,
      "-c:a",
      "aac",
      "-ac",
      "1",
      "-b:a",
      "48k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    await execFileAsync("ffmpeg", ffmpegArgs);

    const compressedData = await fs.readFile(outputPath);

    // Extract actual width & height of transcoded video
    let outWidth = 640;
    let outHeight = 360;
    try {
      const probeOut = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        outputPath,
      ]);
      const outJson = JSON.parse(probeOut.stdout);
      if (outJson.streams && outJson.streams[0]) {
        outWidth = outJson.streams[0].width || outWidth;
        outHeight = outJson.streams[0].height || outHeight;
      }
    } catch {
      // Keep defaults
    }

    return {
      data: compressedData,
      mimeType: "video/mp4",
      width: outWidth,
      height: outHeight,
      sizeBytes: compressedData.length,
    };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Extracts frame at 00:00:01 (or earliest frame) and encodes as a 240px WebP thumbnail poster.
 */
export async function generateVideoThumbnail(videoBuffer: Buffer): Promise<{
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(tmpDir, `textpup_vthumb_${id}.mp4`);
  const framePath = path.join(tmpDir, `textpup_frame_${id}.jpg`);

  try {
    await fs.writeFile(inputPath, videoBuffer);

    // Extract 1 frame at 00:00:01 (or 0s if short)
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      "00:00:01",
      "-i",
      inputPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      framePath,
    ]);

    const frameBytes = await fs.readFile(framePath);
    return await generateImageThumbnail(frameBytes);
  } catch {
    // If seek at 1s failed, try seek at 00:00:00
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        "00:00:00",
        "-i",
        inputPath,
        "-vframes",
        "1",
        "-q:v",
        "2",
        framePath,
      ]);
      const frameBytes = await fs.readFile(framePath);
      return await generateImageThumbnail(frameBytes);
    } catch (err) {
      throw new Error(`Failed to generate video thumbnail: ${err}`);
    }
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(framePath).catch(() => {});
  }
}

export interface ProcessedMediaPayload {
  kind: MediaKind;
  mimeType: string;
  compressedBuffer: Buffer;
  thumbBuffer: Buffer | null;
  width?: number;
  height?: number;
  sizeBytes: number;
}

/**
 * High-level processor for outbound media attachments.
 * Enforces carrier limits, applies compression, and generates thumbnails.
 */
export async function processOutboundMedia(
  rawBuffer: Buffer,
  mimeType: string
): Promise<ProcessedMediaPayload> {
  const kind = classifyMediaKind(mimeType);

  if (kind === "image") {
    const { data, mimeType: outMime, width, height, sizeBytes } = await compressImage(rawBuffer);
    const thumb = await generateImageThumbnail(data);

    return {
      kind: "image",
      mimeType: outMime,
      compressedBuffer: data,
      thumbBuffer: thumb.data,
      width,
      height,
      sizeBytes,
    };
  }

  if (kind === "video") {
    let videoData = rawBuffer;
    let videoWidth = 640;
    let videoHeight = 360;

    if (rawBuffer.length > MAX_VIDEO_BYTES) {
      const res = await compressVideo(rawBuffer);
      videoData = res.data;
      videoWidth = res.width;
      videoHeight = res.height;
    }

    const thumb = await generateVideoThumbnail(videoData);

    return {
      kind: "video",
      mimeType: "video/mp4",
      compressedBuffer: videoData,
      thumbBuffer: thumb.data,
      width: videoWidth,
      height: videoHeight,
      sizeBytes: videoData.length,
    };
  }

  // Audio or generic Document (vCard, PDF, etc.)
  if (rawBuffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Attachment size (${Math.round(rawBuffer.length / 1024)} KB) exceeds carrier MMS limit of ${Math.round(MAX_DOCUMENT_BYTES / 1024)} KB`
    );
  }

  return {
    kind,
    mimeType,
    compressedBuffer: rawBuffer,
    thumbBuffer: null,
    sizeBytes: rawBuffer.length,
  };
}

/**
 * High-level processor for inbound media attachments received from cellular radio webhooks.
 * Generates thumbnail previews for fast UI rendering.
 */
export async function processInboundMedia(
  rawBuffer: Buffer,
  mimeType: string
): Promise<{
  kind: MediaKind;
  thumbBuffer: Buffer | null;
  width?: number;
  height?: number;
  sizeBytes: number;
}> {
  const kind = classifyMediaKind(mimeType);

  if (kind === "image") {
    try {
      const meta = await getImageMetadata(rawBuffer);
      const thumb = await generateImageThumbnail(rawBuffer);
      return {
        kind: "image",
        thumbBuffer: thumb.data,
        width: meta.width,
        height: meta.height,
        sizeBytes: rawBuffer.length,
      };
    } catch {
      return {
        kind: "image",
        thumbBuffer: null,
        sizeBytes: rawBuffer.length,
      };
    }
  }

  if (kind === "video") {
    try {
      const thumb = await generateVideoThumbnail(rawBuffer);
      return {
        kind: "video",
        thumbBuffer: thumb.data,
        sizeBytes: rawBuffer.length,
      };
    } catch {
      return {
        kind: "video",
        thumbBuffer: null,
        sizeBytes: rawBuffer.length,
      };
    }
  }

  return {
    kind,
    thumbBuffer: null,
    sizeBytes: rawBuffer.length,
  };
}
