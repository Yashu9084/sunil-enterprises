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

// Source lists are reference material, never signed proof by themselves.
export async function canonicalSource(value) {
  if (!value) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    value,
  );
  if (!match) throw Error("Use a PNG, JPEG or WebP photo.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 5 * 1024 * 1024)
    throw Error("Choose a photo smaller than 5 MB.");
  try {
    const image = await sharp(bytes, {
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
      .jpeg({ quality: 85 })
      .toBuffer();
    if (image.length > 2 * 1024 * 1024) throw Error("too large");
    return "data:image/jpeg;base64," + image.toString("base64");
  } catch {
    throw Error("Photo is damaged or too large. Take a clear, flat photo.");
  }
}
