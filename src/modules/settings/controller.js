import prisma from "../../prisma/client.js"

// In-memory / persistent config store with sensible production defaults
let mapSettingsState = {
  provider: "google_maps", // "openstreetmap", "google_maps", "mapbox", "maptiler", "carto_dark", "carto_voyager"
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN || "",
  maptilerApiKey: process.env.MAPTILER_API_KEY || "",
  customTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  defaultLatitude: -6.7924,
  defaultLongitude: 39.2083,
  defaultZoom: 12,
  mapTheme: "dark",
  enableLiveTraffic: true,
  enableDriverPulseAnimation: true,
  enableClustering: true,
  refreshIntervalSeconds: 5,
  isLiveTrackingActive: true,
  geocodingProvider: "nominatim", // "google", "mapbox", "nominatim"
}

export async function getMapSettings(req, res, next) {
  try {
    // Return map settings with masked sensitive keys
    const masked = {
      ...mapSettingsState,
      googleMapsApiKey: mapSettingsState.googleMapsApiKey
        ? (mapSettingsState.googleMapsApiKey.length > 8
            ? `${mapSettingsState.googleMapsApiKey.substring(0, 4)}...${mapSettingsState.googleMapsApiKey.substring(mapSettingsState.googleMapsApiKey.length - 4)}`
            : "••••••••")
        : "",
      mapboxAccessToken: mapSettingsState.mapboxAccessToken
        ? (mapSettingsState.mapboxAccessToken.length > 8
            ? `${mapSettingsState.mapboxAccessToken.substring(0, 4)}...${mapSettingsState.mapboxAccessToken.substring(mapSettingsState.mapboxAccessToken.length - 4)}`
            : "••••••••")
        : "",
      maptilerApiKey: mapSettingsState.maptilerApiKey
        ? (mapSettingsState.maptilerApiKey.length > 8
            ? `${mapSettingsState.maptilerApiKey.substring(0, 4)}...${mapSettingsState.maptilerApiKey.substring(mapSettingsState.maptilerApiKey.length - 4)}`
            : "••••••••")
        : "",
    }
    res.json({ success: true, data: masked })
  } catch (err) {
    next(err)
  }
}

export async function updateMapSettings(req, res, next) {
  try {
    const {
      provider,
      googleMapsApiKey,
      mapboxAccessToken,
      maptilerApiKey,
      customTileUrl,
      defaultLatitude,
      defaultLongitude,
      defaultZoom,
      mapTheme,
      enableLiveTraffic,
      enableDriverPulseAnimation,
      enableClustering,
      refreshIntervalSeconds,
      isLiveTrackingActive,
      geocodingProvider,
    } = req.body

    if (provider !== undefined) mapSettingsState.provider = provider
    if (googleMapsApiKey !== undefined && !googleMapsApiKey.includes("•••")) {
      mapSettingsState.googleMapsApiKey = googleMapsApiKey
    }
    if (mapboxAccessToken !== undefined && !mapboxAccessToken.includes("•••")) {
      mapSettingsState.mapboxAccessToken = mapboxAccessToken
    }
    if (maptilerApiKey !== undefined && !maptilerApiKey.includes("•••")) {
      mapSettingsState.maptilerApiKey = maptilerApiKey
    }
    if (customTileUrl !== undefined) mapSettingsState.customTileUrl = customTileUrl
    if (defaultLatitude !== undefined) mapSettingsState.defaultLatitude = Number(defaultLatitude)
    if (defaultLongitude !== undefined) mapSettingsState.defaultLongitude = Number(defaultLongitude)
    if (defaultZoom !== undefined) mapSettingsState.defaultZoom = Number(defaultZoom)
    if (mapTheme !== undefined) mapSettingsState.mapTheme = mapTheme
    if (enableLiveTraffic !== undefined) mapSettingsState.enableLiveTraffic = Boolean(enableLiveTraffic)
    if (enableDriverPulseAnimation !== undefined) mapSettingsState.enableDriverPulseAnimation = Boolean(enableDriverPulseAnimation)
    if (enableClustering !== undefined) mapSettingsState.enableClustering = Boolean(enableClustering)
    if (refreshIntervalSeconds !== undefined) mapSettingsState.refreshIntervalSeconds = Number(refreshIntervalSeconds)
    if (isLiveTrackingActive !== undefined) mapSettingsState.isLiveTrackingActive = Boolean(isLiveTrackingActive)
    if (geocodingProvider !== undefined) mapSettingsState.geocodingProvider = geocodingProvider

    res.json({
      success: true,
      message: "Map settings and API keys updated successfully",
      data: mapSettingsState,
    })
  } catch (err) {
    next(err)
  }
}

