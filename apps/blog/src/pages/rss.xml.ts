import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { posts } from "../lib/content";
import { site } from "../site.config";
export function GET(context: APIContext) {
  return rss({
    title: site.name,
    description: site.description,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.title,
      description: post.excerpt,
      pubDate: new Date(post.publishedAt),
      link: `/posts/${post.slug}/`,
    })),
  });
}
