import sharp from "sharp";
export async function canonicalProof(value) {
  if (!value) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    value,
  );
  if (!match) throw Error("Use a PNG, JPEG or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 5 * 1024 * 1024)
    throw Error("Choose an image smaller than 5 MB.");
  try {
    const normalized = await sharp(bytes, {
      limitInputPixels: 25000000,
      failOn: "warning",
    })
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return "data:image/png;base64," + normalized.toString("base64");
  } catch {
    throw Error(
      "Image is damaged or too large. Take a new photo and try again.",
    );
  }
}
