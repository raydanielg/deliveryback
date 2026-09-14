import QRCode from "qrcode"

// Renders a scannable QR PNG for a payload string (a box/trip/shipment qrPayload),
// used only by printable-label endpoints — every other consumer (web/Flutter) renders
// the QR client-side from the same payload string, so no image is ever persisted.
export async function toQrPngBuffer(payload) {
  return QRCode.toBuffer(payload, { type: "png", width: 320, margin: 1 })
}