// Business / System settings state with production defaults
let businessSettingsState = {
  // Business Info
  platformName: "Xerin Express",
  supportEmail: "support@xerinexpress.com",
  supportPhone: "+255 700 000 000",
  defaultCurrency: "TZS",
  timezone: "Africa/Dar_es_Salaam",
  language: "en",
  businessAddress: "Dar es Salaam, Tanzania",
  websiteUrl: "https://xerinexpress.com",
  logoUrl: "",

  // Rate Limits & Security
  apiRateLimitPerMinute: 100,
  authLoginMaxAttempts: 5,
  authLockoutDurationMinutes: 15,
  otpMaxRequestsPerHour: 5,
  otpExpiryMinutes: 10,
  passwordMinLength: 8,
  passwordRequireUppercase: true,
  passwordRequireSpecialChar: true,
  passwordRequireNumber: true,
  jwtExpiryHours: 24,
  refreshTokenExpiryDays: 7,
  enableTwoFactorAuth: false,
  enforceHttps: true,

  // Delivery & Operations
  enableQrCodeProofOfDelivery: true,
  enablePhotoProofOfDelivery: true,
  enableSignatureProofOfDelivery: false,
  enableOtpVerification: true,
  enableScheduledDeliveries: true,
  enableParcelDeliveryProof: true,
  autoAssignDrivers: false,
  driverAcceptanceTimeoutMinutes: 3,
  cancellationAllowed: true,
  maxCancellationTimeMinutes: 30,
  enableSurgePricing: true,
  enableTips: true,
  defaultPayer: "SENDER",

  // Notifications
  enableEmailNotifications: true,
  enableSmsNotifications: true,
  enablePushNotifications: false,
  enableWebhookNotifications: false,
  smsProvider: "africastalking",
  emailProvider: "smtp",
  notificationRetryAttempts: 3,
  notificationRetryDelayMinutes: 5,

  // System Management
  enableMaintenanceMode: false,
  maintenanceMessage: "We are currently performing maintenance. Please check back soon.",
  enableNewRegistrations: true,
  enableCustomerSelfBooking: true,
  enableDriverOnboarding: true,
  maxFileUploadSizeMb: 10,
  enableAuditLog: true,
  dataRetentionDays: 90,
  enableBackupNotifications: true,
  sessionTimeoutMinutes: 30,
}

export async function getBusinessSettings(req, res, next) {
  try {
    res.json({ success: true, data: businessSettingsState })
  } catch (err) {
    next(err)
  }
}

export async function updateBusinessSettings(req, res, next) {
  try {
    const updates = req.body
    for (const [key, value] of Object.entries(updates)) {
      if (key in businessSettingsState) {
        const current = businessSettingsState[key]
        if (typeof current === "boolean") {
          businessSettingsState[key] = Boolean(value)
        } else if (typeof current === "number") {
          businessSettingsState[key] = Number(value)
        } else {
          businessSettingsState[key] = value
        }
      }
    }
    res.json({
      success: true,
      message: "Business settings updated successfully",
      data: businessSettingsState,
    })
  } catch (err) {
    next(err)
  }
}

export async function getPublicMapSettings(req, res, next) {
  try {
    // Return client-safe tile URL and active style for mobile apps and web
    let effectiveTileUrl = mapSettingsState.customTileUrl

    if (mapSettingsState.provider === "carto_dark") {
      effectiveTileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    } else if (mapSettingsState.provider === "carto_voyager") {
      effectiveTileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
    } else if (mapSettingsState.provider === "mapbox" && mapSettingsState.mapboxAccessToken) {
      effectiveTileUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${mapSettingsState.mapboxAccessToken}`
    } else if (mapSettingsState.provider === "maptiler" && mapSettingsState.maptilerApiKey) {
      effectiveTileUrl = `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${mapSettingsState.maptilerApiKey}`
    }

    // Build Google Maps tile URLs if Google Maps is the active provider
    let googleMapsTileUrl = null
    let googleMapsApiKey = null
    if (mapSettingsState.provider === "google_maps" && mapSettingsState.googleMapsApiKey) {
      googleMapsApiKey = mapSettingsState.googleMapsApiKey
      googleMapsTileUrl = `https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${mapSettingsState.googleMapsApiKey}`
      effectiveTileUrl = googleMapsTileUrl
    }

    res.json({
      success: true,
      data: {
        provider: mapSettingsState.provider,
        tileUrl: effectiveTileUrl,
        googleMapsApiKey: googleMapsApiKey || undefined,
        googleMapsTileUrl: googleMapsTileUrl,
        defaultLatitude: mapSettingsState.defaultLatitude,
        defaultLongitude: mapSettingsState.defaultLongitude,
        defaultZoom: mapSettingsState.defaultZoom,
        mapTheme: mapSettingsState.mapTheme,
        enableLiveTraffic: mapSettingsState.enableLiveTraffic,
        enableDriverPulseAnimation: mapSettingsState.enableDriverPulseAnimation,
        refreshIntervalSeconds: mapSettingsState.refreshIntervalSeconds,
      },
    })
  } catch (err) {
    next(err)
  }
}
