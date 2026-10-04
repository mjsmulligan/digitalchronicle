/**
 * Device contacts bridge — reads the phone's address book via expo-contacts
 * and normalises entries into ContactDraft records for the shared review flow.
 *
 * Read-only and fully on-device: nothing is written back to the address book
 * and nothing leaves the phone.
 */
import * as Contacts from "expo-contacts";
import type { ContactDraft } from "@chronicle/journal/contacts";

export type DeviceContactsResult =
  | { status: "ok"; contacts: { draft: ContactDraft; sourceRow: number }[] }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "unavailable" };

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
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
    ],
    sort: Contacts.SortTypes.FirstName,
  });

  const seen = new Set<string>();
  const contacts: { draft: ContactDraft; sourceRow: number }[] = [];
  data.forEach((c, i) => {
    const draft = toDraft(c);
    if (!draft) return;
    const key = draft.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({ draft, sourceRow: i + 1 });
  });
  return { status: "ok", contacts };
}
