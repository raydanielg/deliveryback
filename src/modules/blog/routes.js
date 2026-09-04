import { Router } from "express"
import multer from "multer"
import {
  listBlogPosts, listPublicBlogPosts, getBlogPost, getBlogPostBySlug,
  createBlogPost, updateBlogPost, deleteBlogPost,
  uploadBlogImages, deleteBlogImage,
  uploadBlogAttachments, deleteBlogAttachment,
  getBlogStats,
  listBlogCategories, createBlogCategory, updateBlogCategory, deleteBlogCategory,
} from "./controller.js"
import { authenticate, authorizeRoles } from "../../middleware/auth.js"

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

// ── Public routes (no auth) ──
router.get("/public", listPublicBlogPosts)
router.get("/public/:slug", getBlogPostBySlug)
router.get("/categories", listBlogCategories)

// ── Authenticated routes ──
router.use(authenticate)

router.get("/", listBlogPosts)
router.get("/stats", getBlogStats)
router.get("/:id", getBlogPost)

router.post("/", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createBlogPost)
router.put("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateBlogPost)
router.delete("/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteBlogPost)

router.post("/:id/images", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), upload.array("images", 10), uploadBlogImages)
router.delete("/:id/images/:imageId", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteBlogImage)

router.post("/:id/attachments", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), upload.array("files", 10), uploadBlogAttachments)
router.delete("/:id/attachments/:attachmentId", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteBlogAttachment)

router.post("/categories", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), createBlogCategory)
router.put("/categories/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), updateBlogCategory)
router.delete("/categories/:id", authorizeRoles("SUPER_ADMIN", "OPERATIONS_MANAGER"), deleteBlogCategory)

export default router
