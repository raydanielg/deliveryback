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
        description: process.env.NODE_ENV === "production" ? "Production server" : "Development server",
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
      { name: "Auth", description: "Authentication & authorization - register, login, password reset" },
      { name: "Users", description: "User management - CRUD, roles, activation, password changes" },
      { name: "Shipments", description: "Shipment management including parcel shipments, OTP verification, proof of delivery, scheduling" },
      { name: "Tracking", description: "Public shipment tracking and real-time driver location" },
      { name: "Pricing", description: "Pricing rules and surcharges management" },
      { name: "Quotes", description: "Quote calculation and custom quote requests" },
      { name: "Drivers", description: "Driver profile management and status updates" },
      { name: "Carriers", description: "Logistics carrier/partner management" },
      { name: "Vehicles", description: "Fleet vehicle management" },
      { name: "Manifests", description: "Shipment manifest management for grouped deliveries" },
      { name: "Waybills", description: "Waybill document generation for shipments" },
      { name: "Payments", description: "Payment record management" },
      { name: "Payment Gateways", description: "Payment gateway configuration & initiation (Selcom, Azampesa, M-Pesa)" },
      { name: "Geography", description: "Countries, cities, and delivery routes" },
      { name: "Notifications", description: "User notification management" },
      { name: "Customs", description: "Customs declaration management for international shipments" },
      { name: "Documents", description: "Document upload, verification, and management" },
      { name: "Customers", description: "Customer profile management and statistics" },
      { name: "Orders", description: "Order listing and statistics" },
      { name: "Parcel Categories", description: "Parcel category management (Documents, Electronics, Food, etc.)" },
      { name: "Parcel Weights", description: "Parcel weight tier management for fare calculation" },
      { name: "Parcel Fares", description: "Parcel fare management, estimation, and fare-weight combinations" },
      { name: "Surge Pricing", description: "Time-based surge pricing management for peak hours and holidays" },
      { name: "Zones", description: "Delivery zone management" },
      { name: "Settings", description: "System settings including map configuration and API keys" },
    ],
  },
  apis: [
    "./src/modules/*/routes.js",
    "./src/modules/*/controller.js",
  ],
}

export const swaggerSpec = swaggerJsdoc(options)
