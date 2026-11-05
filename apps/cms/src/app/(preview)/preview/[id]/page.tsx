import { getPayload } from "payload";
import config from "@payload-config";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { renderContent } from "@asoball/content-contract/render";
import { previewContent } from "../../../../preview-content";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "私人草稿預覽",
  robots: { index: false, follow: false },
};
export default async function Preview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await headers() });
  if (user?.role !== "admin") redirect("/admin/login");
  const { id } = await params;
  const post = await payload.findByID({
    collection: "posts",
    id,
    user,
    overrideAccess: false,
    draft: true,
    depth: 2,
    disableErrors: true,
  });
  if (!post) notFound();
  const rendered = await renderContent(previewContent(post.content.root));
  return (
    <main
      style={{
        maxWidth: 960,
        margin: "48px auto",
        padding: 24,
        fontFamily: "sans-serif",
        lineHeight: 1.8,
      }}
    >
      <a href="/admin/collections/posts">返回管理後台</a>
      <p>私人預覽 · {post._status} · 不會發布到公開網站</p>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
    </main>
  );
}
