export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${new Date().toISOString()}:`, err.message)

  if (err.name === "ZodError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed.",
      errors: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    })
  }

  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists.",
    })
  }

  const status = err.status || 500
  const message = err.message || "Internal server error."

  return res.status(status).json({
    success: false,
    message,
  })
}

export function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  })
}
