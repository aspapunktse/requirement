"use client";

import { useRouter } from "next/navigation";
import { FrameworkRequirementsEditor, type RequirementRow } from "@/components/FrameworkRequirementsEditor";
import { FrameworkReviewGroup, type ReviewGroupOption } from "@/components/FrameworkReviewGroup";
import type { PickableControl } from "@/components/ControlMappingEditor";

/**
 * The Review Group and Requirements cards of the Framework editor. Each editor keeps its own state; after every
 * change this refreshes the page data, so the header's Requirement count and the Publish dialog's figures follow.
 */
export function FrameworkSections({
  frameworkId,
  isBase,
  licensing,
  reviewGroups,
  reviewGroupId,
  canOpenGroup,
  requirements,
  controls,
}: {
  frameworkId: string;
  isBase: boolean;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  reviewGroups: ReviewGroupOption[];
  reviewGroupId: string | null;
  canOpenGroup: boolean;
  requirements: RequirementRow[];
  controls: PickableControl[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <>
      <section className="hc-card" aria-label="Review Group">
        <div className="hc-card-b fc-embed">
          <FrameworkReviewGroup
            frameworkId={frameworkId}
            isBase={isBase}
            groups={reviewGroups}
            initialReviewGroupId={reviewGroupId}
            canOpenGroup={canOpenGroup}
            onChanged={refresh}
          />
        </div>
      </section>
      <section className="hc-card" aria-label="Requirements and Control Mappings">
        <div className="hc-card-h">
          <h2>Requirements and Control Mappings</h2>
        </div>
        <div className="hc-card-b fc-embed">
          <FrameworkRequirementsEditor frameworkId={frameworkId} licensing={licensing} initialRequirements={requirements} controls={controls} onChanged={refresh} />
        </div>
      </section>
    </>
  );
}
