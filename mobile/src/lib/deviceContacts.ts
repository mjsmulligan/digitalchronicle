/**
 * Device contacts bridge — reads the phone's address book via expo-contacts
 * and normalises entries into ContactDraft records for the shared review flow.
 *
 * Read-only and fully on-device: nothing is written back to the address book
 * and nothing leaves the phone.
 */
import * as Contacts from "expo-contacts/legacy";
import * as FileSystem from "expo-file-system/legacy";
import type { ContactDraft } from "@chronicle/journal/contacts";

export type DeviceContactsResult =
  | { status: "ok"; contacts: { draft: ContactDraft; sourceRow: number }[] }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "unavailable" };

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Converts a contact Image object to a base64 data URI.
 *
 * Strategy:
 *   1. Use image.base64 directly if expo-contacts already decoded it.
 *   2. Try FileSystem.readAsStringAsync on file:// URIs (iOS).
 *   3. Try fetch() → blob → FileReader for content:// URIs (Android).
 *
 * Returns null silently on any failure — a missing photo is never fatal.
 */
async function imageToBase64(image: Contacts.Image): Promise<string | null> {
  // 1. Already decoded
  if (image.base64) {
    console.log("[contacts] using base64 field directly");
    const b64 = image.base64.replace(/^data:image\/[^;]+;base64,/, "");
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  }

  const uri = image.uri;
  if (!uri) {
    console.log("[contacts] image has no uri and no base64");
    return null;
  }

  console.log("[contacts] image uri scheme:", uri.slice(0, 20));

  // 2. file:// — FileSystem handles this on both platforms
  if (uri.startsWith("file://")) {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log("[contacts] FileSystem read ok, length:", b64?.length ?? 0);
      return b64 ? `data:image/jpeg;base64,${b64}` : null;
    } catch (e) {
      console.log("[contacts] FileSystem read failed:", e);
      return null;
    }
  }

  // 3. content:// (Android) — fetch() can't handle content-provider URIs.
  //    Copy to the Expo cache dir first (uses Android ContentResolver), then
  //    read the cached file as base64.
  try {
    const dest = `${FileSystem.cacheDirectory}contact_photo_${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    const b64 = await FileSystem.readAsStringAsync(dest, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Clean up — fire-and-forget, failure is harmless
    FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    console.log("[contacts] content:// copy+read ok, length:", b64?.length ?? 0);
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch (e) {
    console.log("[contacts] content:// copy failed:", e);
    return null;
  }
}

export function toDraft(c: Contacts.Contact): ContactDraft | null {
  const name =
    clean(c.name) || clean([c.firstName, c.middleName, c.lastName].filter(Boolean).join(" "));
  if (!name) return null;
  // Skip entries that are only a phone number / email.
  if (!/\p{L}/u.test(name)) return null;

  const lower = name.toLowerCase();
  const aliases = Array.from(
    new Set(
      [c.nickname, c.maidenName, c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : undefined]
        .map(clean)
        .filter((a) => a && a.toLowerCase() !== lower),
    ),
  );
  return aliases.length ? { name, aliases } : { name };
}

export async function readDeviceContacts(): Promise<DeviceContactsResult> {
  if (!(await Contacts.isAvailableAsync())) return { status: "unavailable" };

  const perm = await Contacts.requestPermissionsAsync();
  if (perm.status !== "granted") return { status: "denied", canAskAgain: perm.canAskAgain };

  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.FirstName,
      Contacts.Fields.MiddleName,
      Contacts.Fields.LastName,
      Contacts.Fields.Nickname,
      Contacts.Fields.MaidenName,
      Contacts.Fields.ImageAvailable,
      Contacts.Fields.Image,
    ],
    sort: Contacts.SortTypes.FirstName,
  });

  // DEBUG — log first contact's image fields to confirm shape
  if (data.length > 0) {
    const sample = data[0];
    console.log("[contacts] sample imageAvailable:", sample.imageAvailable);
    console.log("[contacts] sample image:", JSON.stringify(sample.image));
  }

  // Build drafts (synchronous pass)
  const seen = new Set<string>();
  const rawContacts: { draft: ContactDraft; sourceRow: number; image?: Contacts.Image }[] = [];
  data.forEach((c, i) => {
    const draft = toDraft(c);
    if (!draft) return;
    const key = draft.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // Don't gate on imageAvailable — request Fields.Image and use whatever comes back
    rawContacts.push({
      draft,
      sourceRow: i + 1,
      image: c.image ?? undefined,
    });
  });

  // Resolve photos in parallel — failures are silently ignored
  await Promise.all(
    rawContacts.map(async (entry) => {
      if (!entry.image) return;
      const photo = await imageToBase64(entry.image);
      if (photo) entry.draft = { ...entry.draft, photo };
    }),
  );

  const contacts = rawContacts.map(({ draft, sourceRow }) => ({ draft, sourceRow }));
  return { status: "ok", contacts };
}
