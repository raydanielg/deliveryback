import { z } from "zod"

export const createBlogPostSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().min(3).max(200).optional(),
  excerpt: z.string().max(500).optional(),
  content: z.string().min(10),
  coverImage: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  isFeatured: z.boolean().default(false),
  readTime: z.number().int().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  tags: z.array(z.string()).default([]),
  categoryId: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
})

export const updateBlogPostSchema = createBlogPostSchema.partial()

export const createBlogCategorySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
})

export const updateBlogCategorySchema = createBlogCategorySchema.partial()
