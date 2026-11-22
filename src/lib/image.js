// Browser-only helpers (createImageBitmap + canvas).
const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), type, q))

export async function prepareImage(file, { maxSide = 1600, quality = 0.8, rotate = 0 } = {}) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const turns = ((Math.round(rotate / 90) % 4) + 4) % 4
  const canvas = document.createElement('canvas')
  canvas.width = turns % 2 ? h : w
  canvas.height = turns % 2 ? w : h
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(turns * Math.PI / 2)
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
  bmp.close?.()
  return toBlob(canvas, 'image/jpeg', quality)
}

export async function makeThumb(blob, size = 320) {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const out = await toBlob(canvas, 'image/jpeg', 0.7)
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(out) })
}
