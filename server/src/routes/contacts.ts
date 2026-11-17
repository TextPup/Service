import { Hono } from "hono";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq, desc } from "drizzle-orm";

const execAsync = promisify(exec);
import { db } from "../db/client.js";
import { contacts, threads } from "../db/schema.js";
import {
  encryptField,
  decryptField,
  decryptFieldOrNull,
  hashPhone,
  normalizePhone,
  isVaultUnlocked,
} from "../crypto/vault.js";
import { requireAuth, type AuthEnv } from "../auth/session.js";

export const contactsRouter = new Hono<AuthEnv>();

contactsRouter.use("*", requireAuth);

const AVATAR_PALETTE = [
  "#5B5CE6", // Indigo
  "#059669", // Emerald
  "#D97706", // Amber
  "#DC2626", // Red
  "#7C3AED", // Purple
  "#2563EB", // Blue
  "#DB2777", // Pink
  "#0891B2", // Cyan
];

function getRandomAvatarColor(): string {
  return AVATAR_PALETTE[Math.floor(Math.random() * AVATAR_PALETTE.length)];
}

/**
 * GET /api/contacts: List all contacts decrypted
 */
contactsRouter.get("/", (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const rawContacts = db.select().from(contacts).all();

  const decrypted = rawContacts
    .map((ct) => {
      try {
        return {
          id: ct.id,
          phone: decryptField(ct.phoneEnc),
          displayName: decryptField(ct.displayNameEnc),
          notes: decryptFieldOrNull(ct.notesEnc),
          avatarColor: ct.avatarColor,
          preferredSim: ct.preferredSim,
          createdAt: ct.createdAt,
          updatedAt: ct.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{
    id: string;
    phone: string;
    displayName: string;
    notes: string | null;
    avatarColor: string;
    preferredSim: number | null;
    createdAt: number;
    updatedAt: number;
  }>;

  decrypted.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return c.json({ contacts: decrypted });
});

/**
 * POST /api/contacts: Create new contact
 */
contactsRouter.post("/", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const body = await c.req.json().catch(() => ({}));
  const { phone, displayName, notes, avatarColor, preferredSim } = body;

  if (!phone || !displayName) {
    return c.json({ error: "Phone number and Display Name are required" }, 400);
  }

  const e164 = normalizePhone(phone);
  if (!e164) {
    return c.json({ error: "Invalid phone number format" }, 400);
  }

  const phoneHash = hashPhone(e164);
  const now = Date.now();
  const contactId = crypto.randomUUID();

  // Check if contact already exists
  const existing = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();
  if (existing) {
    return c.json({ error: "A contact with this phone number already exists" }, 409);
  }

  const color = avatarColor || getRandomAvatarColor();

  db.insert(contacts)
    .values({
      id: contactId,
      phoneHash,
      phoneEnc: encryptField(e164),
      displayNameEnc: encryptField(displayName.trim()),
      notesEnc: notes ? encryptField(notes.trim()) : null,
      avatarColor: color,
      preferredSim: preferredSim ? Number(preferredSim) : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Automatically link any existing thread for this number to the new contact
  db.update(threads)
    .set({ contactId })
    .where(eq(threads.phoneHash, phoneHash))
    .run();

  return c.json({
    contact: {
      id: contactId,
      phone: e164,
      displayName: displayName.trim(),
      notes: notes ? notes.trim() : null,
      avatarColor: color,
      preferredSim: preferredSim ? Number(preferredSim) : null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

/**
 * PUT /api/contacts/:id: Update existing contact
 */
contactsRouter.put("/:id", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const id = c.req.param("id");
  const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!existing) {
    return c.json({ error: "Contact not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const { phone, displayName, notes, avatarColor, preferredSim } = body;

  const now = Date.now();
  let e164 = decryptField(existing.phoneEnc);
  let phoneHash = existing.phoneHash;

  if (phone) {
    const newE164 = normalizePhone(phone);
    if (newE164 && newE164 !== e164) {
      e164 = newE164;
      phoneHash = hashPhone(newE164);
    }
  }

  const newDisplayName = displayName ? displayName.trim() : decryptField(existing.displayNameEnc);
  const newNotes = notes !== undefined ? (notes ? notes.trim() : null) : decryptFieldOrNull(existing.notesEnc);
  const color = avatarColor || existing.avatarColor;
  const sim = preferredSim !== undefined ? (preferredSim ? Number(preferredSim) : null) : existing.preferredSim;

  db.update(contacts)
    .set({
      phoneHash,
      phoneEnc: encryptField(e164),
      displayNameEnc: encryptField(newDisplayName),
      notesEnc: newNotes ? encryptField(newNotes) : null,
      avatarColor: color,
      preferredSim: sim,
      updatedAt: now,
    })
    .where(eq(contacts.id, id))
    .run();

  // Relink threads
  db.update(threads).set({ contactId: id }).where(eq(threads.phoneHash, phoneHash)).run();

  return c.json({
    contact: {
      id,
      phone: e164,
      displayName: newDisplayName,
      notes: newNotes,
      avatarColor: color,
      preferredSim: sim,
      createdAt: existing.createdAt,
      updatedAt: now,
    },
  });
});

/**
 * DELETE /api/contacts/:id: Delete contact
 */
contactsRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  db.delete(contacts).where(eq(contacts.id, id)).run();
  db.update(threads).set({ contactId: null }).where(eq(threads.contactId, id)).run();
  return c.json({ success: true });
});

/**
 * POST /api/contacts/import-vcf: Bulk vCard (.vcf) Importer
 */
contactsRouter.post("/import-vcf", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  let vcfText = "";
  const contentType = c.req.header("Content-Type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file") as File | null;
    if (file) {
      vcfText = await file.text();
    }
  } else {
    vcfText = await c.req.text();
  }

  if (!vcfText || !vcfText.includes("BEGIN:VCARD")) {
    return c.json({ error: "No valid vCard records found in payload" }, 400);
  }

  // Normalize unfolding (RFC 6350): remove CRLF + whitespace
  const unfolded = vcfText.replace(/\r?\n[ \t]/g, "");
  const cardBlocks = unfolded.split(/BEGIN:VCARD/i).slice(1);

  let importedCount = 0;
  let skippedCount = 0;
  const now = Date.now();

  for (const block of cardBlocks) {
    const lines = block.split(/\r?\n/);
    let displayName = "";
    const phones: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("FN:") || trimmed.startsWith("FN;")) {
        displayName = trimmed.replace(/^FN[^:]*:/i, "").trim();
      } else if (!displayName && (trimmed.startsWith("N:") || trimmed.startsWith("N;"))) {
        const rawName = trimmed.replace(/^N[^:]*:/i, "");
        const parts = rawName.split(";").filter(Boolean);
        displayName = parts.reverse().join(" ").trim();
      } else if (trimmed.startsWith("TEL:") || trimmed.startsWith("TEL;")) {
        const rawTel = trimmed.replace(/^TEL[^:]*:/i, "").trim();
        const normalized = normalizePhone(rawTel);
        if (normalized) {
          phones.push(normalized);
        }
      }
    }

    if (!displayName) {
      displayName = phones[0] || "Unknown Contact";
    }

    for (const phone of phones) {
      try {
        const phoneHash = hashPhone(phone);
        const existing = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();

        if (existing) {
          skippedCount++;
          continue;
        }

        const contactId = crypto.randomUUID();
        db.insert(contacts)
          .values({
            id: contactId,
            phoneHash,
            phoneEnc: encryptField(phone),
            displayNameEnc: encryptField(displayName),
            avatarColor: getRandomAvatarColor(),
            createdAt: now,
            updatedAt: now,
          })
          .run();

        // Link existing threads
        db.update(threads).set({ contactId }).where(eq(threads.phoneHash, phoneHash)).run();
        importedCount++;
      } catch {
        skippedCount++;
      }
    }
  }

  return c.json({
    success: true,
    importedCount,
    skippedCount,
    totalCards: cardBlocks.length,
  });
});

/**
 * POST /api/contacts/import-phone: Query connected Android phone via ADB and import contacts
 */
contactsRouter.post("/import-phone", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  let rawOutput = "";
  try {
    const { stdout } = await execAsync(
      'adb shell "content query --uri content://com.android.contacts/data/phones --projection display_name:data1"',
      { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );
    rawOutput = stdout || "";
  } catch (err: any) {
    return c.json({ error: `Could not query phone contacts: ${err.message}` }, 500);
  }

  const lines = rawOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Row:"));

  let importedCount = 0;
  let skippedCount = 0;
  const now = Date.now();

  for (const line of lines) {
    const m = line.match(/^Row:\s*\d+\s+display_name=(.*?), data1=(.*)$/);
    if (!m) continue;

    const displayName = m[1].trim();
    const rawPhone = m[2].trim();
    const e164 = normalizePhone(rawPhone);
    if (!e164 || !displayName) continue;

    try {
      const phoneHash = hashPhone(e164);
      const existing = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();
      if (existing) {
        skippedCount++;
        continue;
      }

      const contactId = crypto.randomUUID();
      db.insert(contacts)
        .values({
          id: contactId,
          phoneHash,
          phoneEnc: encryptField(e164),
          displayNameEnc: encryptField(displayName),
          avatarColor: getRandomAvatarColor(),
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Automatically link any existing thread for this number
      db.update(threads).set({ contactId }).where(eq(threads.phoneHash, phoneHash)).run();
      importedCount++;
    } catch {
      skippedCount++;
    }
  }

  return c.json({
    success: true,
    importedCount,
    skippedCount,
    totalFound: lines.length,
  });
});
