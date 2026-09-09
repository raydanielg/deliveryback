import prisma from "../../prisma/client.js"

export async function listNotifications(req, res, next) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ success: true, data: notifications })
  } catch (err) { next(err) }
}

export async function markAsRead(req, res, next) {
  try {
    const { id } = req.params
    // Scoped by userId too — previously any authenticated user could mark any other
    // user's notification as read by guessing its id.
    const { count } = await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { isRead: true },
    })
    if (count === 0) return res.status(404).json({ success: false, message: "Notification not found" })
    res.json({ success: true, message: "Notification marked as read" })
  } catch (err) { next(err) }
}

export async function markAllAsRead(req, res, next) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    })
    res.json({ success: true, message: "All notifications marked as read" })
  } catch (err) { next(err) }
}

export async function createNotification(userId, type, title, message, data = null) {
  return prisma.notification.create({
    data: { userId, type, title, message, data, channel: "IN_APP" },
  })
}
