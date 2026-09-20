// Proof that the right person is receiving the cargo — the human step at the end of every job.
//
// The receiver is sent a confirmation code (shipment.otp) when the booking is made. At handover:
//   * the code matches                      -> "OTP"
//   * staff at a counter (warehouse / SGR)   -> may instead record the receiver's name + ID type +
//     ID number, which is kept on the tracking trail                         -> "ID_VERIFIED"
//   * a driver on the road                  -> code only; there is no counter to check an ID at
// A wrong code is always refused. Shipments that never had a code (legacy rows) pass through.
export class HandoverError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
    this.name = "HandoverError"
  }
}

export function checkHandoverProof(shipment, { otp, recipientName, idType, idNumber } = {}, { allowIdFallback = false } = {}) {
  if (!shipment.otp) return { method: "NONE" }

  if (otp) {
    if (String(otp).trim() !== shipment.otp) throw new HandoverError("Invalid confirmation code")
    return { method: "OTP" }
  }

  if (allowIdFallback && recipientName?.trim() && idType?.trim() && idNumber?.trim()) {
    return { method: "ID_VERIFIED", recipientName: recipientName.trim(), idType: idType.trim(), idNumber: idNumber.trim() }
  }

  throw new HandoverError(
    allowIdFallback
      ? "Ask the receiver for their confirmation code, or record their name, ID type and ID number"
      : "The receiver's confirmation code is required to hand over this cargo"
  )
}
