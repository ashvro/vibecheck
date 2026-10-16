import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'

/**
 * Assignment briefs and student submissions are written outside the repo tree
 * (backend/data is gitignored) under a per-folder random name. The original
 * filename is never used on disk, so a crafted name cannot escape the folder.
 */
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'data', 'uploads')

export const MAX_PDF_BYTES = 20 * 1024 * 1024

const PDF_EXT = /\.pdf$/i
const PDF_MIME = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream'])

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function safeExt(originalName) {
  return PDF_EXT.test(originalName || '') ? '.pdf' : ''
}

/** Strips path separators, control characters and quotes from a client filename. */
export function cleanDisplayName(originalName, fallback) {
  const base = path.basename(String(originalName || ''))
  let cleaned = ''
  for (const ch of base) {
    const code = ch.codePointAt(0)
    const unsafe =
      code < 0x20 ||
      code === 0x7f ||
      ch === '"' ||
      ch === "'" ||
      ch === '\\' ||
      ch === '/'
    if (!unsafe) cleaned += ch
  }
  cleaned = cleaned.replace(/^[.\s]+/, '').trim()
  if (!cleaned || cleaned === fallback) return fallback
  return cleaned.slice(0, 120)
}

export function absoluteUploadPath(folder, storedAs) {
  const target = path.resolve(UPLOAD_ROOT, folder, storedAs)
  // Defence in depth: refuse anything that escaped its folder.
  if (!target.startsWith(path.resolve(UPLOAD_ROOT, folder) + path.sep)) return null
  return target
}

export function removeUpload(folder, storedAs) {
  if (!storedAs) return
  const target = absoluteUploadPath(folder, storedAs)
  if (!target) return
  fs.promises.unlink(target).catch(() => {})
}

function diskStorageFor(folder) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(UPLOAD_ROOT, folder)
      ensureDir(dir)
      cb(null, dir)
    },
    filename(_req, file, cb) {
      cb(null, `${crypto.randomUUID()}${safeExt(file.originalname)}`)
    },
  })
}

/** Accepts one optional PDF under the field name `file`. */
export function pdfUpload(folder) {
  return multer({
    storage: diskStorageFor(folder),
    limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      const ext = safeExt(file.originalname)
      if (!ext) return cb(new Error('Only PDF files are allowed.'))
      if (!PDF_MIME.has(file.mimetype)) return cb(new Error('Only PDF files are allowed.'))
      cb(null, true)
    },
  })
}

/**
 * Wraps the multer middleware so a rejected upload is a client error rather
 * than a 500, and a partial file never survives the rejection.
 */
export function acceptPdf(folder, field = 'file') {
  const handler = pdfUpload(folder).single(field)
  return function pdfMiddleware(req, res, next) {
    handler(req, res, (err) => {
      if (!err) return next()
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `PDF is larger than the ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))} MB limit.`
          : err.message || 'Upload rejected.'
      req.file = undefined
      next(Object.assign(err, { status: code, message }))
    })
  }
}

/**
 * Streams a stored PDF with the client-supplied name as the download name.
 * Never reflects a Content-Type or filename from the request into the header
 * without going through cleanDisplayName.
 */
export function sendPdf(res, { absolutePath, downloadName, mime }) {
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'File not found.' })
  }
  res.setHeader('Content-Type', mime || 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${cleanDisplayName(downloadName, 'document.pdf')}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=300')
  return fs.createReadStream(absolutePath).pipe(res)
}
