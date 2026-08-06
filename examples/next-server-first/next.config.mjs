/** @type {import('next').NextConfig} */
export default {
  /**
   * How long a stale page may still be served while it revalidates.
   *
   * Next's default is one year, and for a shop that is too long: measured, the catalog
   * routes answered `stale-while-revalidate=31532400`, so a storefront whose
   * revalidation kept failing would keep serving year-old **prices**. Not hypothetical
   * either — during the metadata work a product page cached by an earlier build was
   * served for a page whose code had already changed.
   *
   * Next computes `stale-while-revalidate = expireTime − revalidate`, so with the
   * routes' `revalidate = 3600` this yields 82'800 s. Measured, not read off.
   */
  expireTime: 86_400,
};
