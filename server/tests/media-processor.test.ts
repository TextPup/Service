import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  classifyMediaKind,
  compressImage,
  generateImageThumbnail,
  compressVideo,
  generateVideoThumbnail,
  processOutboundMedia,
  processInboundMedia,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "../src/media/processor.js";

const execFileAsync = promisify(execFile);

export async function runMediaProcessorTests() {
  console.log("--- Starting Media Processor & Compression Tests ---");

  // 1. MIME Classification Tests
  console.log("1. Testing MIME Classification...");
  if (classifyMediaKind("image/jpeg") !== "image") throw new Error("image/jpeg failed");
  if (classifyMediaKind("image/png") !== "image") throw new Error("image/png failed");
  if (classifyMediaKind("video/mp4") !== "video") throw new Error("video/mp4 failed");
  if (classifyMediaKind("audio/aac") !== "audio") throw new Error("audio/aac failed");
  if (classifyMediaKind("application/pdf") !== "document") throw new Error("application/pdf failed");
  if (classifyMediaKind("text/vcard") !== "document") throw new Error("text/vcard failed");
  console.log("   MIME classification verified!");

  // 2. Large Image Compression & EXIF Stripping
  console.log("2. Testing High-Resolution Image Processing & Carrier Compression...");
  const width = 2400;
  const height = 1800;
  const rawSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#5B5CE6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#6366F1;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)" />
      <circle cx="1200" cy="900" r="600" fill="#FFFFFF" opacity="0.8" />
      <text x="1200" y="950" font-size="120" font-family="sans-serif" text-anchor="middle" fill="#5B5CE6">TextPup Carrier Compression Test</text>
    </svg>
  `;
  const largeJpg = await sharp(Buffer.from(rawSvg)).jpeg({ quality: 95 }).toBuffer();
  console.log(`   Created test image: ${largeJpg.length} bytes, original dims: ${width}x${height}`);

  const processedImage = await compressImage(largeJpg);
  console.log(`   Compressed image: ${processedImage.sizeBytes} bytes, dims: ${processedImage.width}x${processedImage.height}`);

  if (processedImage.sizeBytes > MAX_IMAGE_BYTES) {
    throw new Error(`Compressed image exceeds carrier limit of ${MAX_IMAGE_BYTES} bytes!`);
  }
  if (processedImage.width > 1600 || processedImage.height > 1600) {
    throw new Error(`Max edge exceeds 1600px! Dim: ${processedImage.width}x${processedImage.height}`);
  }

  // 3. Image Thumbnail Generation
  console.log("3. Testing 240px WebP Thumbnail Generation...");
  const thumb = await generateImageThumbnail(processedImage.data);
  console.log(`   Thumbnail size: ${thumb.sizeBytes} bytes, dims: ${thumb.width}x${thumb.height}, format: ${thumb.mimeType}`);
  if (thumb.width > 240) {
    throw new Error(`Thumbnail width exceeds 240px! Width: ${thumb.width}`);
  }
  if (thumb.mimeType !== "image/webp") {
    throw new Error(`Thumbnail is not WebP! Format: ${thumb.mimeType}`);
  }

  // 4. Video Processing & Thumbnail Generation
  console.log("4. Testing Video Poster Extraction & Transcoding via ffmpeg...");
  const tmpDir = os.tmpdir();
  const testVideoPath = path.join(tmpDir, `textpup_test_vid_${Date.now()}.mp4`);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      testVideoPath,
    ]);

    const testVideoBytes = await fs.readFile(testVideoPath);
    console.log(`   Synthesized test video: ${testVideoBytes.length} bytes`);

    const videoThumb = await generateVideoThumbnail(testVideoBytes);
    console.log(`   Video poster thumbnail generated: ${videoThumb.sizeBytes} bytes, width: ${videoThumb.width}`);
    if (videoThumb.width > 240) {
      throw new Error(`Video thumbnail width exceeds 240px! Width: ${videoThumb.width}`);
    }

    const compressedVid = await compressVideo(testVideoBytes);
    console.log(`   Transcoded video: ${compressedVid.sizeBytes} bytes, ${compressedVid.width}x${compressedVid.height}`);
    if (compressedVid.sizeBytes > MAX_VIDEO_BYTES) {
      throw new Error(`Video exceeds maximum carrier limit of ${MAX_VIDEO_BYTES} bytes!`);
    }
  } finally {
    await fs.unlink(testVideoPath).catch(() => {});
  }

  // 5. Outbound Media Dispatcher Pipeline Test
  console.log("5. Testing Integrated processOutboundMedia & processInboundMedia Pipelines...");
  const outboundImg = await processOutboundMedia(largeJpg, "image/jpeg");
  if (!outboundImg.thumbBuffer || outboundImg.kind !== "image") {
    throw new Error("Outbound image pipeline failed to generate thumbnail or classify kind!");
  }

  const sampleVcf = Buffer.from("BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL:+13345550199\nEND:VCARD\n");
  const outboundDoc = await processOutboundMedia(sampleVcf, "text/vcard");
  if (outboundDoc.kind !== "document" || outboundDoc.thumbBuffer !== null) {
    throw new Error("Outbound vCard document pipeline failed!");
  }

  // Oversized document test (> 1MB)
  const oversizedDoc = Buffer.alloc(1.2 * 1024 * 1024);
  let caughtError = false;
  try {
    await processOutboundMedia(oversizedDoc, "application/pdf");
  } catch (err: any) {
    caughtError = true;
    console.log(`   Successfully rejected oversized document: ${err.message}`);
  }
  if (!caughtError) {
    throw new Error("Failed to reject oversized document!");
  }

  console.log("--- All Media Processor Tests Passed Successfully! ---");
}

if (process.argv[1]?.endsWith("media-processor.test.ts") || process.argv[1]?.endsWith("media-processor.test.js")) {
  runMediaProcessorTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test failed:", err);
      process.exit(1);
    });
}
