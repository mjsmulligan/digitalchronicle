/** Bundled book fonts (Lora body, Fraunces headings), loaded as base64 for @font-face. */
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { Lora_400Regular, Lora_400Regular_Italic, Lora_700Bold } from "@expo-google-fonts/lora";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import type { BookFont } from "@chronicle/journal/book";

async function assetBase64(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function loadBookFonts(): Promise<BookFont[]> {
  const [lora, loraItalic, loraBold, fraunces] = await Promise.all([
    assetBase64(Lora_400Regular),
    assetBase64(Lora_400Regular_Italic),
    assetBase64(Lora_700Bold),
    assetBase64(Fraunces_600SemiBold),
  ]);
  return [
    { family: "Lora", weight: 400, style: "normal", base64: lora },
    { family: "Lora", weight: 400, style: "italic", base64: loraItalic },
    { family: "Lora", weight: 700, style: "normal", base64: loraBold },
    { family: "Fraunces", weight: 600, style: "normal", base64: fraunces },
  ];
}
