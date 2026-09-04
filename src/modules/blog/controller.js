import prisma from "../../prisma/client.js"
import path from "path"
import fs from "fs/promises"
import { createBlogPostSchema, updateBlogPostSchema, createBlogCategorySchema, updateBlogCategorySchema } from "./validation.js"

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// ============================================================
// BLOG POSTS
// ============================================================

export async function listBlogPosts(req, res, next) {
  try {
    const { status, search, category, featured, page = 1, limit = 20 } = req.query
    const where = {}

    if (status) where.status = status
    if (featured === "true") where.isFeatured = true
    if (category) where.category = { slug: category }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { excerpt: { contains: search, mode: "insensitive" } },
        { tags: { has: search } },
      ]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, avatar: true } },
          category: true,
          _count: { select: { images: true, attachments: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.blogPost.count({ where }),
    ])

    res.json({ success: true, data: posts, total, page: Number(page), limit: Number(limit) })
  } catch (err) { next(err) }
}

export async function listPublicBlogPosts(req, res, next) {
  try {
    const { search, category, page = 1, limit = 12 } = req.query
    const where = { status: "PUBLISHED" }

    if (category) where.category = { slug: category }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { excerpt: { contains: search, mode: "insensitive" } },
        { tags: { has: search } },
      ]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, avatar: true } },
          category: true,
        },
        orderBy: { publishedAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.blogPost.count({ where }),
    ])

    res.json({ success: true, data: posts, total, page: Number(page), limit: Number(limit) })
  } catch (err) { next(err) }
}

