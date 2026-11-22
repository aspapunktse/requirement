import { redirect } from "next/navigation";

/** `/admin/frameworks/<id>` is retired (issue #413): a Framework is edited at `/frameworks/<id>/edit`. Keeps old bookmarks working. */
export default async function RetiredAdminFrameworkPage({ params }: PageProps<"/admin/frameworks/[id]">): Promise<never> {
  const { id } = await params;
  redirect(`/frameworks/${encodeURIComponent(id)}/edit`);
}
