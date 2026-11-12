import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { decode } from "base64-arraybuffer";
import { supabase } from "./supabase";
import { uid } from "./domain";
export type ImageKind = "avatar" | "signature";
export async function uploadProfileImage(
  kind: ImageKind,
): Promise<{ path: string; url: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: kind === "avatar",
    ...(kind === "avatar" ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in to upload an image.");

  const asset = result.assets[0];
  if ((asset.fileSize || 0) > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const image = await ImageManipulator.manipulateAsync(
    asset.uri,
    [
      {
        resize: {
          width: Math.min(asset.width, kind === "avatar" ? 512 : 1000),
        },
      },
    ],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!image.base64)
    throw new Error("The image could not be prepared. Choose another image.");
  const bytes = decode(image.base64);
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new Error("Choose a smaller image (up to 2 MB after processing).");
  const path = `${user.id}/${uid()}.jpg`,
    bucket = kind === "avatar" ? "avatars" : "email-signatures";
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error)
    throw new Error("The image could not be uploaded. Please try again.");
  if (kind === "signature")
    return {
      path,
      url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    };
  const signed = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  if (signed.error) throw new Error("The image preview could not be loaded.");
  return { path, url: signed.data.signedUrl };
}
export async function avatarUrl(
  path: unknown,
  userId: string,
): Promise<string> {
  if (typeof path !== "string" || !path.startsWith(`${userId}/`)) return "";
  const result = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 3600);
  return result.data?.signedUrl || "";
}
