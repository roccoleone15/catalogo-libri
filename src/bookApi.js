// Fetch book metadata by ISBN from OpenLibrary first, then Google Books as fallback

const fetchJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return res.json()
}

const fromOpenLibrary = async (isbnDigits) => {
  const data = await fetchJson(`https://openlibrary.org/isbn/${isbnDigits}.json`)
  const worksKey = Array.isArray(data.works) && data.works.length > 0 ? data.works[0].key : null
  let title = data.title || ""
  let authors = []
  if (Array.isArray(data.authors)) {
    const authorNames = await Promise.all(
      data.authors.map(async (a) => {
        try {
          const aJson = await fetchJson(`https://openlibrary.org${a.key}.json`)
          return aJson.name
        } catch {
          return null
        }
      })
    )
    authors = authorNames.filter(Boolean)
  }
  let year = null
  if (data.publish_date) {
    const match = String(data.publish_date).match(/\d{4}/)
    year = match ? match[0] : null
  }
  let plot = ""
  if (worksKey) {
    try {
      const work = await fetchJson(`https://openlibrary.org${worksKey}.json`)
      if (work && work.description) {
        plot = typeof work.description === 'string' ? work.description : (work.description.value || "")
      }
    } catch {}
  }
  let cover = null
  if (Array.isArray(data.covers) && data.covers.length > 0) {
    // Use large cover image
    cover = `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`
  }
  return {
    title: title || "",
    author: authors.join(", ") || "",
    year: year || null,
    genre: "",
    cover: cover || null,
    plot: plot || "",
  }
}

const fromGoogleBooks = async (isbnDigits) => {
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbnDigits}`)
  const item = data.items && data.items.length > 0 ? data.items[0] : null
  if (!item) throw new Error('Not found')
  const v = item.volumeInfo || {}
  return {
    title: v.title || "",
    author: Array.isArray(v.authors) ? v.authors.join(", ") : "",
    year: v.publishedDate ? (String(v.publishedDate).slice(0, 4)) : null,
    genre: Array.isArray(v.categories) ? v.categories.join(", ") : "",
    cover: v.imageLinks ? (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || null) : null,
    plot: v.description || "",
  }
}

export const fetchBookMetadata = async (isbnDigits) => {
  try {
    return await fromOpenLibrary(isbnDigits)
  } catch {
    try {
      return await fromGoogleBooks(isbnDigits)
    } catch {
      return { title: "", author: "", year: null, genre: "", cover: null, plot: "" }
    }
  }
}


