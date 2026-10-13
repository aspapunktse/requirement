import type { LineagePath } from "@/lib/framework-lineage";
import { frameworkLabel } from "@/lib/framework-label";

/**
 * "Version lineage: ISO/IEC 27001:2013 → ISO/IEC 27001:2022 → …", oldest first,
 * with the Framework the row is about in bold and marked aria-current. Draft
 * members say so (only ever passed to users who can see Drafts). One line per
 * branch when a Framework was forked. Shared by /frameworks and /admin/frameworks.
 */
export function FrameworkLineage({ paths }: { paths: LineagePath[] }) {
  return (
    <div className="text-xs text-zinc-500">
      {paths.map((path) => (
        <p key={path.map((member) => member.id).join(">")}>
          Version lineage:{" "}
          {path.map((member, index) => (
            <span key={member.id}>
              {index > 0 && " → "}
              <span
                aria-current={member.current ? "true" : undefined}
                className={member.current ? "font-semibold text-zinc-900 dark:text-zinc-100" : undefined}
              >
                {frameworkLabel(member)}
                {member.status === "DRAFT" ? " (Draft)" : ""}
              </span>
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
