import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { attachments } from "../db/schema.js";
import { decryptMediaFile } from "../crypto/mediaCrypto.js";
import { decryptField } from "../crypto/vault.js";
import { requireAuth, type AuthEnv } from "../auth/session.js";

export const mediaRouter = new Hono<AuthEnv>();

mediaRouter.use("/:id", requireAuth);

/**
 * GET /api/media/:id?variant=thumb|full
 * Authenticated decrypted media streamer for images, video, audio, and attachments.
 */
mediaRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const variant = c.req.query("variant") || "full";

  const attachment = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!attachment) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  // Handle Thumbnail Request
  if (variant === "thumb") {
    if (!attachment.thumbPath || !attachment.thumbIvAndTag) {
      // If no thumbnail available, fallback to full if image, otherwise 404
      if (attachment.kind !== "image") {
        return c.json({ error: "No thumbnail available for this attachment" }, 404);
      }
    } else {
      try {
        const thumbBytes = await decryptMediaFile(
          attachment.thumbPath,
          attachment.thumbIvAndTag
        );

        return new Response(thumbBytes, {
          headers: {
            "Content-Type": "image/webp",
            "Content-Length": String(thumbBytes.length),
            "Cache-Control": "private, max-age=86400",
          },
        });
      } catch (err: any) {
        console.error(`Failed to decrypt thumbnail for ${id}:`, err);
        return c.json({ error: "Failed to decrypt media thumbnail" }, 500);
      }
    }
  }

  // Handle Full Media Request
  try {
    const fullBytes = await decryptMediaFile(
      attachment.storagePath,
      attachment.ivAndTag
    );

    let filename = "attachment";
    if (attachment.filenameEnc) {
      try {
        filename = decryptField(attachment.filenameEnc);
      } catch {
        // fallback
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Length": String(fullBytes.length),
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    };

    return new Response(fullBytes, { headers });
  } catch (err: any) {
    console.error(`Failed to decrypt media for ${id}:`, err);
    return c.json({ error: "Failed to decrypt media file" }, 500);
  }
});
