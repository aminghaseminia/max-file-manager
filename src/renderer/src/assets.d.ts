/** Vite inlines `?raw` assets as strings; the embedded icon set relies on it. */
declare module '*.svg?raw' {
  const content: string
  export default content
}