export async function getBlogPost(req, res, next) {
  try {
    const { id } = req.params
    const post = await prisma.blogPost.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        category: true,
        images: { orderBy: { position: "asc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    })
    if (!post) return res.status(404).json({ success: false, message: "Blog post not found" })
    res.json({ success: true, data: post })
  } catch (err) { next(err) }
}

export async function getBlogPostBySlug(req, res, next) {
  try {
    const { slug } = req.params
    const post = await prisma.blogPost.findUnique({
      where: { slug },
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        category: true,
        images: { orderBy: { position: "asc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    })
    if (!post || post.status !== "PUBLISHED") {
      return res.status(404).json({ success: false, message: "Blog post not found" })
    }

    await prisma.blogPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } })

    res.json({ success: true, data: post })
  } catch (err) { next(err) }
}

export async function createBlogPost(req, res, next) {
  try {
    const data = createBlogPostSchema.parse(req.body)

    if (!data.slug) {
      data.slug = slugify(data.title)
    }

    const existing = await prisma.blogPost.findUnique({ where: { slug: data.slug } })
    if (existing) {
      data.slug = `${data.slug}-${Date.now().toString(36)}`
    }

    const publishedAt = data.status === "PUBLISHED" ? (data.publishedAt ? new Date(data.publishedAt) : new Date()) : null

    const post = await prisma.blogPost.create({
      data: {
        title: data.title,
        slug: data.slug,
        excerpt: data.excerpt,
        content: data.content,
        coverImage: data.coverImage,
        status: data.status,
        isFeatured: data.isFeatured,
        readTime: data.readTime,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        tags: data.tags,
        categoryId: data.categoryId,
        authorId: req.user.id,
        publishedAt,
      },
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        category: true,
      },
    })

    res.status(201).json({ success: true, data: post })
  } catch (err) { next(err) }
}

export async function updateBlogPost(req, res, next) {
  try {
    const { id } = req.params
    const data = updateBlogPostSchema.partial().parse(req.body)

    if (data.title && !data.slug) {
      const existing = await prisma.blogPost.findUnique({ where: { id } })
      if (existing && existing.title !== data.title) {
        data.slug = slugify(data.title)
      }
    }

    if (data.slug) {
      const existing = await prisma.blogPost.findFirst({ where: { slug: data.slug, NOT: { id } } })
      if (existing) {
        data.slug = `${data.slug}-${Date.now().toString(36)}`
      }
    }

    if (data.status === "PUBLISHED") {
      const existing = await prisma.blogPost.findUnique({ where: { id } })
      if (existing && !existing.publishedAt) {
        data.publishedAt = data.publishedAt ? new Date(data.publishedAt) : new Date()
      }
    }

    const post = await prisma.blogPost.update({
      where: { id },
      data,
      include: {
        author: { select: { id: true, name: true, avatar: true } },
        category: true,
        images: { orderBy: { position: "asc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    })

    res.json({ success: true, data: post })
  } catch (err) { next(err) }
}

export async function deleteBlogPost(req, res, next) {
  try {
    const { id } = req.params
    await prisma.blogPost.delete({ where: { id } })
    res.json({ success: true, message: "Blog post deleted" })
  } catch (err) { next(err) }
}

export async function uploadBlogImages(req, res, next) {
  try {
    const { id } = req.params
    const post = await prisma.blogPost.findUnique({ where: { id } })
    if (!post) return res.status(404).json({ success: false, message: "Blog post not found" })

    const files = req.files || []
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: "No images uploaded" })
    }

    const uploadsDir = path.join(process.cwd(), "uploads", "blog", id)
    await fs.mkdir(uploadsDir, { recursive: true })

    const captions = req.body.captions ? JSON.parse(req.body.captions) : []
    const images = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.originalname.split(".").pop() || "jpg"
      const filename = `img-${Date.now()}-${i}.${ext}`
      await fs.writeFile(path.join(uploadsDir, filename), file.buffer)

      const img = await prisma.blogImage.create({
        data: {
          postId: id,
          url: `/uploads/blog/${id}/${filename}`,
          caption: captions[i] || null,
          position: i,
        },
      })
      images.push(img)
    }

    res.status(201).json({ success: true, data: images })
  } catch (err) { next(err) }
}

export async function deleteBlogImage(req, res, next) {
  try {
    const { id, imageId } = req.params
    const image = await prisma.blogImage.findUnique({ where: { id: imageId } })
    if (!image) return res.status(404).json({ success: false, message: "Image not found" })

    const filePath = path.join(process.cwd(), image.url)
    try { await fs.unlink(filePath) } catch {}

    await prisma.blogImage.delete({ where: { id: imageId } })
    res.json({ success: true, message: "Image deleted" })
  } catch (err) { next(err) }
}

export async function uploadBlogAttachments(req, res, next) {
  try {
    const { id } = req.params
    const post = await prisma.blogPost.findUnique({ where: { id } })
    if (!post) return res.status(404).json({ success: false, message: "Blog post not found" })

    const files = req.files || []
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" })
    }

    const uploadsDir = path.join(process.cwd(), "uploads", "blog", id, "attachments")
    await fs.mkdir(uploadsDir, { recursive: true })

    const attachments = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.originalname.split(".").pop() || "pdf"
      const filename = `file-${Date.now()}-${i}.${ext}`
      await fs.writeFile(path.join(uploadsDir, filename), file.buffer)

      const att = await prisma.blogAttachment.create({
        data: {
          postId: id,
          url: `/uploads/blog/${id}/attachments/${filename}`,
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSize: file.size,
        },
      })
      attachments.push(att)
    }

    res.status(201).json({ success: true, data: attachments })
  } catch (err) { next(err) }
}

export async function deleteBlogAttachment(req, res, next) {
  try {
    const { id, attachmentId } = req.params
    const attachment = await prisma.blogAttachment.findUnique({ where: { id: attachmentId } })
    if (!attachment) return res.status(404).json({ success: false, message: "Attachment not found" })

    const filePath = path.join(process.cwd(), attachment.url)
    try { await fs.unlink(filePath) } catch {}

    await prisma.blogAttachment.delete({ where: { id: attachmentId } })
    res.json({ success: true, message: "Attachment deleted" })
  } catch (err) { next(err) }
}

export async function getBlogStats(req, res, next) {
  try {
    const [total, published, drafts, totalViews, featured] = await Promise.all([
      prisma.blogPost.count(),
      prisma.blogPost.count({ where: { status: "PUBLISHED" } }),
      prisma.blogPost.count({ where: { status: "DRAFT" } }),
      prisma.blogPost.aggregate({ _sum: { views: true } }),
      prisma.blogPost.count({ where: { isFeatured: true } }),
    ])

    res.json({
      success: true,
      data: {
        total,
        published,
        drafts,
        featured,
        totalViews: totalViews._sum.views || 0,
      },
    })
  } catch (err) { next(err) }
}

// ============================================================
// BLOG CATEGORIES
// ============================================================

export async function listBlogCategories(req, res, next) {
  try {
    const categories = await prisma.blogCategory.findMany({
      include: { _count: { select: { posts: true } } },
      orderBy: { name: "asc" },
    })
    res.json({ success: true, data: categories })
  } catch (err) { next(err) }
}

export async function createBlogCategory(req, res, next) {
  try {
    const data = createBlogCategorySchema.parse(req.body)
    if (!data.slug) data.slug = slugify(data.name)

    const existing = await prisma.blogCategory.findUnique({ where: { slug: data.slug } })
    if (existing) return res.status(409).json({ success: false, message: "Category slug already exists" })

    const category = await prisma.blogCategory.create({ data })
    res.status(201).json({ success: true, data: category })
  } catch (err) { next(err) }
}

export async function updateBlogCategory(req, res, next) {
  try {
    const { id } = req.params
    const data = updateBlogCategorySchema.partial().parse(req.body)
    if (data.name && !data.slug) data.slug = slugify(data.name)

    const category = await prisma.blogCategory.update({ where: { id }, data })
    res.json({ success: true, data: category })
  } catch (err) { next(err) }
}

export async function deleteBlogCategory(req, res, next) {
  try {
    const { id } = req.params
    await prisma.blogCategory.delete({ where: { id } })
    res.json({ success: true, message: "Category deleted" })
  } catch (err) { next(err) }
}
