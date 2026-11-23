// Browser-only helpers (createImageBitmap + canvas).
const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), type, q))
const unsupported = e => Object.assign(new Error('unsupported image'), { kind: 'unsupported_image', cause: e })

async function decode(file, options) {
  try {
    try { return await createImageBitmap(file, options) }
    catch (e) {
      // older browsers reject the options argument with a TypeError
      if (e instanceof TypeError && options) return await createImageBitmap(file)
      throw e
    }
  } catch (e) { throw unsupported(e) }
}

function context(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw Object.assign(new Error('canvas unavailable'), { kind: 'canvas_unavailable' })
  return ctx
}

export async function prepareImage(file, { maxSide = 1600, quality = 0.8, rotate = 0 } = {}) {
  const bmp = await decode(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const turns = ((Math.round(rotate / 90) % 4) + 4) % 4
    const canvas = document.createElement('canvas')
    canvas.width = turns % 2 ? h : w
    canvas.height = turns % 2 ? w : h
    const ctx = context(canvas)
    ctx.fillStyle = '#fff'   // JPEG has no alpha: transparent PNGs would turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(turns * Math.PI / 2)
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
    return await toBlob(canvas, 'image/jpeg', quality)
  } finally { bmp.close?.() }
}

export async function makeThumb(blob, size = 320) {
  const bmp = await decode(blob)
  let out
  try {
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = context(canvas)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    out = await toBlob(canvas, 'image/jpeg', 0.7)
  } finally { bmp.close?.() }
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(out) })
}
