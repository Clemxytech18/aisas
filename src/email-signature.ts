export type EmailSignature = {
  sender_name?: string;
  signature_text?: string;
  signature_image_url?: string;
};
export function prepareSignature(
  value: EmailSignature,
): Required<EmailSignature> {
  const sender_name = (value.sender_name || "").trim();
  const signature_text = (value.signature_text || "").trim();
  const signature_image_url = (value.signature_image_url || "").trim();
  if (sender_name.length > 120 || /[\r\n\x00-\x1f]/.test(sender_name))
    throw new Error("Use a sender name of up to 120 characters on one line.");
  if (signature_text.length > 2000)
    throw new Error("Keep your email signatory text under 2,000 characters.");
  if (signature_image_url) {
    try {
      const url = new URL(signature_image_url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        signature_image_url.length > 2048
      )
        throw new Error();
    } catch {
      throw new Error("Upload a valid signature image.");
    }
  }
  if (!sender_name && (signature_text || signature_image_url))
    throw new Error("Add a sender name above your email signatory.");
  return { sender_name, signature_text, signature_image_url };
}
export function escapeEmailHtml(value: string): string {
  return value
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    )
    .replace(/\n/g, "<br>");
}
export function emailBodyHtml(body: string, signature: EmailSignature): string {
  const sign = prepareSignature(signature);
  // Remove only the placeholder produced by older AISAS templates.
  const content = sign.sender_name
    ? body.replace(/\n\nBest,\nYour name(?=\s*(?:\n\nFor a quick look|$))/, "")
    : body;
  const footer = [sign.sender_name, sign.signature_text]
    .filter(Boolean)
    .map(escapeEmailHtml)
    .join("<br>");
  const image = sign.signature_image_url
    ? `<br><img src="${escapeEmailHtml(sign.signature_image_url)}" alt="Email signatory" width="280" style="display:block;max-width:280px;height:auto;border:0;margin-top:8px" />`
    : "";
  return (
    escapeEmailHtml(content.trimEnd()) +
    (footer ? `<br><br>${footer}${image}` : "")
  );
}
