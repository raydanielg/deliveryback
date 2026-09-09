import { z } from "zod"
import { createShipmentSchema } from "../shipments/validation.js"

// Same shape the internal booking flow validates against, plus the external-reference
// fields a partner needs so both systems can identify the same transaction (Part G).
export const partnerCreateShipmentSchema = createShipmentSchema.extend({
  externalOrderId: z.string().max(200).optional(),
  externalShipmentId: z.string().max(200).optional(),
  externalReference: z.string().max(200).optional(),
})
