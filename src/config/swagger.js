import swaggerJsdoc from "swagger-jsdoc"

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Xerin Delivery API",
      version: "2.0.0",
      description: "Multipurpose Logistics Platform API - Parcel management, payment gateways, shipments, tracking, and more.",
      contact: {
        name: "Xerin Delivery",
        email: "support@xerindelivery.com",
      },
    },
    servers: [
      {
        url: process.env.SERVER_URL || `http://localhost:${process.env.PORT || 4000}`,
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      { bearerAuth: [] },
    ],
    tags: [
      { name: "Auth", description: "Authentication & authorization" },
      { name: "Shipments", description: "Shipment management including parcel shipments, OTP, proof of delivery" },
      { name: "Tracking", description: "Public shipment tracking" },
      { name: "Pricing", description: "Pricing rules management" },
      { name: "Quotes", description: "Quote calculation" },
      { name: "Drivers", description: "Driver management" },
      { name: "Carriers", description: "Carrier management" },
      { name: "Vehicles", description: "Vehicle management" },
      { name: "Manifests", description: "Manifest management" },
      { name: "Waybills", description: "Waybill management" },
      { name: "Payments", description: "Payment management" },
      { name: "Geography", description: "Countries, regions, cities" },
      { name: "Notifications", description: "Notification management" },
      { name: "Customs", description: "Customs documentation" },
      { name: "Documents", description: "Document management" },
      { name: "Customers", description: "Customer management" },
      { name: "Orders", description: "Order management" },
      { name: "Parcel Categories", description: "Parcel category management" },
      { name: "Parcel Weights", description: "Parcel weight tier management" },
      { name: "Parcel Fares", description: "Parcel fare management & estimation" },
      { name: "Payment Gateways", description: "Payment gateway configuration & initiation (Selcom, Azampesa)" },
      { name: "Surge Pricing", description: "Time-based surge pricing management" },
      { name: "Zones", description: "Delivery zone management" },
    ],
  },
  apis: [
    "./src/modules/*/routes.js",
    "./src/modules/*/controller.js",
  ],
}

export const swaggerSpec = swaggerJsdoc(options)
